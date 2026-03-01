// Ion Mining Group — Luxor Mining Pool Proxy (Cloudflare Worker)
// Deploy: wrangler deploy --name ion-luxor
// Secrets: wrangler secret put LUXOR_API_KEY
//
// wrangler.toml:
// name = "ion-luxor"
// main = "luxor-worker.js"
// compatibility_date = "2024-01-01"

const LUXOR_GQL = 'https://api.luxor.tech/graphql';
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

async function luxorGQL(query, variables, apiKey) {
    var res = await fetch(LUXOR_GQL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-lux-api-key': apiKey
        },
        body: JSON.stringify({ query: query, variables: variables || {} })
    });
    if (!res.ok) {
        var text = await res.text();
        throw new Error('Luxor API error ' + res.status + ': ' + text);
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

        var apiKey = env.LUXOR_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'API key not configured' }), {
                status: 500, headers: corsHeaders(origin)
            });
        }

        try {
            var data;

            if (path === '/ping') {
                data = await luxorGQL('{ getMiningSummary(mpn: BTC, inputInterval: _1_DAY) { hashrate } }', {}, apiKey);
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/workers') {
                data = await luxorGQL(`{
                    getWorkerDetails(mpn: BTC, first: 100) {
                        nodes {
                            workerName
                            hashrate
                            status
                        }
                    }
                }`, {}, apiKey);

                var nodes = (data.data && data.data.getWorkerDetails && data.data.getWorkerDetails.nodes) || [];
                var workers = [];
                for (var i = 0; i < nodes.length; i++) {
                    var n = nodes[i];
                    workers.push({
                        worker_name: n.workerName,
                        hashrate: n.hashrate || 0,
                        status: n.status === 'Active' ? 'Online' : 'Offline'
                    });
                }
                return new Response(JSON.stringify({ workers: workers }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/earnings') {
                data = await luxorGQL(`{
                    getMiningSummary(mpn: BTC, inputInterval: _1_DAY) {
                        hashrate
                        revenue
                    }
                    getPayouts(mpn: BTC, first: 1) {
                        nodes { amount }
                    }
                }`, {}, apiKey);

                var summary = (data.data && data.data.getMiningSummary) || {};
                var payoutNodes = (data.data && data.data.getPayouts && data.data.getPayouts.nodes) || [];
                var balance = payoutNodes.length > 0 ? parseFloat(payoutNodes[0].amount) || 0 : 0;

                return new Response(JSON.stringify({
                    balance: balance,
                    income_total: 0,
                    income_yesterday: parseFloat(summary.revenue) || 0,
                    income_estimated_daily: parseFloat(summary.revenue) || 0
                }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/payouts') {
                data = await luxorGQL(`{
                    getPayouts(mpn: BTC, first: 100) {
                        nodes {
                            amount
                            paidOn
                            txHash
                        }
                    }
                }`, {}, apiKey);

                var pNodes = (data.data && data.data.getPayouts && data.data.getPayouts.nodes) || [];
                var transactions = [];
                for (var j = 0; j < pNodes.length; j++) {
                    var pn = pNodes[j];
                    var paidTs = new Date(pn.paidOn).getTime() / 1000;
                    transactions.push({
                        created_at: paidTs,
                        payout_extra: {
                            tx_id: pn.txHash || '',
                            value: parseFloat(pn.amount) || 0,
                            paid_time: paidTs
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
