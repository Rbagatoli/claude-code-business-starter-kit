// Ion Mining Group — Antpool Proxy (Cloudflare Worker)
// Deploy: wrangler deploy --name ion-antpool
// Secrets:
//   wrangler secret put ANTPOOL_API_KEY
//   wrangler secret put ANTPOOL_API_SECRET
//   wrangler secret put ANTPOOL_USER_ID
//
// wrangler.toml:
// name = "ion-antpool"
// main = "antpool-worker.js"
// compatibility_date = "2024-01-01"
//
// Auth: Antpool uses HMAC-SHA256 signature.
// API docs: https://antpool.com/apiOverview
// Rate limit: 600 requests per 10 minutes

const ANTPOOL_BASE = 'https://antpool.com/api/';
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

async function generateSignature(apiKey, apiSecret, userId) {
    var nonce = Date.now().toString();
    var message = userId + apiKey + nonce;
    var encoder = new TextEncoder();
    var key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(apiSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    var signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    var hexSig = Array.from(new Uint8Array(signature))
        .map(function(b) { return b.toString(16).padStart(2, '0'); })
        .join('');
    return { nonce: nonce, signature: hexSig.toUpperCase() };
}

async function antpoolRequest(endpoint, apiKey, apiSecret, userId, extraParams) {
    var sig = await generateSignature(apiKey, apiSecret, userId);
    var params = {
        key: apiKey,
        nonce: sig.nonce,
        signature: sig.signature,
        userId: userId,
        coin: 'BTC'
    };
    if (extraParams) {
        var keys = Object.keys(extraParams);
        for (var i = 0; i < keys.length; i++) {
            params[keys[i]] = extraParams[keys[i]];
        }
    }

    var res = await fetch(ANTPOOL_BASE + endpoint + '.htm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString()
    });
    if (!res.ok) {
        var text = await res.text();
        throw new Error('Antpool API error ' + res.status + ': ' + text);
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

        var apiKey = env.ANTPOOL_API_KEY;
        var apiSecret = env.ANTPOOL_API_SECRET;
        var userId = env.ANTPOOL_USER_ID;

        if (!apiKey || !apiSecret || !userId) {
            return new Response(JSON.stringify({ error: 'API credentials not configured' }), {
                status: 500, headers: corsHeaders(origin)
            });
        }

        try {
            if (path === '/ping') {
                await antpoolRequest('hashrate', apiKey, apiSecret, userId);
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/workers') {
                var data = await antpoolRequest('workers', apiKey, apiSecret, userId, { pageSize: 100, page: 1 });
                var rawWorkers = (data.data && data.data.rows) || data.data || [];
                var workers = [];
                for (var i = 0; i < rawWorkers.length; i++) {
                    var w = rawWorkers[i];
                    var hr = parseFloat(w.last10m) || parseFloat(w.last1h) || parseFloat(w.hashrate) || 0;
                    // Antpool returns hashrate in GH/s, convert to H/s
                    var hrHs = hr * 1e9;
                    workers.push({
                        worker_name: w.worker || w.workerName || 'Worker ' + (i + 1),
                        hashrate: hrHs,
                        status: (w.status === 'active' || w.status === 'online' || hr > 0) ? 'Online' : 'Offline'
                    });
                }
                return new Response(JSON.stringify({ workers: workers }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/earnings') {
                var data = await antpoolRequest('account', apiKey, apiSecret, userId);
                var account = data.data || {};
                return new Response(JSON.stringify({
                    balance: parseFloat(account.balance) || 0,
                    income_total: parseFloat(account.totalAmount) || parseFloat(account.total_income) || 0,
                    income_yesterday: parseFloat(account.earn24Hours) || parseFloat(account.yesterday_income) || 0,
                    income_estimated_daily: parseFloat(account.earnPerDay) || parseFloat(account.earn24Hours) || 0
                }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/payouts') {
                var data = await antpoolRequest('paymentHistory', apiKey, apiSecret, userId, { pageSize: 100, page: 1 });
                var rawPayouts = (data.data && data.data.rows) || data.data || [];
                var transactions = [];
                for (var j = 0; j < rawPayouts.length; j++) {
                    var p = rawPayouts[j];
                    var ts = p.timestamp || (new Date(p.payTime || p.date).getTime() / 1000);
                    transactions.push({
                        created_at: ts,
                        payout_extra: {
                            tx_id: p.txId || p.txid || p.transactionId || '',
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
