// Ion Mining Group — Strike API Proxy (Cloudflare Worker)
// Firebase auth + per-user session tokens, TOTP, caps, rate limits.
// Each user connects their own Strike API key. Owner key used as fallback.

var STRIKE_BASE = 'https://api.strike.me';
var FIREBASE_PROJECT_ID = 'ion-mining';
var GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

var ALLOWED_ORIGINS = [
    'https://rbagatoli.github.io',
    'http://localhost',
    'http://127.0.0.1'
];

// Defaults for new users
var DEFAULT_MAX_SEND_USD = 1000;
var DEFAULT_MAX_SENDS_PER_HOUR = 5;

// Session TTL: 30 days (rolling refresh)
var SESSION_TTL = 2592000;

// TOTP brute-force protection
var MAX_TOTP_FAILS = 5;
var TOTP_LOCKOUT_MS = 900000; // 15 minutes

function isAllowedOrigin(origin) {
    for (var i = 0; i < ALLOWED_ORIGINS.length; i++) {
        if (origin === ALLOWED_ORIGINS[i] || origin.startsWith(ALLOWED_ORIGINS[i] + ':')) return true;
    }
    return false;
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dashboard-TOTP, X-Dashboard-Pin',
        'Content-Type': 'application/json'
    };
}

// ===== UTILITIES =====

function generateId(prefix) {
    var arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    var hex = '';
    for (var i = 0; i < arr.length; i++) {
        hex += ('0' + arr[i].toString(16)).slice(-2);
    }
    return (prefix || '') + hex;
}

function jsonResponse(body, status, origin) {
    return new Response(JSON.stringify(body), { status: status, headers: corsHeaders(origin) });
}

// ===== STRIKE API HELPERS =====

async function strikeGet(endpoint, apiKey) {
    var res = await fetch(STRIKE_BASE + endpoint, {
        headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Accept': 'application/json'
        }
    });
    var data = await res.json().catch(function() { return { error: 'Invalid response from Strike' }; });
    if (!res.ok) {
        data._strikeStatus = res.status;
        return data;
    }
    return data;
}

async function strikePost(endpoint, body, apiKey) {
    var res = await fetch(STRIKE_BASE + endpoint, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(body)
    });
    var data = await res.json().catch(function() { return { error: 'Invalid response from Strike' }; });
    if (!res.ok) {
        data._strikeStatus = res.status;
        return data;
    }
    return data;
}

async function strikePatch(endpoint, body, apiKey) {
    var res = await fetch(STRIKE_BASE + endpoint, {
        method: 'PATCH',
        headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(body || {})
    });
    var data = await res.json().catch(function() { return { error: 'Invalid response from Strike' }; });
    if (!res.ok) {
        data._strikeStatus = res.status;
        return data;
    }
    return data;
}

function hasStrikeError(data) {
    return data && data._strikeStatus;
}

function strikeErrorResponse(data, origin) {
    var status = data._strikeStatus;
    delete data._strikeStatus;
    return jsonResponse(data, status, origin);
}

// ===== PIN HASHING =====

async function hashPin(pin) {
    var encoded = new TextEncoder().encode(pin);
    var hash = await crypto.subtle.digest('SHA-256', encoded);
    var arr = new Uint8Array(hash);
    var hex = '';
    for (var i = 0; i < arr.length; i++) {
        hex += ('0' + arr[i].toString(16)).slice(-2);
    }
    return hex;
}

async function checkPin(request, env, user, origin) {
    if (!user.pinHash) return null; // No PIN set, skip
    var pin = (request.headers.get('X-Dashboard-Pin') || '').trim();
    if (!pin) {
        return jsonResponse({
            error: 'PIN required',
            message: 'Enter your 4-digit PIN to authorize this transaction.',
            pinRequired: true
        }, 403, origin);
    }
    var pinHash = await hashPin(pin);
    if (pinHash !== user.pinHash) {
        return jsonResponse({
            error: 'Invalid PIN',
            message: 'The PIN you entered is incorrect.',
            pinRequired: true
        }, 403, origin);
    }
    return null; // PIN OK
}

// ===== PER-USER STRIKE KEY =====

function getUserApiKey(user, env) {
    return user.strikeApiKey || env.STRIKE_API_KEY || '';
}

// ===== FIREBASE JWT VERIFICATION =====

// In-memory cache for Google JWKs (per worker instance)
var _googleJwks = null;
var _googleJwksExpiry = 0;

async function getGoogleJwks() {
    var now = Date.now();
    if (_googleJwks && now < _googleJwksExpiry) return _googleJwks;

    var res = await fetch(GOOGLE_JWKS_URL);
    if (!res.ok) throw new Error('Failed to fetch Google public keys');

    var cacheControl = res.headers.get('Cache-Control') || '';
    var maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    var maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) * 1000 : 3600000;

    var data = await res.json();
    // Index by kid for fast lookup
    var keysMap = {};
    for (var i = 0; i < data.keys.length; i++) {
        keysMap[data.keys[i].kid] = data.keys[i];
    }

    _googleJwks = keysMap;
    _googleJwksExpiry = now + maxAge;
    return _googleJwks;
}

function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var binary = atob(str);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function verifyFirebaseToken(idToken) {
    var parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');

    var headerJson = new TextDecoder().decode(base64UrlDecode(parts[0]));
    var payloadJson = new TextDecoder().decode(base64UrlDecode(parts[1]));
    var header = JSON.parse(headerJson);
    var payload = JSON.parse(payloadJson);

    // Check claims
    if (payload.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID) {
        throw new Error('Invalid issuer');
    }
    if (payload.aud !== FIREBASE_PROJECT_ID) {
        throw new Error('Invalid audience');
    }
    var now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
        throw new Error('Token expired');
    }
    if (payload.iat > now + 300) {
        throw new Error('Token issued in the future');
    }
    if (!payload.sub || typeof payload.sub !== 'string') {
        throw new Error('Missing subject');
    }

    // Verify RS256 signature using Google's JWK public keys
    var jwks = await getGoogleJwks();
    var jwk = jwks[header.kid];
    if (!jwk) throw new Error('Unknown signing key');

    var cryptoKey = await crypto.subtle.importKey(
        'jwk', jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false, ['verify']
    );

    var signatureBytes = base64UrlDecode(parts[2]);
    var dataBytes = new TextEncoder().encode(parts[0] + '.' + parts[1]);

    var valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signatureBytes, dataBytes);
    if (!valid) throw new Error('Invalid signature');

    return payload;
}

// ===== AUTH: SESSION-BASED =====

async function checkSession(request, env, origin) {
    var authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer sess_')) {
        return { error: jsonResponse({ error: 'Authentication required', loginRequired: true }, 401, origin) };
    }

    var token = authHeader.slice(7); // Remove "Bearer "
    var sessionData = await env.SETTINGS.get('session:' + token, 'json');
    if (!sessionData) {
        return { error: jsonResponse({ error: 'Session expired', loginRequired: true }, 401, origin) };
    }

    var user = await env.SETTINGS.get('user:' + sessionData.userId, 'json');
    if (!user || user.disabled) {
        return { error: jsonResponse({ error: 'Account disabled' }, 403, origin) };
    }

    // Rolling refresh: extend session TTL on each use
    await env.SETTINGS.put('session:' + token, JSON.stringify(sessionData), { expirationTtl: SESSION_TTL });

    return { user: user };
}

// ===== TOTP 2FA (Google Authenticator) =====
var BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(str) {
    str = str.replace(/[= ]/g, '').toUpperCase();
    var bits = '';
    for (var i = 0; i < str.length; i++) {
        var val = BASE32_CHARS.indexOf(str[i]);
        if (val === -1) continue;
        bits += ('00000' + val.toString(2)).slice(-5);
    }
    var bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (var j = 0; j < bytes.length; j++) {
        bytes[j] = parseInt(bits.slice(j * 8, j * 8 + 8), 2);
    }
    return bytes.buffer;
}

async function generateTOTP(keyBuf, counter) {
    var counterBuf = new ArrayBuffer(8);
    var view = new DataView(counterBuf);
    view.setUint32(4, counter, false);

    var cryptoKey = await crypto.subtle.importKey(
        'raw', keyBuf, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    var sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBuf));

    var offset = sig[sig.length - 1] & 0x0f;
    var code = ((sig[offset] & 0x7f) << 24 | sig[offset + 1] << 16 | sig[offset + 2] << 8 | sig[offset + 3]) % 1000000;
    var codeStr = String(code);
    while (codeStr.length < 6) codeStr = '0' + codeStr;
    return codeStr;
}

async function verifyTOTP(token, secret) {
    var keyBuf = base32Decode(secret);
    var timeStep = Math.floor(Date.now() / 30000);
    for (var i = -1; i <= 1; i++) {
        var code = await generateTOTP(keyBuf, timeStep + i);
        if (code === token) return true;
    }
    return false;
}

async function checkTOTP(request, env, user, origin) {
    var secret = user.totpSecret || '';
    if (!secret) return null; // 2FA not configured

    // Per-user brute-force check
    var lockKey = 'totp_fails:' + user.id;
    var fails = await env.SETTINGS.get(lockKey, 'json') || { count: 0, firstFail: 0 };
    var now = Date.now();

    if (fails.count >= MAX_TOTP_FAILS && (now - fails.firstFail) < TOTP_LOCKOUT_MS) {
        return jsonResponse({
            error: '2FA locked',
            message: 'Too many failed 2FA attempts. Try again in 15 minutes.'
        }, 429, origin);
    }

    if ((now - fails.firstFail) >= TOTP_LOCKOUT_MS) {
        fails = { count: 0, firstFail: 0 };
    }

    var token = (request.headers.get('X-Dashboard-TOTP') || '').replace(/\s/g, '');
    if (!token || token.length !== 6) {
        return jsonResponse({
            error: '2FA code required',
            message: 'Enter the 6-digit code from Google Authenticator.',
            totpRequired: true
        }, 403, origin);
    }

    var valid = await verifyTOTP(token, secret);
    if (!valid) {
        if (fails.count === 0) fails.firstFail = now;
        fails.count++;
        await env.SETTINGS.put(lockKey, JSON.stringify(fails), { expirationTtl: 900 });
        return jsonResponse({
            error: 'Invalid 2FA code',
            message: 'The authenticator code is incorrect or expired. Try the current code.',
            totpRequired: true
        }, 403, origin);
    }

    await env.SETTINGS.delete(lockKey);
    return null; // TOTP OK
}

function checkAmountCap(body, user, origin) {
    var maxUsd = user.maxSendUsd || 0;
    if (maxUsd === 0) {
        return jsonResponse({
            error: 'Send not permitted',
            message: 'Your send limit is set to $0. Go to Account Settings to set your send limit.'
        }, 403, origin);
    }
    if (body && body.amount && body.amount.amount) {
        var amt = parseFloat(body.amount.amount) || 0;
        var cur = (body.amount.currency || '').toUpperCase();
        if (cur === 'USD' && amt > maxUsd) {
            return jsonResponse({
                error: 'Amount exceeds limit',
                message: 'Maximum send amount is $' + maxUsd + ' USD per transaction.'
            }, 403, origin);
        }
    }
    return null;
}

async function checkRateLimit(env, user, origin) {
    var limitKey = 'rate:' + user.id;
    var maxPerHour = user.maxSendsPerHour || DEFAULT_MAX_SENDS_PER_HOUR;
    var log = await env.SETTINGS.get(limitKey, 'json') || [];
    var now = Date.now();
    var oneHourAgo = now - 3600000;

    log = log.filter(function(t) { return t > oneHourAgo; });

    if (log.length >= maxPerHour) {
        return jsonResponse({
            error: 'Rate limit exceeded',
            message: 'Maximum ' + maxPerHour + ' sends per hour. Try again later.'
        }, 429, origin);
    }

    return null;
}

async function recordSend(env, user) {
    var limitKey = 'rate:' + user.id;
    var log = await env.SETTINGS.get(limitKey, 'json') || [];
    log.push(Date.now());
    await env.SETTINGS.put(limitKey, JSON.stringify(log), { expirationTtl: 3600 });
}

// ===== AUTH ROUTE HANDLERS =====

async function handleFirebaseLogin(request, env, origin) {
    var body = await request.json().catch(function() { return {}; });
    var idToken = body.idToken || '';

    if (!idToken) {
        return jsonResponse({ error: 'Firebase ID token required' }, 400, origin);
    }

    // Verify Firebase JWT
    var payload;
    try {
        payload = await verifyFirebaseToken(idToken);
    } catch (e) {
        return jsonResponse({ error: 'Invalid Firebase token', message: e.message }, 401, origin);
    }

    var firebaseUid = payload.sub;
    var email = payload.email || '';
    var userId = 'fb_' + firebaseUid;

    // Get or create user record
    var user = await env.SETTINGS.get('user:' + userId, 'json');
    if (!user) {
        user = {
            id: userId,
            email: email,
            totpSecret: '',
            strikeApiKey: '',
            maxSendUsd: DEFAULT_MAX_SEND_USD,
            maxSendsPerHour: DEFAULT_MAX_SENDS_PER_HOUR,
            createdAt: new Date().toISOString(),
            disabled: false
        };
        await env.SETTINGS.put('user:' + userId, JSON.stringify(user));
    } else {
        // Update email if changed
        if (email && user.email !== email) {
            user.email = email;
            await env.SETTINGS.put('user:' + userId, JSON.stringify(user));
        }
    }

    if (user.disabled) {
        return jsonResponse({ error: 'Account disabled' }, 403, origin);
    }

    // Generate session token (30-day TTL)
    var token = 'sess_' + generateId('');
    await env.SETTINGS.put('session:' + token, JSON.stringify({
        userId: user.id,
        createdAt: Date.now()
    }), { expirationTtl: SESSION_TTL });

    var hasStrike = !!(user.strikeApiKey || env.STRIKE_API_KEY);

    return jsonResponse({
        ok: true,
        token: token,
        user: {
            id: user.id,
            email: user.email,
            strikeConnected: hasStrike,
            hasOwnKey: !!user.strikeApiKey,
            maxSendUsd: user.maxSendUsd,
            maxSendsPerHour: user.maxSendsPerHour,
            has2FA: !!user.totpSecret,
            hasPin: !!user.pinHash
        }
    }, 200, origin);
}

async function handleLogout(request, env, origin) {
    var authHeader = request.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer sess_')) {
        var token = authHeader.slice(7);
        await env.SETTINGS.delete('session:' + token);
    }
    return jsonResponse({ ok: true }, 200, origin);
}

async function handleMe(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    var user = auth.user;
    var hasStrike = !!(user.strikeApiKey || env.STRIKE_API_KEY);
    return jsonResponse({
        id: user.id,
        email: user.email,
        strikeConnected: hasStrike,
        hasOwnKey: !!user.strikeApiKey,
        maxSendUsd: user.maxSendUsd,
        maxSendsPerHour: user.maxSendsPerHour,
        has2FA: !!user.totpSecret,
        hasPin: !!user.pinHash,
        createdAt: user.createdAt
    }, 200, origin);
}

async function handleSetupTotp(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    var user = auth.user;

    var body = await request.json().catch(function() { return {}; });
    var newSecret = (body.secret || '').replace(/[^A-Z2-7]/gi, '').toUpperCase();
    var verifyCode = (body.code || '').replace(/\s/g, '');

    if (!newSecret || newSecret.length < 16) {
        return jsonResponse({ error: 'Invalid secret', message: 'Secret must be at least 16 base32 characters.' }, 400, origin);
    }
    if (!verifyCode || verifyCode.length !== 6) {
        return jsonResponse({ error: 'Verification required', message: 'Enter the 6-digit code from your authenticator app.' }, 400, origin);
    }

    var valid = await verifyTOTP(verifyCode, newSecret);
    if (!valid) {
        return jsonResponse({ error: 'Verification failed', message: 'The code does not match. Scan the QR code and enter the current code.' }, 403, origin);
    }

    user.totpSecret = newSecret;
    await env.SETTINGS.put('user:' + user.id, JSON.stringify(user));

    return jsonResponse({ ok: true, message: '2FA activated! All future sends will require an authenticator code.' }, 200, origin);
}

async function handleSetPin(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    var user = auth.user;

    var body = await request.json().catch(function() { return {}; });
    var pin = (body.pin || '').trim();

    if (!pin || pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
        return jsonResponse({ error: 'Invalid PIN', message: 'PIN must be 4-6 digits.' }, 400, origin);
    }

    user.pinHash = await hashPin(pin);
    await env.SETTINGS.put('user:' + user.id, JSON.stringify(user));

    return jsonResponse({ ok: true, message: 'Send PIN set successfully.' }, 200, origin);
}

// ===== STRIKE CONNECTION HANDLERS =====

async function handleConnectStrike(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    var user = auth.user;

    var body = await request.json().catch(function() { return {}; });
    var apiKey = (body.apiKey || '').trim();

    if (!apiKey) {
        return jsonResponse({ error: 'API key required' }, 400, origin);
    }

    var testData = await strikeGet('/v1/balances', apiKey);
    if (hasStrikeError(testData)) {
        return jsonResponse({
            error: 'Invalid API key',
            message: 'Could not connect to Strike with this API key. Make sure the key is correct and has the right permissions.'
        }, 400, origin);
    }

    user.strikeApiKey = apiKey;
    await env.SETTINGS.put('user:' + user.id, JSON.stringify(user));

    return jsonResponse({
        ok: true,
        strikeConnected: true,
        hasOwnKey: true,
        message: 'Strike account connected successfully!'
    }, 200, origin);
}

async function handleDisconnectStrike(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    var user = auth.user;

    user.strikeApiKey = '';
    await env.SETTINGS.put('user:' + user.id, JSON.stringify(user));

    var hasStrike = !!env.STRIKE_API_KEY;
    return jsonResponse({
        ok: true,
        strikeConnected: hasStrike,
        hasOwnKey: false,
        message: 'Strike API key removed.'
    }, 200, origin);
}

async function handleStrikeStatus(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    var user = auth.user;

    return jsonResponse({
        strikeConnected: !!(user.strikeApiKey || env.STRIKE_API_KEY),
        hasOwnKey: !!user.strikeApiKey
    }, 200, origin);
}

async function handleUpdateSettings(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    var user = auth.user;

    var body = await request.json().catch(function() { return {}; });

    if (typeof body.maxSendUsd === 'number' && body.maxSendUsd >= 0 && body.maxSendUsd <= 100000) {
        user.maxSendUsd = body.maxSendUsd;
    }
    if (typeof body.maxSendsPerHour === 'number' && body.maxSendsPerHour >= 1 && body.maxSendsPerHour <= 100) {
        user.maxSendsPerHour = body.maxSendsPerHour;
    }

    await env.SETTINGS.put('user:' + user.id, JSON.stringify(user));

    return jsonResponse({
        ok: true,
        maxSendUsd: user.maxSendUsd,
        maxSendsPerHour: user.maxSendsPerHour,
        message: 'Settings updated.'
    }, 200, origin);
}

// ===== ROUTE DEFINITIONS =====

// Tier 1: Open — no auth needed (uses owner's key)
var OPEN_ROUTES = {
    '/rates': { method: 'GET', endpoint: '/v1/rates/ticker' },
    '/ping':  { method: 'GET', endpoint: '/v1/balances' }
};

// Tier 2: Session-gated — read-only, session required
var SESSION_ROUTES = {
    '/balances':  { method: 'GET', endpoint: '/v1/balances' },
    '/deposits':  { method: 'GET', endpoint: '/v1/deposits' },
    '/payouts':   { method: 'GET', endpoint: '/v1/payouts' },
    '/receives':  { method: 'GET', endpoint: '/v1/receive-requests/receives' },
    '/invoices':  { method: 'GET', endpoint: '/v1/invoices' }
};

// Tier 3: Gated — session + caps/rate limits
var GATED_ROUTES = {
    '/invoice/create':        { method: 'POST', endpoint: '/v1/invoices' },
    '/exchange/quote':        { method: 'POST', endpoint: '/v1/currency-exchange-quotes' },
    '/send/quote/lightning':  { method: 'POST', endpoint: '/v1/payment-quotes/lightning' },
    '/send/quote/onchain':    { method: 'POST', endpoint: '/v1/payment-quotes/onchain' },
    '/send/onchain-tiers':    { method: 'POST', endpoint: '/v1/payment-quotes/onchain/tiers' }
};

export default {
    async fetch(request, env) {
        var origin = request.headers.get('Origin') || '';

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        var url = new URL(request.url);
        var path = url.pathname;

        try {
            // ===== AUTH ROUTES =====
            if (path === '/auth/firebase-login' && request.method === 'POST') {
                return await handleFirebaseLogin(request, env, origin);
            }
            if (path === '/auth/logout' && request.method === 'POST') {
                return await handleLogout(request, env, origin);
            }
            if (path === '/auth/me' && request.method === 'GET') {
                return await handleMe(request, env, origin);
            }
            if (path === '/auth/setup-totp' && request.method === 'POST') {
                return await handleSetupTotp(request, env, origin);
            }
            if (path === '/auth/set-pin' && request.method === 'POST') {
                return await handleSetPin(request, env, origin);
            }

            // ===== STRIKE CONNECTION ROUTES (session required) =====
            if (path === '/auth/connect-strike' && request.method === 'POST') {
                return await handleConnectStrike(request, env, origin);
            }
            if (path === '/auth/disconnect-strike' && request.method === 'POST') {
                return await handleDisconnectStrike(request, env, origin);
            }
            if (path === '/auth/strike-status' && request.method === 'GET') {
                return await handleStrikeStatus(request, env, origin);
            }
            if (path === '/auth/settings' && request.method === 'PATCH') {
                return await handleUpdateSettings(request, env, origin);
            }

            // ===== TIER 1: Open routes (use owner's key) =====
            if (OPEN_ROUTES[path]) {
                var ownerKey = env.STRIKE_API_KEY;
                if (!ownerKey) {
                    return jsonResponse({ error: 'Strike API key not configured' }, 500, origin);
                }

                var route = OPEN_ROUTES[path];
                var data = await strikeGet(route.endpoint, ownerKey);
                if (hasStrikeError(data)) return strikeErrorResponse(data, origin);

                if (path === '/ping') {
                    return jsonResponse({ ok: true, balances: data }, 200, origin);
                }

                return jsonResponse(data, 200, origin);
            }

            // ===== TIER 2: Session-gated read routes (per-user key) =====
            if (SESSION_ROUTES[path]) {
                var auth1 = await checkSession(request, env, origin);
                if (auth1.error) return auth1.error;

                var userKey1 = getUserApiKey(auth1.user, env);
                if (!userKey1) {
                    return jsonResponse({
                        error: 'Strike not connected',
                        strikeNotConnected: true,
                        message: 'Connect your Strike account to view your wallet.'
                    }, 403, origin);
                }

                var sessRoute = SESSION_ROUTES[path];
                var sessData = await strikeGet(sessRoute.endpoint, userKey1);
                if (hasStrikeError(sessData)) return strikeErrorResponse(sessData, origin);
                return jsonResponse(sessData, 200, origin);
            }

            // ===== TIER 3: Gated routes (per-user key) =====
            var isGatedRoute = GATED_ROUTES[path];
            var isExchangeExec = path.match(/^\/exchange\/execute\/(.+)$/);
            var isSendExec = path.match(/^\/send\/execute\/(.+)$/);
            var isSendStatus = path.match(/^\/send\/status\/(.+)$/);

            if (isGatedRoute || isExchangeExec || isSendExec || isSendStatus) {
                var auth2 = await checkSession(request, env, origin);
                if (auth2.error) return auth2.error;
                var user = auth2.user;

                var userKey2 = getUserApiKey(user, env);
                if (!userKey2) {
                    return jsonResponse({
                        error: 'Strike not connected',
                        strikeNotConnected: true,
                        message: 'Connect your Strike account to use this feature.'
                    }, 403, origin);
                }

                // Send status (GET)
                if (isSendStatus) {
                    var paymentId = isSendStatus[1];
                    var statusData = await strikeGet('/v1/payments/' + paymentId, userKey2);
                    if (hasStrikeError(statusData)) return strikeErrorResponse(statusData, origin);
                    return jsonResponse(statusData, 200, origin);
                }

                // All remaining gated routes require POST or PATCH
                if (request.method !== 'POST' && request.method !== 'PATCH') {
                    return jsonResponse({ error: 'POST or PATCH required' }, 405, origin);
                }

                var body = await request.json().catch(function() { return {}; });

                // Exchange execute — requires TOTP
                if (isExchangeExec) {
                    var totpErr1 = await checkTOTP(request, env, user, origin);
                    if (totpErr1) return totpErr1;

                    var exchQuoteId = isExchangeExec[1];
                    var exchData = await strikePost('/v1/currency-exchange-quotes/' + exchQuoteId + '/execute', body, userKey2);
                    if (hasStrikeError(exchData)) return strikeErrorResponse(exchData, origin);
                    return jsonResponse(exchData, 200, origin);
                }

                // Send execute (PATCH) — requires PIN + TOTP + rate limit
                if (isSendExec) {
                    var pinErr = await checkPin(request, env, user, origin);
                    if (pinErr) return pinErr;

                    var totpErr2 = await checkTOTP(request, env, user, origin);
                    if (totpErr2) return totpErr2;

                    var rateErr = await checkRateLimit(env, user, origin);
                    if (rateErr) return rateErr;

                    var sendQuoteId = isSendExec[1];
                    var sendData = await strikePatch('/v1/payment-quotes/' + sendQuoteId + '/execute', body, userKey2);
                    if (hasStrikeError(sendData)) return strikeErrorResponse(sendData, origin);
                    await recordSend(env, user);
                    return jsonResponse(sendData, 200, origin);
                }

                // Send quote routes — check amount cap
                if (path === '/send/quote/lightning' || path === '/send/quote/onchain') {
                    var capErr = checkAmountCap(body, user, origin);
                    if (capErr) return capErr;
                }

                // Standard gated routes (POST)
                var gatedRoute = GATED_ROUTES[path];
                var gatedData = await strikePost(gatedRoute.endpoint, body, userKey2);
                if (hasStrikeError(gatedData)) return strikeErrorResponse(gatedData, origin);
                return jsonResponse(gatedData, 200, origin);
            }

            // ===== BLOCKED =====
            return jsonResponse({
                error: 'Endpoint blocked',
                message: 'This endpoint is not allowed through the proxy for security.'
            }, 403, origin);

        } catch (e) {
            return jsonResponse({ error: e.message }, 502, origin);
        }
    }
};
