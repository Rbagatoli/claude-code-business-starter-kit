// Ion Mining Group — Strike API Proxy (Cloudflare Worker)
// API key stored as Worker secret, never exposed to browser.
// Three-tier endpoint security: Open, PIN-gated, Blocked.
// Send features: PIN + amount cap + rate limit.

var STRIKE_BASE = 'https://api.strike.me';
var ALLOWED_ORIGINS = [
    'https://rbagatoli.github.io',
    'http://localhost',
    'http://127.0.0.1'
];

// Rate limiter: track execute calls per hour (in-memory, resets on cold start)
var sendLog = [];
var MAX_SENDS_PER_HOUR = 5;
var DEFAULT_MAX_SEND_USD = 500;

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
        'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Pin',
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

                // --- Exchange execute ---
                if (isExchangeExec) {
                    var exchQuoteId = isExchangeExec[1];
                    var exchData = await strikePost('/v1/currency-exchange-quotes/' + exchQuoteId + '/execute', body, apiKey);
                    return new Response(JSON.stringify(exchData), {
                        status: 200, headers: corsHeaders(origin)
                    });
                }

                // --- Send execute (PATCH) — extra safety: rate limit ---
                if (isSendExec) {
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
