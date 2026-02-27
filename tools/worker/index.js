// Ion Mining Group — F2Pool API Proxy (Cloudflare Worker)

const F2POOL_BASE = 'https://api.f2pool.com/v2';
const ALLOWED_ORIGINS = [
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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
}

async function f2poolRequest(endpoint, body, apiSecret) {
    var res = await fetch(F2POOL_BASE + endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'F2P-API-SECRET': apiSecret
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        var text = await res.text();
        throw new Error('F2Pool API error ' + res.status + ': ' + text);
    }
    return res.json();
}

export default {
    async fetch(request, env) {
        var origin = request.headers.get('Origin') || '';

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        if (request.method !== 'GET') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405, headers: corsHeaders(origin)
            });
        }

        var url = new URL(request.url);
        var path = url.pathname;
        var user = url.searchParams.get('user');

        if (!user) {
            return new Response(JSON.stringify({ error: 'Missing user parameter' }), {
                status: 400, headers: corsHeaders(origin)
            });
        }

        var apiSecret = env.F2P_API_SECRET;
        if (!apiSecret) {
            return new Response(JSON.stringify({ error: 'API secret not configured' }), {
                status: 500, headers: corsHeaders(origin)
            });
        }

        try {
            var data;

            if (path === '/hashrate') {
                data = await f2poolRequest('/hash_rate/info', {
                    currency: 'bitcoin',
                    mining_user_name: user
                }, apiSecret);
            } else if (path === '/workers') {
                data = await f2poolRequest('/hash_rate/worker/list', {
                    currency: 'bitcoin',
                    mining_user_name: user,
                    page: 1,
                    page_size: 100,
                    status: 'all',
                    order_by: 'worker_name'
                }, apiSecret);
            } else if (path === '/earnings') {
                data = await f2poolRequest('/assets/balance', {
                    currency: 'bitcoin',
                    mining_user_name: user
                }, apiSecret);
            } else if (path === '/ping') {
                // Health check — just verify the API secret works
                data = await f2poolRequest('/hash_rate/info', {
                    currency: 'bitcoin',
                    mining_user_name: user
                }, apiSecret);
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200, headers: corsHeaders(origin)
                });
            } else {
                return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
                    status: 404, headers: corsHeaders(origin)
                });
            }

            return new Response(JSON.stringify(data), {
                status: 200, headers: corsHeaders(origin)
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 502, headers: corsHeaders(origin)
            });
        }
    }
};
