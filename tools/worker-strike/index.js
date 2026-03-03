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
    if (!user.pinHash) {
        return jsonResponse({
            error: 'PIN not configured',
            message: 'You must set up a send PIN before making transactions.',
            pinRequired: true,
            pinNotSet: true
        }, 403, origin);
    }
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

// ===== ON-CHAIN DEPOSIT ADDRESS =====

async function handleReceiveOnchain(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    var user = auth.user;

    var userKey = getUserApiKey(user, env);
    if (!userKey) {
        return jsonResponse({ error: 'Strike not connected', message: 'Connect your Strike account to get a deposit address.' }, 403, origin);
    }

    // Check KV cache (7-day TTL)
    var cacheKey = 'onchain-addr:' + user.id;
    try {
        var cached = await env.SETTINGS.get(cacheKey, 'json');
        if (cached && cached.address) {
            return jsonResponse({ ok: true, address: cached.address, cached: true }, 200, origin);
        }
    } catch(e) {}

    // Create receive request with on-chain address
    var data = await strikePost('/v1/receive-requests', { onchain: {} }, userKey);
    if (hasStrikeError(data)) return strikeErrorResponse(data, origin);

    // Extract address — check multiple possible response shapes
    var onchainAddr = '';
    if (data.onchainAddress) {
        onchainAddr = data.onchainAddress;
    } else if (data.onchain && data.onchain.address) {
        onchainAddr = data.onchain.address;
    } else if (data.onchain && data.onchain.uri) {
        // URI format: bitcoin:ADDRESS?...
        var match = (data.onchain.uri || '').match(/^bitcoin:([a-zA-Z0-9]+)/);
        if (match) onchainAddr = match[1];
    }

    if (!onchainAddr) {
        return jsonResponse({ error: 'No on-chain address in Strike response', debug: JSON.stringify(data).substring(0, 500) }, 502, origin);
    }

    // Cache for 7 days
    try {
        await env.SETTINGS.put(cacheKey, JSON.stringify({ address: onchainAddr, created: Date.now() }), { expirationTtl: 604800 });
    } catch(e) {}

    return jsonResponse({ ok: true, address: onchainAddr, cached: false }, 200, origin);
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

        // ===== SERVE PAY PAGE (public, no CORS needed) =====
        if (path === '/pay' && request.method === 'GET') {
            var payId = url.searchParams.get('id') || '';
            return new Response(getPayPageHTML(payId), {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

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

            // ===== ON-CHAIN DEPOSIT ADDRESS =====
            if (path === '/receive/onchain-address' && request.method === 'POST') {
                return await handleReceiveOnchain(request, env, origin);
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

            // ===== SHAREABLE INVOICE ROUTES (mixed auth) =====
            var isSharedStatus = path.match(/^\/invoice\/shared\/([a-z0-9]+)\/status$/);
            var isSharedInvoice = !isSharedStatus && path.match(/^\/invoice\/shared\/([a-z0-9]+)$/);
            var isInvoiceShare = path === '/invoice/share' && request.method === 'POST';

            // GET /invoice/shared/{id}/status — PUBLIC
            if (isSharedStatus && request.method === 'GET') {
                var statusShareId = isSharedStatus[1];
                var statusInv = await env.SETTINGS.get('invoice:' + statusShareId, 'json');
                if (!statusInv) return jsonResponse({ error: 'Invoice not found' }, 404, origin);

                var ownerKey3 = env.STRIKE_API_KEY;
                if (ownerKey3 && statusInv.invoiceId) {
                    var strikeInv = await strikeGet('/v1/invoices/' + statusInv.invoiceId, ownerKey3);
                    if (strikeInv && strikeInv.state === 'PAID' && statusInv.status !== 'PAID') {
                        statusInv.status = 'PAID';
                        await env.SETTINGS.put('invoice:' + statusShareId, JSON.stringify(statusInv), { expirationTtl: 86400 * 30 });
                    } else if (strikeInv && (strikeInv.state === 'CANCELLED')) {
                        statusInv.status = 'EXPIRED';
                    }
                }
                return jsonResponse({ status: statusInv.status || 'UNPAID' }, 200, origin);
            }

            // GET /invoice/shared/{id} — PUBLIC
            if (isSharedInvoice && request.method === 'GET') {
                var viewShareId = isSharedInvoice[1];
                var viewInv = await env.SETTINGS.get('invoice:' + viewShareId, 'json');
                if (!viewInv) return jsonResponse({ error: 'Invoice not found' }, 404, origin);

                // If bolt11 quote expired, try to regenerate
                var bolt11 = viewInv.bolt11 || '';
                if (viewInv.invoiceId && viewInv.quoteExpires && new Date(viewInv.quoteExpires).getTime() < Date.now()) {
                    var ownerKey4 = env.STRIKE_API_KEY;
                    if (ownerKey4) {
                        var newQuote = await strikePost('/v1/invoices/' + viewInv.invoiceId + '/quote', {}, ownerKey4);
                        if (newQuote && newQuote.lnInvoice) {
                            bolt11 = newQuote.lnInvoice;
                            viewInv.bolt11 = bolt11;
                            viewInv.quoteExpires = newQuote.expirationInSec
                                ? new Date(Date.now() + newQuote.expirationInSec * 1000).toISOString()
                                : new Date(Date.now() + 3600000).toISOString();
                            await env.SETTINGS.put('invoice:' + viewShareId, JSON.stringify(viewInv), { expirationTtl: 86400 * 30 });
                        }
                    }
                }

                return jsonResponse({
                    amount: viewInv.amount,
                    currency: viewInv.currency,
                    description: viewInv.description,
                    bolt11: bolt11,
                    status: viewInv.status || 'UNPAID',
                    businessName: viewInv.businessName || '',
                    created: viewInv.created
                }, 200, origin);
            }

            // POST /invoice/share — AUTHENTICATED
            if (isInvoiceShare) {
                var auth3 = await checkSession(request, env, origin);
                if (auth3.error) return auth3.error;
                var shareUser = auth3.user;
                var shareKey = getUserApiKey(shareUser, env);
                if (!shareKey) {
                    return jsonResponse({ error: 'Strike not connected' }, 403, origin);
                }

                var shareBody = await request.json().catch(function() { return {}; });
                var shareAmt = shareBody.amount || '';
                var shareCur = shareBody.currency || 'USD';
                var shareDesc = shareBody.description || 'Payment';

                // Create Strike invoice
                var invoiceBody = {
                    correlationId: 'share_' + Date.now().toString(36),
                    description: shareDesc,
                    amount: { amount: shareAmt, currency: shareCur }
                };
                var strikeInvoice = await strikePost('/v1/invoices', invoiceBody, shareKey);
                if (hasStrikeError(strikeInvoice)) return strikeErrorResponse(strikeInvoice, origin);

                // Generate bolt11 quote
                var shareQuote = await strikePost('/v1/invoices/' + strikeInvoice.invoiceId + '/quote', {}, shareKey);
                var shareBolt11 = (shareQuote && shareQuote.lnInvoice) || '';

                // Generate share ID and store in KV
                var shareId = Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
                var quoteExpires = shareQuote && shareQuote.expirationInSec
                    ? new Date(Date.now() + shareQuote.expirationInSec * 1000).toISOString()
                    : new Date(Date.now() + 3600000).toISOString();

                var invoiceRecord = {
                    invoiceId: strikeInvoice.invoiceId,
                    bolt11: shareBolt11,
                    amount: shareAmt,
                    currency: shareCur,
                    description: shareDesc,
                    businessName: shareBody.businessName || '',
                    created: new Date().toISOString(),
                    quoteExpires: quoteExpires,
                    status: 'UNPAID',
                    userId: shareUser.id
                };
                await env.SETTINGS.put('invoice:' + shareId, JSON.stringify(invoiceRecord), { expirationTtl: 86400 * 30 });

                return jsonResponse({
                    shareId: shareId,
                    bolt11: shareBolt11,
                    invoiceId: strikeInvoice.invoiceId
                }, 200, origin);
            }

            // ===== TIER 3: Gated routes (per-user key) =====
            var isGatedRoute = GATED_ROUTES[path];
            var isExchangeExec = path.match(/^\/exchange\/execute\/(.+)$/);
            var isSendExec = path.match(/^\/send\/execute\/(.+)$/);
            var isSendStatus = path.match(/^\/send\/status\/(.+)$/);
            var isInvoiceQuote = path.match(/^\/invoice\/(.+)\/quote$/);
            var isInvoiceGet = !isInvoiceQuote && !path.startsWith('/invoice/shared/') && path.match(/^\/invoice\/(.+)$/);

            if (isGatedRoute || isExchangeExec || isSendExec || isSendStatus || isInvoiceGet || isInvoiceQuote) {
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

                // Invoice quote (POST) — generates bolt11
                if (isInvoiceQuote && request.method === 'POST') {
                    var iqId = isInvoiceQuote[1];
                    var quoteBody = await request.json().catch(function() { return {}; });
                    var quoteData = await strikePost('/v1/invoices/' + iqId + '/quote', quoteBody, userKey2);
                    if (hasStrikeError(quoteData)) return strikeErrorResponse(quoteData, origin);
                    return jsonResponse(quoteData, 200, origin);
                }

                // Invoice details (GET)
                if (isInvoiceGet && request.method === 'GET') {
                    var invoiceId = isInvoiceGet[1];
                    var invoiceData = await strikeGet('/v1/invoices/' + invoiceId, userKey2);
                    if (hasStrikeError(invoiceData)) return strikeErrorResponse(invoiceData, origin);
                    return jsonResponse(invoiceData, 200, origin);
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

function getPayPageHTML(invoiceId) {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Invoice — Payment</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#060606;color:#e8e8e8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.invoice-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;max-width:440px;width:100%;padding:32px 28px;box-shadow:0 8px 32px rgba(0,0,0,0.4)}.biz-name{font-size:20px;font-weight:600;color:#f7931a;text-align:center;margin-bottom:4px}.inv-label{font-size:12px;color:#888;text-align:center;margin-bottom:24px}.details{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:16px;margin-bottom:24px}.dr{display:flex;justify-content:space-between;padding:6px 0;font-size:14px}.dr .lb{color:#888}.dr .vl{color:#e8e8e8;font-weight:500}.dr .vl.am{color:#f7931a;font-size:18px;font-weight:700}.qr{text-align:center;margin-bottom:20px}.qr img{border-radius:12px;background:#fff;padding:10px;width:220px;height:220px}.b11{position:relative;margin-bottom:20px}.b11t{background:rgba(255,255,255,0.05);padding:10px 50px 10px 14px;border-radius:8px;font-family:monospace;font-size:11px;word-break:break-all;color:#f7931a;max-height:70px;overflow-y:auto;line-height:1.5}.cpb{position:absolute;top:6px;right:6px;padding:5px 12px;font-size:11px;background:rgba(247,147,26,0.15);border:1px solid rgba(247,147,26,0.3);color:#f7931a;border-radius:6px;cursor:pointer;font-family:inherit}.cpb:hover{background:rgba(247,147,26,0.25)}.sb{text-align:center;padding:14px;border-radius:10px;font-size:14px;font-weight:500;margin-bottom:16px}.sw{background:rgba(247,147,26,0.08);border:1px solid rgba(247,147,26,0.25);color:#f7931a}.sp{background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.25);color:#4ade80}.se{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);color:#ef4444}.ft{text-align:center;font-size:11px;color:#555;margin-top:16px}.es{text-align:center;padding:40px 20px;color:#ef4444;font-size:15px}.ls{text-align:center;padding:40px 20px;color:#888;font-size:15px}.pulse{animation:pulse 2s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}.wbtn{display:inline-block;padding:12px 28px;background:rgba(247,147,26,0.15);border:1px solid rgba(247,147,26,0.3);color:#f7931a;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600}</style></head><body><div class="invoice-card"><div id="ls" class="ls"><div class="pulse">Loading invoice...</div></div><div id="es" class="es" style="display:none"></div><div id="ic" style="display:none"><div class="biz-name" id="bn">Invoice</div><div class="inv-label">Payment Request</div><div class="details"><div class="dr"><span class="lb">Amount</span><span class="vl am" id="ia">--</span></div><div class="dr"><span class="lb">Description</span><span class="vl" id="id">--</span></div><div class="dr"><span class="lb">Created</span><span class="vl" id="it">--</span></div></div><div id="sb" class="sb sw">Waiting for payment...</div><div id="ps"><div class="qr"><img id="qr" alt="Lightning QR"></div><div style="font-size:12px;color:#888;margin-bottom:6px">Lightning Invoice:</div><div class="b11"><div class="b11t" id="bt"></div><button class="cpb" id="cb">Copy</button></div></div><div id="wb" style="display:none;text-align:center;margin-bottom:16px"><a id="wl" href="#" class="wbtn">Open in Wallet</a></div><div class="ft">Secured payment via Lightning Network</div></div></div><script>(function(){var id="' + (invoiceId || '') + '";var base=window.location.origin;if(!id){err("No invoice ID");return}load();async function load(){try{var r=await fetch(base+"/invoice/shared/"+id);if(!r.ok){var e=await r.json().catch(function(){return{}});err(e.error||"Not found ("+r.status+")");return}render(await r.json());poll()}catch(e){err("Could not load: "+e.message)}}function render(d){document.getElementById("ls").style.display="none";document.getElementById("ic").style.display="";if(d.businessName)document.getElementById("bn").textContent=d.businessName;var a=d.amount||"0",c=(d.currency||"USD").toUpperCase();if(c==="USD")a="$"+parseFloat(a).toFixed(2)+" USD";else a=a+" "+c;document.getElementById("ia").textContent=a;document.getElementById("id").textContent=d.description||"-";if(d.created){var dt=new Date(d.created);document.getElementById("it").textContent=(dt.getMonth()+1)+"/"+dt.getDate()+"/"+dt.getFullYear()+" "+String(dt.getHours()).padStart(2,"0")+":"+String(dt.getMinutes()).padStart(2,"0")}if(d.status==="PAID"){paid();return}if(d.status==="EXPIRED"){expired();return}var b=d.bolt11||"";if(b){document.getElementById("bt").textContent=b;document.getElementById("qr").src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&ecc=M&data="+encodeURIComponent("lightning:"+b);document.getElementById("wl").href="lightning:"+b;document.getElementById("wb").style.display=""}document.title="Invoice — "+a}function paid(){var s=document.getElementById("sb");s.className="sb sp";s.textContent="Payment Received";document.getElementById("ps").style.display="none"}function expired(){var s=document.getElementById("sb");s.className="sb se";s.textContent="Invoice Expired";document.getElementById("ps").style.display="none"}function err(m){document.getElementById("ls").style.display="none";var e=document.getElementById("es");e.style.display="";e.textContent=m}function poll(){setInterval(async function(){try{var r=await fetch(base+"/invoice/shared/"+id+"/status");if(!r.ok)return;var d=await r.json();if(d.status==="PAID")paid();else if(d.status==="EXPIRED")expired()}catch(e){}},5000)}document.getElementById("cb").addEventListener("click",function(){var t=document.getElementById("bt").textContent;var b=this;navigator.clipboard.writeText(t).then(function(){b.textContent="Copied!";setTimeout(function(){b.textContent="Copy"},1500)}).catch(function(){var ta=document.createElement("textarea");ta.value=t;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();document.execCommand("copy");document.body.removeChild(ta);b.textContent="Copied!";setTimeout(function(){b.textContent="Copy"},1500)})})})()</script></body></html>';
}
