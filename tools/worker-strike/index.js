// Ion Mining Group — Strike API Proxy (Cloudflare Worker)
// Multi-user auth with session tokens, per-user PIN, TOTP, caps, rate limits.
// API key stored as Worker secret, never exposed to browser.

var STRIKE_BASE = 'https://api.strike.me';
var ALLOWED_ORIGINS = [
    'https://rbagatoli.github.io',
    'http://localhost',
    'http://127.0.0.1'
];

// Defaults for new admin users
var DEFAULT_MAX_SEND_USD = 1000;
var DEFAULT_MAX_SENDS_PER_HOUR = 5;

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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dashboard-Pin, X-Dashboard-TOTP',
        'Content-Type': 'application/json'
    };
}

// ===== UTILITIES =====

async function hashPin(pin) {
    var encoder = new TextEncoder();
    var data = encoder.encode(pin);
    var hash = await crypto.subtle.digest('SHA-256', data);
    var arr = new Uint8Array(hash);
    var hex = '';
    for (var i = 0; i < arr.length; i++) {
        hex += ('0' + arr[i].toString(16)).slice(-2);
    }
    return hex;
}

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
    if (!res.ok) {
        var text = await res.text();
        throw new Error('Strike API error ' + res.status + ': ' + text);
    }
    return res.json();
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
    if (!res.ok) {
        var text = await res.text();
        throw new Error('Strike API error ' + res.status + ': ' + text);
    }
    return res.json();
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
    if (!res.ok) {
        var text = await res.text();
        throw new Error('Strike API error ' + res.status + ': ' + text);
    }
    return res.json();
}

// ===== AUTH: SESSION-BASED =====

async function checkSession(request, env, origin) {
    var authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer sess_')) {
        // Legacy PIN fallback (migration support)
        var pin = request.headers.get('X-Dashboard-Pin') || '';
        var expectedPin = env.DASHBOARD_PIN || '';
        if (expectedPin && pin === expectedPin) {
            return {
                user: {
                    id: 'legacy',
                    username: 'admin',
                    role: 'admin',
                    maxSendUsd: parseFloat(env.MAX_SEND_USD) || DEFAULT_MAX_SEND_USD,
                    maxSendsPerHour: DEFAULT_MAX_SENDS_PER_HOUR,
                    totpSecret: env.TOTP_SECRET || ''
                }
            };
        }
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
    // Get secret from user record; for legacy user, check KV fallback
    var secret = user.totpSecret || '';
    if (!secret && user.id === 'legacy' && env.SETTINGS) {
        secret = await env.SETTINGS.get('totp_secret') || '';
    }
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
            message: 'Your account does not have send permissions. Ask an admin to set your send limit.'
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

async function handleRegister(request, env, origin) {
    var body = await request.json().catch(function() { return {}; });
    var username = (body.username || '').trim().toLowerCase();
    var pin = body.pin || '';
    var existingPin = body.existingPin || '';

    // Validate username
    if (!username || username.length < 3 || username.length > 20 || !/^[a-z0-9_]+$/.test(username)) {
        return jsonResponse({ error: 'Username must be 3-20 characters (letters, numbers, underscore)' }, 400, origin);
    }

    // Validate PIN
    if (!pin || pin.length < 4 || pin.length > 20) {
        return jsonResponse({ error: 'PIN must be 4-20 characters' }, 400, origin);
    }

    // Check if username taken
    var existingUser = await env.SETTINGS.get('username:' + username);
    if (existingUser) {
        return jsonResponse({ error: 'Username already taken' }, 409, origin);
    }

    // Check if this is the first user (admin)
    var userList = await env.SETTINGS.list({ prefix: 'user:', limit: 1 });
    var isFirstUser = !userList.keys || userList.keys.length === 0;

    // First user must provide existing DASHBOARD_PIN as proof of ownership
    if (isFirstUser && env.DASHBOARD_PIN) {
        if (!existingPin || existingPin !== env.DASHBOARD_PIN) {
            return jsonResponse({
                error: 'Admin verification required',
                message: 'First account requires your existing dashboard PIN to verify ownership.',
                requireExistingPin: true
            }, 403, origin);
        }
    }

    var userId = generateId('u_');
    var pinHash = await hashPin(pin);

    var userRecord = {
        id: userId,
        username: username,
        pinHash: pinHash,
        totpSecret: '',
        role: isFirstUser ? 'admin' : 'user',
        maxSendUsd: isFirstUser ? DEFAULT_MAX_SEND_USD : 0,
        maxSendsPerHour: DEFAULT_MAX_SENDS_PER_HOUR,
        createdAt: new Date().toISOString(),
        disabled: false
    };

    // If first user and there's an existing global TOTP secret, migrate it
    if (isFirstUser) {
        var globalTotp = env.TOTP_SECRET || '';
        if (!globalTotp && env.SETTINGS) {
            globalTotp = await env.SETTINGS.get('totp_secret') || '';
        }
        if (globalTotp) {
            userRecord.totpSecret = globalTotp;
            // Clean up global key
            await env.SETTINGS.delete('totp_secret');
        }
    }

    // Write user record and username index
    await env.SETTINGS.put('user:' + userId, JSON.stringify(userRecord));
    await env.SETTINGS.put('username:' + username, userId);

    return jsonResponse({
        ok: true,
        userId: userId,
        role: userRecord.role,
        message: isFirstUser ? 'Admin account created! You can now log in.' : 'Account created! An admin must grant you send permissions.'
    }, 201, origin);
}

async function handleLogin(request, env, origin) {
    var body = await request.json().catch(function() { return {}; });
    var username = (body.username || '').trim().toLowerCase();
    var pin = body.pin || '';

    if (!username || !pin) {
        return jsonResponse({ error: 'Username and PIN required' }, 400, origin);
    }

    // Look up username
    var userId = await env.SETTINGS.get('username:' + username);
    if (!userId) {
        return jsonResponse({ error: 'Invalid username or PIN' }, 401, origin);
    }

    // Get user record
    var user = await env.SETTINGS.get('user:' + userId, 'json');
    if (!user) {
        return jsonResponse({ error: 'Invalid username or PIN' }, 401, origin);
    }

    if (user.disabled) {
        return jsonResponse({ error: 'Account disabled' }, 403, origin);
    }

    // Verify PIN
    var pinHash = await hashPin(pin);
    if (pinHash !== user.pinHash) {
        return jsonResponse({ error: 'Invalid username or PIN' }, 401, origin);
    }

    // Generate session token
    var token = 'sess_' + generateId('');
    await env.SETTINGS.put('session:' + token, JSON.stringify({
        userId: user.id,
        createdAt: Date.now()
    }), { expirationTtl: 86400 }); // 24h

    return jsonResponse({
        ok: true,
        token: token,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            maxSendUsd: user.maxSendUsd,
            maxSendsPerHour: user.maxSendsPerHour,
            has2FA: !!user.totpSecret
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
    return jsonResponse({
        id: user.id,
        username: user.username,
        role: user.role,
        maxSendUsd: user.maxSendUsd,
        maxSendsPerHour: user.maxSendsPerHour,
        has2FA: !!user.totpSecret,
        createdAt: user.createdAt
    }, 200, origin);
}

async function handleSetupTotp(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    var user = auth.user;

    if (user.id === 'legacy') {
        // Legacy user: use old global KV method
        var body2 = await request.json().catch(function() { return {}; });
        var newSecret2 = (body2.secret || '').replace(/[^A-Z2-7]/gi, '').toUpperCase();
        var verifyCode2 = (body2.code || '').replace(/\s/g, '');
        if (!newSecret2 || newSecret2.length < 16) return jsonResponse({ error: 'Invalid secret' }, 400, origin);
        if (!verifyCode2 || verifyCode2.length !== 6) return jsonResponse({ error: 'Verification required' }, 400, origin);
        var valid2 = await verifyTOTP(verifyCode2, newSecret2);
        if (!valid2) return jsonResponse({ error: 'Verification failed' }, 403, origin);
        await env.SETTINGS.put('totp_secret', newSecret2);
        return jsonResponse({ ok: true, message: '2FA activated!' }, 200, origin);
    }

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

    // Update user record with new TOTP secret
    user.totpSecret = newSecret;
    await env.SETTINGS.put('user:' + user.id, JSON.stringify(user));

    return jsonResponse({ ok: true, message: '2FA activated! All future sends will require an authenticator code.' }, 200, origin);
}

// ===== ADMIN ROUTE HANDLERS =====

async function handleAdminListUsers(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    if (auth.user.role !== 'admin') return jsonResponse({ error: 'Admin access required' }, 403, origin);

    var keys = await env.SETTINGS.list({ prefix: 'user:' });
    var users = [];
    for (var i = 0; i < keys.keys.length; i++) {
        var record = await env.SETTINGS.get(keys.keys[i].name, 'json');
        if (record) {
            users.push({
                id: record.id,
                username: record.username,
                role: record.role,
                maxSendUsd: record.maxSendUsd,
                maxSendsPerHour: record.maxSendsPerHour,
                has2FA: !!record.totpSecret,
                disabled: record.disabled,
                createdAt: record.createdAt
            });
        }
    }

    return jsonResponse({ users: users }, 200, origin);
}

async function handleAdminUpdateUser(request, env, origin, targetUserId) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    if (auth.user.role !== 'admin') return jsonResponse({ error: 'Admin access required' }, 403, origin);

    var target = await env.SETTINGS.get('user:' + targetUserId, 'json');
    if (!target) return jsonResponse({ error: 'User not found' }, 404, origin);

    var body = await request.json().catch(function() { return {}; });

    // Updatable fields
    if (typeof body.maxSendUsd === 'number') target.maxSendUsd = body.maxSendUsd;
    if (typeof body.maxSendsPerHour === 'number') target.maxSendsPerHour = body.maxSendsPerHour;
    if (typeof body.disabled === 'boolean') target.disabled = body.disabled;
    if (body.role === 'admin' || body.role === 'user') target.role = body.role;

    await env.SETTINGS.put('user:' + targetUserId, JSON.stringify(target));

    return jsonResponse({
        ok: true,
        user: {
            id: target.id,
            username: target.username,
            role: target.role,
            maxSendUsd: target.maxSendUsd,
            maxSendsPerHour: target.maxSendsPerHour,
            disabled: target.disabled
        }
    }, 200, origin);
}

async function handleAdminDeleteUser(request, env, origin, targetUserId) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;
    if (auth.user.role !== 'admin') return jsonResponse({ error: 'Admin access required' }, 403, origin);

    // Can't delete yourself
    if (auth.user.id === targetUserId) return jsonResponse({ error: 'Cannot delete your own account' }, 400, origin);

    var target = await env.SETTINGS.get('user:' + targetUserId, 'json');
    if (!target) return jsonResponse({ error: 'User not found' }, 404, origin);

    // Delete user record and username index
    await env.SETTINGS.delete('user:' + targetUserId);
    await env.SETTINGS.delete('username:' + target.username);

    return jsonResponse({ ok: true, deleted: targetUserId }, 200, origin);
}

// ===== ROUTE DEFINITIONS =====

// Tier 1: Open — no auth needed
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

        var apiKey = env.STRIKE_API_KEY;
        if (!apiKey) {
            return jsonResponse({ error: 'Strike API key not configured' }, 500, origin);
        }

        try {
            // ===== AUTH ROUTES (no session required) =====
            if (path === '/auth/register' && request.method === 'POST') {
                return await handleRegister(request, env, origin);
            }
            if (path === '/auth/login' && request.method === 'POST') {
                return await handleLogin(request, env, origin);
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

            // ===== ADMIN ROUTES =====
            if (path === '/admin/users' && request.method === 'GET') {
                return await handleAdminListUsers(request, env, origin);
            }
            var adminUserMatch = path.match(/^\/admin\/users\/(.+)$/);
            if (adminUserMatch) {
                if (request.method === 'PATCH') {
                    return await handleAdminUpdateUser(request, env, origin, adminUserMatch[1]);
                }
                if (request.method === 'DELETE') {
                    return await handleAdminDeleteUser(request, env, origin, adminUserMatch[1]);
                }
            }

            // Legacy 2FA setup route (redirects to new one)
            if (path === '/admin/setup-totp' && request.method === 'POST') {
                return await handleSetupTotp(request, env, origin);
            }

            // ===== TIER 1: Open routes =====
            if (OPEN_ROUTES[path]) {
                var route = OPEN_ROUTES[path];
                var data = await strikeGet(route.endpoint, apiKey);

                if (path === '/ping') {
                    return jsonResponse({ ok: true, balances: data }, 200, origin);
                }

                return jsonResponse(data, 200, origin);
            }

            // ===== TIER 2: Session-gated read routes =====
            if (SESSION_ROUTES[path]) {
                var auth1 = await checkSession(request, env, origin);
                if (auth1.error) return auth1.error;

                var sessRoute = SESSION_ROUTES[path];
                var sessData = await strikeGet(sessRoute.endpoint, apiKey);
                return jsonResponse(sessData, 200, origin);
            }

            // ===== TIER 3: Gated routes =====
            var isGatedRoute = GATED_ROUTES[path];
            var isExchangeExec = path.match(/^\/exchange\/execute\/(.+)$/);
            var isSendExec = path.match(/^\/send\/execute\/(.+)$/);
            var isSendStatus = path.match(/^\/send\/status\/(.+)$/);

            if (isGatedRoute || isExchangeExec || isSendExec || isSendStatus) {
                var auth2 = await checkSession(request, env, origin);
                if (auth2.error) return auth2.error;
                var user = auth2.user;

                // Send status (GET)
                if (isSendStatus) {
                    var paymentId = isSendStatus[1];
                    var statusData = await strikeGet('/v1/payments/' + paymentId, apiKey);
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
                    var exchData = await strikePost('/v1/currency-exchange-quotes/' + exchQuoteId + '/execute', body, apiKey);
                    return jsonResponse(exchData, 200, origin);
                }

                // Send execute (PATCH) — requires TOTP + rate limit
                if (isSendExec) {
                    var totpErr2 = await checkTOTP(request, env, user, origin);
                    if (totpErr2) return totpErr2;

                    var rateErr = await checkRateLimit(env, user, origin);
                    if (rateErr) return rateErr;

                    var sendQuoteId = isSendExec[1];
                    var sendData = await strikePatch('/v1/payment-quotes/' + sendQuoteId + '/execute', body, apiKey);
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
                var gatedData = await strikePost(gatedRoute.endpoint, body, apiKey);
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
