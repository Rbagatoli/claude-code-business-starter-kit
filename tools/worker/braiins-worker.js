// Ion Mining Group — Braiins Pool Proxy (Cloudflare Worker)
// Deploy: wrangler deploy --name ion-braiins
// Secrets: wrangler secret put BRAIINS_API_KEY
//
// wrangler.toml:
// name = "ion-braiins"
// main = "braiins-worker.js"
// compatibility_date = "2024-01-01"
//
// Auth: Braiins Pool API uses an API key (token) passed as Authorization header.
// Generate at: https://pool.braiins.com/settings/access

const BRAIINS_BASE = 'https://pool.braiins.com/accounts';
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

async function braiinsRequest(endpoint, apiKey) {
    var res = await fetch(BRAIINS_BASE + endpoint, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) {
        var text = await res.text();
        throw new Error('Braiins API error ' + res.status + ': ' + text);
    }
    return res.json();
}

export default {
    async fetch(request, env) {
        var origin = request.headers.get('Origin') || '';

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

        var apiKey = env.BRAIINS_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'API key not configured' }), {
                status: 500, headers: corsHeaders(origin)
            });
        }

        try {
            if (path === '/ping') {
                await braiinsRequest('/profile/', apiKey);
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/workers') {
                var data = await braiinsRequest('/workers/', apiKey);
                var rawWorkers = data.btc || data.data || [];
                var workers = [];
                for (var i = 0; i < rawWorkers.length; i++) {
                    var w = rawWorkers[i];
                    workers.push({
                        worker_name: w.name || w.worker_name || 'Worker ' + (i + 1),
                        hashrate: w.hash_rate_scoring || w.hashrate || w.hash_rate_5m || 0,
                        status: (w.state === 'ok' || w.status === 'online' || w.alive) ? 'Online' : 'Offline'
                    });
                }
                return new Response(JSON.stringify({ workers: workers }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/earnings') {
                var data = await braiinsRequest('/rewards/', apiKey);
                var rewards = data.btc || data.data || {};
                return new Response(JSON.stringify({
                    balance: parseFloat(rewards.balance) || 0,
                    income_total: parseFloat(rewards.total_reward) || parseFloat(rewards.all_time) || 0,
                    income_yesterday: parseFloat(rewards.yesterday_reward) || 0,
                    income_estimated_daily: parseFloat(rewards.estimated_reward) || parseFloat(rewards.yesterday_reward) || 0
                }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/payouts') {
                var data = await braiinsRequest('/payouts/', apiKey);
                var rawPayouts = data.btc || data.data || [];
                var transactions = [];
                for (var j = 0; j < rawPayouts.length; j++) {
                    var p = rawPayouts[j];
                    var ts = new Date(p.paid_on || p.date || p.created_at).getTime() / 1000;
                    transactions.push({
                        created_at: ts,
                        payout_extra: {
                            tx_id: p.tx_id || p.txid || p.transaction_id || '',
                            value: parseFloat(p.amount) || parseFloat(p.value) || 0,
                            paid_time: ts
                        }
                    });
                }
                return new Response(JSON.stringify({ transactions: transactions }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else {
                return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
                    status: 404, headers: corsHeaders(origin)
                });
            }
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 502, headers: corsHeaders(origin)
            });
        }
    }
};
