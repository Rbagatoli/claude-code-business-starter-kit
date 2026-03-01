// Ion Mining Group — QuickBooks Proxy (Cloudflare Worker)
// Deploy: wrangler deploy --name ion-quickbooks
// Secrets:
//   wrangler secret put QBO_CLIENT_ID
//   wrangler secret put QBO_CLIENT_SECRET
//   wrangler secret put QBO_REFRESH_TOKEN
//   wrangler secret put QBO_REALM_ID
//
// wrangler.toml:
// name = "ion-quickbooks"
// main = "quickbooks-worker.js"
// compatibility_date = "2024-01-01"
//
// Setup:
// 1. Create app at https://developer.intuit.com
// 2. Select "Accounting" scope
// 3. Use OAuth Playground to get initial refresh token
// 4. Deploy with secrets above

const QBO_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

const ALLOWED_ORIGINS = [
    'https://rbagatoli.github.io',
    'http://localhost',
    'http://127.0.0.1'
];

// In-memory token cache (per worker instance)
var cachedToken = null;
var tokenExpiry = 0;

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

async function getAccessToken(env) {
    // Return cached token if still valid (with 60s buffer)
    if (cachedToken && Date.now() < tokenExpiry - 60000) {
        return cachedToken;
    }

    var credentials = btoa(env.QBO_CLIENT_ID + ':' + env.QBO_CLIENT_SECRET);
    var res = await fetch(QBO_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + credentials,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(env.QBO_REFRESH_TOKEN)
    });

    if (!res.ok) {
        var text = await res.text();
        throw new Error('Token refresh failed ' + res.status + ': ' + text);
    }

    var data = await res.json();
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    return cachedToken;
}

async function qboQuery(query, env) {
    var token = await getAccessToken(env);
    var url = QBO_BASE + '/' + env.QBO_REALM_ID + '/query?query=' + encodeURIComponent(query);
    var res = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/json'
        }
    });
    if (!res.ok) {
        var text = await res.text();
        throw new Error('QBO query error ' + res.status + ': ' + text);
    }
    return res.json();
}

async function qboGet(endpoint, env) {
    var token = await getAccessToken(env);
    var url = QBO_BASE + '/' + env.QBO_REALM_ID + '/' + endpoint;
    var res = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/json'
        }
    });
    if (!res.ok) {
        var text = await res.text();
        throw new Error('QBO API error ' + res.status + ': ' + text);
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

        // Check required secrets
        if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET || !env.QBO_REFRESH_TOKEN || !env.QBO_REALM_ID) {
            return new Response(JSON.stringify({ error: 'QuickBooks credentials not configured' }), {
                status: 500, headers: corsHeaders(origin)
            });
        }

        var url = new URL(request.url);
        var path = url.pathname;

        try {
            if (path === '/ping') {
                var info = await qboGet('companyinfo/' + env.QBO_REALM_ID, env);
                var companyName = info && info.CompanyInfo ? info.CompanyInfo.CompanyName : 'Connected';
                return new Response(JSON.stringify({ ok: true, companyName: companyName }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/accounts') {
                var data = await qboQuery(
                    "SELECT * FROM Account WHERE AccountType IN ('Bank', 'Credit Card') AND Active = true MAXRESULTS 50",
                    env
                );
                var raw = (data.QueryResponse && data.QueryResponse.Account) || [];
                var accounts = [];
                for (var i = 0; i < raw.length; i++) {
                    var a = raw[i];
                    accounts.push({
                        id: a.Id,
                        name: a.Name,
                        type: a.AccountType,
                        subType: a.AccountSubType || '',
                        balance: parseFloat(a.CurrentBalance) || 0,
                        currency: a.CurrencyRef ? a.CurrencyRef.value : 'USD'
                    });
                }
                return new Response(JSON.stringify({ accounts: accounts }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/expenses') {
                var start = url.searchParams.get('start') || '2024-01-01';
                var end = url.searchParams.get('end') || new Date().toISOString().split('T')[0];

                // Fetch purchases (direct expenses)
                var purchaseData = await qboQuery(
                    "SELECT * FROM Purchase WHERE TxnDate >= '" + start + "' AND TxnDate <= '" + end + "' ORDERBY TxnDate DESC MAXRESULTS 200",
                    env
                );
                var rawPurchases = (purchaseData.QueryResponse && purchaseData.QueryResponse.Purchase) || [];

                // Fetch bills
                var billData = await qboQuery(
                    "SELECT * FROM Bill WHERE TxnDate >= '" + start + "' AND TxnDate <= '" + end + "' ORDERBY TxnDate DESC MAXRESULTS 200",
                    env
                );
                var rawBills = (billData.QueryResponse && billData.QueryResponse.Bill) || [];

                var expenses = [];

                for (var p = 0; p < rawPurchases.length; p++) {
                    var pur = rawPurchases[p];
                    var vendor = '';
                    if (pur.EntityRef) vendor = pur.EntityRef.name || '';
                    var category = '';
                    if (pur.Line && pur.Line.length > 0) {
                        var detail = pur.Line[0].AccountBasedExpenseLineDetail;
                        if (detail && detail.AccountRef) category = detail.AccountRef.name || '';
                    }
                    expenses.push({
                        id: pur.Id,
                        date: pur.TxnDate,
                        vendor: vendor,
                        amount: parseFloat(pur.TotalAmt) || 0,
                        category: category,
                        type: 'purchase',
                        accountName: pur.AccountRef ? pur.AccountRef.name : ''
                    });
                }

                for (var b = 0; b < rawBills.length; b++) {
                    var bill = rawBills[b];
                    expenses.push({
                        id: bill.Id,
                        date: bill.TxnDate,
                        vendor: bill.VendorRef ? bill.VendorRef.name : '',
                        amount: parseFloat(bill.TotalAmt) || 0,
                        category: 'Bill',
                        type: 'bill',
                        accountName: ''
                    });
                }

                // Sort by date descending
                expenses.sort(function(a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : 0; });

                return new Response(JSON.stringify({ expenses: expenses }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/invoices') {
                var data = await qboQuery(
                    "SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS 100",
                    env
                );
                var rawInvoices = (data.QueryResponse && data.QueryResponse.Invoice) || [];
                var invoices = [];
                for (var inv = 0; inv < rawInvoices.length; inv++) {
                    var r = rawInvoices[inv];
                    var balance = parseFloat(r.Balance) || 0;
                    var total = parseFloat(r.TotalAmt) || 0;
                    var status = 'paid';
                    if (balance > 0) {
                        var dueDate = r.DueDate || r.TxnDate;
                        status = new Date(dueDate) < new Date() ? 'overdue' : 'due';
                    }
                    invoices.push({
                        id: r.Id,
                        date: r.TxnDate,
                        customer: r.CustomerRef ? r.CustomerRef.name : '',
                        amount: total,
                        balance: balance,
                        dueDate: r.DueDate || '',
                        status: status,
                        docNumber: r.DocNumber || ''
                    });
                }
                return new Response(JSON.stringify({ invoices: invoices }), {
                    status: 200, headers: corsHeaders(origin)
                });

            } else if (path === '/transactions') {
                var accountId = url.searchParams.get('accountId');
                if (!accountId) {
                    return new Response(JSON.stringify({ error: 'accountId required' }), {
                        status: 400, headers: corsHeaders(origin)
                    });
                }
                var data = await qboQuery(
                    "SELECT * FROM Purchase WHERE AccountRef = '" + accountId + "' ORDERBY TxnDate DESC MAXRESULTS 100",
                    env
                );
                var rawTxns = (data.QueryResponse && data.QueryResponse.Purchase) || [];
                var transactions = [];
                for (var t = 0; t < rawTxns.length; t++) {
                    var txn = rawTxns[t];
                    transactions.push({
                        id: txn.Id,
                        date: txn.TxnDate,
                        vendor: txn.EntityRef ? txn.EntityRef.name : '',
                        amount: parseFloat(txn.TotalAmt) || 0,
                        type: txn.PaymentType || 'Other'
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
