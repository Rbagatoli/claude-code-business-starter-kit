// Ion Mining Group — Strike API Proxy (Cloudflare Worker)
// API key stored as Worker secret, never exposed to browser.
// Three-tier endpoint security: Open, PIN-gated, Blocked.

var STRIKE_BASE = 'https://api.strike.me';
var ALLOWED_ORIGINS = [
    'https://rbagatoli.github.io',
    'http://localhost',
    'http://127.0.0.1'
];

function isAllowedOrigin(origin) {
    for (var i = 0; i < ALLOWED_ORIGINS.length; i++) {
        if (origin === ALLOWED_ORIGINS[i] || origin.startsWith(ALLOWED_ORIGINS[i] + ':')) return true;
    }
    return false;
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    '/invoice/create':   { method: 'POST', endpoint: '/v1/invoices' },
    '/exchange/quote':   { method: 'POST', endpoint: '/v1/currency-exchange-quotes' }
    // /exchange/execute requires dynamic path — handled in code below
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
            if (GATED_ROUTES[path] || path.match(/^\/exchange\/execute\/.+$/)) {
                // Check PIN
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

                if (request.method !== 'POST') {
                    return new Response(JSON.stringify({ error: 'POST required for this endpoint' }), {
                        status: 405, headers: corsHeaders(origin)
                    });
                }

                var body = await request.json().catch(function() { return {}; });

                // Handle /exchange/execute/:quoteId
                var execMatch = path.match(/^\/exchange\/execute\/(.+)$/);
                if (execMatch) {
                    var quoteId = execMatch[1];
                    var execData = await strikePost('/v1/currency-exchange-quotes/' + quoteId + '/execute', body, apiKey);
                    return new Response(JSON.stringify(execData), {
                        status: 200, headers: corsHeaders(origin)
                    });
                }

                // Standard gated routes
                var gatedRoute = GATED_ROUTES[path];
                var gatedData = await strikePost(gatedRoute.endpoint, body, apiKey);
                return new Response(JSON.stringify(gatedData), {
                    status: 200, headers: corsHeaders(origin)
                });
            }

            // ===== TIER 3: Everything else is blocked =====
            return new Response(JSON.stringify({
                error: 'Endpoint blocked',
                message: 'This endpoint is not allowed through the proxy for security. Blocked endpoints include: send payments, bank account management, payout initiation.'
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
