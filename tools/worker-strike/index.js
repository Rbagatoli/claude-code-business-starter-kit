// Ion Mining Group — Strike API Proxy (Cloudflare Worker)
// API key stored as Worker secret, never exposed to browser.
// Three-tier endpoint security: Open, PIN-gated, Blocked.
// Send features: PIN + TOTP 2FA + amount cap + rate limit.

var STRIKE_BASE = 'https://api.strike.me';
var ALLOWED_ORIGINS = [
    'https://rbagatoli.github.io',
    'http://localhost',
    'http://127.0.0.1'
];

// Rate limiter: track execute calls per hour (in-memory, resets on cold start)
var sendLog = [];
var MAX_SENDS_PER_HOUR = 5;
var DEFAULT_MAX_SEND_USD = 1000;

// TOTP brute-force protection (in-memory)
var totpFailLog = [];
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
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Pin, X-Dashboard-TOTP',
        'Content-Type': 'application/json'
    };
}

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

function checkPin(request, env, origin) {
    var pin = request.headers.get('X-Dashboard-Pin') || '';
    var expectedPin = env.DASHBOARD_PIN || '';
    if (!expectedPin) {
        return new Response(JSON.stringify({ error: 'Dashboard PIN not configured on worker' }), {
            status: 500, headers: corsHeaders(origin)
        });
    }
    if (pin !== expectedPin) {
        return new Response(JSON.stringify({ error: 'Invalid PIN' }), {
            status: 403, headers: corsHeaders(origin)
        });
    }
    return null; // PIN OK
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
    // Convert counter to 8-byte big-endian buffer
    var counterBuf = new ArrayBuffer(8);
    var view = new DataView(counterBuf);
    view.setUint32(4, counter, false);

    // HMAC-SHA1 using Web Crypto API
    var cryptoKey = await crypto.subtle.importKey(
        'raw', keyBuf, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    var sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBuf));

    // Dynamic truncation (RFC 4226)
    var offset = sig[sig.length - 1] & 0x0f;
    var code = ((sig[offset] & 0x7f) << 24 | sig[offset + 1] << 16 | sig[offset + 2] << 8 | sig[offset + 3]) % 1000000;
    var codeStr = String(code);
    while (codeStr.length < 6) codeStr = '0' + codeStr;
    return codeStr;
}

async function verifyTOTP(token, secret) {
    var keyBuf = base32Decode(secret);
    var timeStep = Math.floor(Date.now() / 30000);
    // Check current window and ±1 for clock drift
    for (var i = -1; i <= 1; i++) {
        var code = await generateTOTP(keyBuf, timeStep + i);
        if (code === token) return true;
    }
    return false;
}

async function checkTOTP(request, env, origin) {
    // If TOTP_SECRET not configured, check KV fallback; if neither, 2FA disabled
    var secret = env.TOTP_SECRET || '';
    if (!secret && env.SETTINGS) {
        secret = await env.SETTINGS.get('totp_secret') || '';
    }
    if (!secret) return null;

    // Check brute-force lockout
    var now = Date.now();
    var cutoff = now - TOTP_LOCKOUT_MS;
    totpFailLog = totpFailLog.filter(function(t) { return t > cutoff; });
    if (totpFailLog.length >= MAX_TOTP_FAILS) {
        return new Response(JSON.stringify({
            error: '2FA locked',
            message: 'Too many failed 2FA attempts. Try again in 15 minutes.'
        }), { status: 429, headers: corsHeaders(origin) });
    }

    var token = (request.headers.get('X-Dashboard-TOTP') || '').replace(/\s/g, '');
    if (!token || token.length !== 6) {
        return new Response(JSON.stringify({
            error: '2FA code required',
            message: 'Enter the 6-digit code from Google Authenticator.',
            totpRequired: true
        }), { status: 403, headers: corsHeaders(origin) });
    }

    var valid = await verifyTOTP(token, secret);
    if (!valid) {
        totpFailLog.push(now);
        return new Response(JSON.stringify({
            error: 'Invalid 2FA code',
            message: 'The authenticator code is incorrect or expired. Try the current code.',
            totpRequired: true
        }), { status: 403, headers: corsHeaders(origin) });
    }

    return null; // TOTP OK
}

function checkAmountCap(body, env, origin) {
    var maxUsd = parseFloat(env.MAX_SEND_USD) || DEFAULT_MAX_SEND_USD;
    if (body && body.amount && body.amount.amount) {
        var amt = parseFloat(body.amount.amount) || 0;
        var cur = (body.amount.currency || '').toUpperCase();
        // Block if USD amount exceeds cap
        if (cur === 'USD' && amt > maxUsd) {
            return new Response(JSON.stringify({
                error: 'Amount exceeds limit',
                message: 'Maximum send amount is $' + maxUsd + ' USD per transaction.'
            }), { status: 403, headers: corsHeaders(origin) });
        }
        // For BTC amounts, we can't easily check without a price — allow (quote will show USD value)
    }
    return null; // Amount OK
}

function checkRateLimit(origin) {
    var now = Date.now();
    var oneHourAgo = now - 3600000;
    // Clean old entries
    sendLog = sendLog.filter(function(t) { return t > oneHourAgo; });
    if (sendLog.length >= MAX_SENDS_PER_HOUR) {
        return new Response(JSON.stringify({
            error: 'Rate limit exceeded',
            message: 'Maximum ' + MAX_SENDS_PER_HOUR + ' sends per hour. Try again later.'
        }), { status: 429, headers: corsHeaders(origin) });
    }
    return null; // Rate OK
}

// ===== TIER DEFINITIONS =====

// Tier 1: Open — read-only, no extra auth needed
var OPEN_ROUTES = {
    '/balances':  { method: 'GET', endpoint: '/v1/balances' },
    '/deposits':  { method: 'GET', endpoint: '/v1/deposits' },
    '/payouts':   { method: 'GET', endpoint: '/v1/payouts' },
    '/receives':  { method: 'GET', endpoint: '/v1/receive-requests/receives' },
    '/invoices':  { method: 'GET', endpoint: '/v1/invoices' },
    '/rates':     { method: 'GET', endpoint: '/v1/rates/ticker' },
    '/ping':      { method: 'GET', endpoint: '/v1/balances' }
};

// Tier 2: PIN-gated — require X-Dashboard-Pin header
var GATED_ROUTES = {
    '/invoice/create':        { method: 'POST', endpoint: '/v1/invoices' },
    '/exchange/quote':        { method: 'POST', endpoint: '/v1/currency-exchange-quotes' },
    '/send/quote/lightning':  { method: 'POST', endpoint: '/v1/payment-quotes/lightning' },
    '/send/quote/onchain':    { method: 'POST', endpoint: '/v1/payment-quotes/onchain' },
    '/send/onchain-tiers':    { method: 'POST', endpoint: '/v1/payment-quotes/onchain/tiers' }
    // Dynamic routes handled in code: /exchange/execute/:id, /send/execute/:id, /send/status/:id
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
            return new Response(JSON.stringify({ error: 'Strike API key not configured' }), {
                status: 500, headers: corsHeaders(origin)
            });
        }

        try {
            // ===== TIER 1: Open routes =====
            if (OPEN_ROUTES[path]) {
                var route = OPEN_ROUTES[path];
                var data = await strikeGet(route.endpoint, apiKey);

                // Special handling for /ping — just return ok
                if (path === '/ping') {
                    return new Response(JSON.stringify({ ok: true, balances: data }), {
                        status: 200, headers: corsHeaders(origin)
                    });
                }

                return new Response(JSON.stringify(data), {
                    status: 200, headers: corsHeaders(origin)
                });
            }

            // ===== ADMIN: Self-service TOTP setup =====
            if (path === '/admin/setup-totp' && request.method === 'POST') {
                var pinErr = checkPin(request, env, origin);
                if (pinErr) return pinErr;

                var setupBody = await request.json().catch(function() { return {}; });
                var newSecret = (setupBody.secret || '').replace(/[^A-Z2-7]/gi, '').toUpperCase();
                var verifyCode = (setupBody.code || '').replace(/\s/g, '');

                if (!newSecret || newSecret.length < 16) {
                    return new Response(JSON.stringify({
                        error: 'Invalid secret',
                        message: 'Secret must be at least 16 base32 characters.'
                    }), { status: 400, headers: corsHeaders(origin) });
                }

                if (!verifyCode || verifyCode.length !== 6) {
                    return new Response(JSON.stringify({
                        error: 'Verification required',
                        message: 'Enter the 6-digit code from your authenticator app to verify setup.'
                    }), { status: 400, headers: corsHeaders(origin) });
                }

                var valid = await verifyTOTP(verifyCode, newSecret);
                if (!valid) {
                    return new Response(JSON.stringify({
                        error: 'Verification failed',
                        message: 'The code does not match. Make sure you scanned the QR code and enter the current code.'
                    }), { status: 403, headers: corsHeaders(origin) });
                }

                if (!env.SETTINGS) {
                    return new Response(JSON.stringify({
                        error: 'KV not configured',
                        message: 'SETTINGS KV namespace is not bound to this worker.'
                    }), { status: 500, headers: corsHeaders(origin) });
                }

                await env.SETTINGS.put('totp_secret', newSecret);

                return new Response(JSON.stringify({
                    ok: true,
                    message: '2FA activated! All future sends will require an authenticator code.'
                }), { status: 200, headers: corsHeaders(origin) });
            }

            // ===== TIER 2: PIN-gated routes =====
            var isGatedRoute = GATED_ROUTES[path];
            var isExchangeExec = path.match(/^\/exchange\/execute\/(.+)$/);
            var isSendExec = path.match(/^\/send\/execute\/(.+)$/);
            var isSendStatus = path.match(/^\/send\/status\/(.+)$/);

            if (isGatedRoute || isExchangeExec || isSendExec || isSendStatus) {
                // Check PIN for all gated routes
                var pinErr = checkPin(request, env, origin);
                if (pinErr) return pinErr;

                // --- Send status (GET) ---
                if (isSendStatus) {
                    var paymentId = isSendStatus[1];
                    var statusData = await strikeGet('/v1/payments/' + paymentId, apiKey);
                    return new Response(JSON.stringify(statusData), {
                        status: 200, headers: corsHeaders(origin)
                    });
                }

                // All remaining gated routes require POST or PATCH
                if (request.method !== 'POST' && request.method !== 'PATCH') {
                    return new Response(JSON.stringify({ error: 'POST or PATCH required' }), {
                        status: 405, headers: corsHeaders(origin)
                    });
                }

                var body = await request.json().catch(function() { return {}; });

                // --- Exchange execute — requires TOTP 2FA ---
                if (isExchangeExec) {
                    var totpErr1 = await checkTOTP(request, env, origin);
                    if (totpErr1) return totpErr1;

                    var exchQuoteId = isExchangeExec[1];
                    var exchData = await strikePost('/v1/currency-exchange-quotes/' + exchQuoteId + '/execute', body, apiKey);
                    return new Response(JSON.stringify(exchData), {
                        status: 200, headers: corsHeaders(origin)
                    });
                }

                // --- Send execute (PATCH) — requires TOTP 2FA + rate limit ---
                if (isSendExec) {
                    var totpErr2 = await checkTOTP(request, env, origin);
                    if (totpErr2) return totpErr2;

                    var rateErr = checkRateLimit(origin);
                    if (rateErr) return rateErr;

                    var sendQuoteId = isSendExec[1];
                    var sendData = await strikePatch('/v1/payment-quotes/' + sendQuoteId + '/execute', body, apiKey);
                    sendLog.push(Date.now()); // Record successful send
                    return new Response(JSON.stringify(sendData), {
                        status: 200, headers: corsHeaders(origin)
                    });
                }

                // --- Send quote routes — check amount cap ---
                if (path === '/send/quote/lightning' || path === '/send/quote/onchain') {
                    var capErr = checkAmountCap(body, env, origin);
                    if (capErr) return capErr;
                }

                // Standard gated routes (POST)
                var gatedRoute = GATED_ROUTES[path];
                var gatedData = await strikePost(gatedRoute.endpoint, body, apiKey);
                return new Response(JSON.stringify(gatedData), {
                    status: 200, headers: corsHeaders(origin)
                });
            }

            // ===== TIER 3: Everything else is blocked =====
            return new Response(JSON.stringify({
                error: 'Endpoint blocked',
                message: 'This endpoint is not allowed through the proxy for security. Blocked endpoints include: bank account management, payout initiation.'
            }), {
                status: 403, headers: corsHeaders(origin)
            });

        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 502, headers: corsHeaders(origin)
            });
        }
    }
};
