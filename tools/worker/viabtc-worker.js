// Ion Mining Group — ViaBTC Pool Proxy (Cloudflare Worker)
// Deploy: wrangler deploy --name ion-viabtc
// Secrets: wrangler secret put VIABTC_API_KEY
//
// wrangler.toml:
// name = "ion-viabtc"
// main = "viabtc-worker.js"
// compatibility_date = "2024-01-01"
//
// Auth: ViaBTC uses an API key passed as X-API-KEY header.
// Generate at: https://www.viabtc.com/setting/api

const VIABTC_BASE = 'https://www.viabtc.com/res/openapi/v1';
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

async function viaBTCRequest(endpoint, apiKey) {
    var res = await fetch(VIABTC_BASE + endpoint, {
        method: 'GET',
        headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) {
        var text = await res.text();
        throw new Error('ViaBTC API error ' + res.status + ': ' + text);
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
        var user = url.searchParams.get('user') || '';

        var apiKey = env.VIABTC_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'API key not configured' }), {
                status: 500, headers: corsHeaders(origin)
            });
        }

        try {
            if (path === '/ping') {
                await viaBTCRequest('/hashrate?coin=BTC', apiKey);
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/workers') {
                var data = await viaBTCRequest('/hashrate/workers?coin=BTC', apiKey);
                var rawWorkers = (data.data && data.data.data) || data.data || [];
                var workers = [];
                for (var i = 0; i < rawWorkers.length; i++) {
                    var w = rawWorkers[i];
                    workers.push({
                        worker_name: w.worker_name || w.name || 'Worker ' + (i + 1),
                        hashrate: parseFloat(w.hashrate) || parseFloat(w.hashrate_1h) || 0,
                        status: (w.status === 'active' || w.is_active || w.hashrate > 0) ? 'Online' : 'Offline'
                    });
                }
                return new Response(JSON.stringify({ workers: workers }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/earnings') {
                var data = await viaBTCRequest('/profit?coin=BTC', apiKey);
                var profit = data.data || {};
                return new Response(JSON.stringify({
                    balance: parseFloat(profit.balance) || 0,
                    income_total: parseFloat(profit.total_profit) || parseFloat(profit.total_income) || 0,
                    income_yesterday: parseFloat(profit.yesterday_profit) || parseFloat(profit.yesterday_income) || 0,
                    income_estimated_daily: parseFloat(profit.estimated_profit) || parseFloat(profit.yesterday_profit) || 0
                }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/payouts') {
                var data = await viaBTCRequest('/payment/history?coin=BTC', apiKey);
                var rawPayouts = (data.data && data.data.data) || data.data || [];
                var transactions = [];
                for (var j = 0; j < rawPayouts.length; j++) {
                    var p = rawPayouts[j];
                    var ts = p.paid_time || p.timestamp || (new Date(p.date).getTime() / 1000);
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
