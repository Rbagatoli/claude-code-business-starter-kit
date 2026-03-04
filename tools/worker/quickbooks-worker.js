// Ion Mining Group — QuickBooks OAuth Proxy (Cloudflare Worker)
// Multi-user OAuth 2.0 with Firebase auth + per-user token storage
// Deploy: wrangler deploy --config wrangler-qbo.toml
//
// Secrets (set via wrangler secret put):
//   QBO_CLIENT_ID - QuickBooks app client ID
//   QBO_CLIENT_SECRET - QuickBooks app client secret
//   QBO_ENVIRONMENT - "production" or "sandbox"

var QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

var ALLOWED_ORIGINS = [
    'https://rbagatoli.github.io',
    'http://localhost',
    'http://127.0.0.1'
];

// Session TTL: 30 days (matches Strike worker)
var SESSION_TTL = 2592000;

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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };
}

function jsonResponse(body, status, origin) {
    return new Response(JSON.stringify(body), { status: status, headers: corsHeaders(origin) });
}

function generateState() {
    var arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    var hex = '';
    for (var i = 0; i < arr.length; i++) {
        hex += ('0' + arr[i].toString(16)).slice(-2);
    }
    return 'state_' + hex;
}

// ===== SESSION AUTHENTICATION =====

async function checkSession(request, env, origin) {
    var authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer sess_')) {
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

    // Rolling refresh: extend session TTL on each use
    await env.SETTINGS.put('session:' + token, JSON.stringify(sessionData), { expirationTtl: SESSION_TTL });

    return { user: user };
}

// ===== QUICKBOOKS TOKEN MANAGEMENT =====

async function getQboAccessToken(userId, env) {
    var tokens = await env.SETTINGS.get('qbo_tokens:' + userId, 'json');
    if (!tokens) throw new Error('QuickBooks not connected');

    // Return cached access token if still valid (5-minute buffer)
    if (tokens.accessToken && tokens.accessTokenExpiry > Date.now()) {
        return { accessToken: tokens.accessToken, realmId: tokens.realmId };
    }

    // Refresh access token
    var credentials = btoa(env.QBO_CLIENT_ID + ':' + env.QBO_CLIENT_SECRET);
    var res = await fetch(QBO_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + credentials,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(tokens.refreshToken)
    });

    if (!res.ok) {
        var text = await res.text();
        throw new Error('Token refresh failed ' + res.status + ': ' + text);
    }

    var data = await res.json();

    // CRITICAL: Store NEW refresh token (QuickBooks uses rolling refresh)
    tokens.refreshToken = data.refresh_token;
    tokens.accessToken = data.access_token;
    tokens.accessTokenExpiry = Date.now() + (data.expires_in * 1000);
    tokens.lastRefreshed = new Date().toISOString();

    await env.SETTINGS.put('qbo_tokens:' + userId, JSON.stringify(tokens));

    return { accessToken: data.access_token, realmId: tokens.realmId };
}

// ===== OAUTH ROUTE HANDLERS =====

async function handleQboInitiate(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;

    var state = generateState();
    var callbackUrl = new URL(request.url).origin + '/auth/qbo/callback';

    // Store state for CSRF validation (10-minute TTL)
    await env.SETTINGS.put('qbo_state:' + state, JSON.stringify({
        userId: auth.user.id,
        createdAt: Date.now()
    }), { expirationTtl: 600 });

    var authUrl = 'https://appcenter.intuit.com/connect/oauth2' +
        '?client_id=' + encodeURIComponent(env.QBO_CLIENT_ID) +
        '&response_type=code' +
        '&scope=com.intuit.quickbooks.accounting%20com.intuit.quickbooks.payment' +
        '&redirect_uri=' + encodeURIComponent(callbackUrl) +
        '&state=' + encodeURIComponent(state);

    return jsonResponse({ ok: true, authUrl: authUrl }, 200, origin);
}

async function handleQboCallback(request, env, origin) {
    var url = new URL(request.url);
    var code = url.searchParams.get('code');
    var state = url.searchParams.get('state');
    var realmId = url.searchParams.get('realmId');
    var error = url.searchParams.get('error');

    if (error) {
        return new Response(getOAuthCallbackHTML(false, 'Authorization declined: ' + error), {
            headers: { 'Content-Type': 'text/html' }
        });
    }

    if (!code || !state || !realmId) {
        return new Response(getOAuthCallbackHTML(false, 'Missing OAuth parameters'), {
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Validate state (CSRF protection)
    var stateData = await env.SETTINGS.get('qbo_state:' + state, 'json');
    if (!stateData) {
        return new Response(getOAuthCallbackHTML(false, 'Invalid or expired state token'), {
            headers: { 'Content-Type': 'text/html' }
        });
    }
    await env.SETTINGS.delete('qbo_state:' + state);

    // Exchange code for tokens
    var callbackUrl = url.origin + '/auth/qbo/callback';
    var credentials = btoa(env.QBO_CLIENT_ID + ':' + env.QBO_CLIENT_SECRET);

    var res = await fetch(QBO_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + credentials,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        },
        body: 'grant_type=authorization_code&code=' + encodeURIComponent(code) +
              '&redirect_uri=' + encodeURIComponent(callbackUrl)
    });

    if (!res.ok) {
        var text = await res.text();
        return new Response(getOAuthCallbackHTML(false, 'Token exchange failed: ' + text), {
            headers: { 'Content-Type': 'text/html' }
        });
    }

    var tokenData = await res.json();

    // Get company name
    var companyName = 'Connected';
    try {
        var qboBase = env.QBO_ENVIRONMENT === 'production'
            ? 'https://quickbooks.api.intuit.com/v3/company'
            : 'https://sandbox-quickbooks.api.intuit.com/v3/company';
        var infoRes = await fetch(qboBase + '/' + realmId + '/companyinfo/' + realmId, {
            headers: {
                'Authorization': 'Bearer ' + tokenData.access_token,
                'Accept': 'application/json'
            }
        });
        if (infoRes.ok) {
            var info = await infoRes.json();
            companyName = info.CompanyInfo?.CompanyName || 'Connected';
        }
    } catch (e) {
        // Ignore error, just use 'Connected'
    }

    // Store tokens
    await env.SETTINGS.put('qbo_tokens:' + stateData.userId, JSON.stringify({
        refreshToken: tokenData.refresh_token,
        realmId: realmId,
        connectedAt: new Date().toISOString(),
        lastRefreshed: new Date().toISOString(),
        accessToken: tokenData.access_token,
        accessTokenExpiry: Date.now() + (tokenData.expires_in * 1000),
        companyName: companyName
    }));

    return new Response(getOAuthCallbackHTML(true, companyName), {
        headers: { 'Content-Type': 'text/html' }
    });
}

async function handleQboDisconnect(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;

    await env.SETTINGS.delete('qbo_tokens:' + auth.user.id);

    return jsonResponse({ ok: true, message: 'QuickBooks disconnected' }, 200, origin);
}

async function handleQboStatus(request, env, origin) {
    var auth = await checkSession(request, env, origin);
    if (auth.error) return auth.error;

    var tokens = await env.SETTINGS.get('qbo_tokens:' + auth.user.id, 'json');

    return jsonResponse({
        connected: !!tokens,
        companyName: tokens?.companyName || null,
        connectedAt: tokens?.connectedAt || null
    }, 200, origin);
}

function getOAuthCallbackHTML(success, companyName) {
    if (success) {
        return '<!DOCTYPE html><html><head><title>QuickBooks Connected</title>' +
            '<style>body{font-family:system-ui;text-align:center;padding:40px;background:#060606;color:#fff;}' +
            'h2{color:#4ade80;margin-bottom:10px;}p{color:#888;}</style></head><body>' +
            '<h2>✓ QuickBooks Connected!</h2>' +
            '<p>Company: <strong>' + escapeHtml(companyName) + '</strong></p>' +
            '<p style="color:#888;font-size:14px;">You can close this window.</p>' +
            '<script>if(window.opener){' +
            'window.opener.postMessage({type:"qbo-oauth-success",companyName:"' + escapeHtml(companyName) + '"},"*");' +
            'setTimeout(()=>window.close(),1000);}</script></body></html>';
    } else {
        return '<!DOCTYPE html><html><head><title>Connection Failed</title>' +
            '<style>body{font-family:system-ui;text-align:center;padding:40px;background:#060606;color:#fff;}' +
            'h2{color:#f55;margin-bottom:10px;}p{color:#888;}</style></head><body>' +
            '<h2>✗ Connection Failed</h2>' +
            '<p>' + escapeHtml(companyName) + '</p>' +
            '<p style="color:#888;font-size:14px;">Please close this window and try again.</p></body></html>';
    }
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ===== MAIN REQUEST HANDLER =====

export default {
    async fetch(request, env) {
        var origin = request.headers.get('Origin') || '';

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        var url = new URL(request.url);
        var path = url.pathname;

        // Public ping endpoint (no auth required)
        if (path === '/ping' && request.method === 'GET') {
            return jsonResponse({ ok: true, service: 'QuickBooks OAuth Proxy', environment: env.QBO_ENVIRONMENT || 'not configured' }, 200, origin);
        }

        // OAuth routes
        if (path === '/auth/qbo/initiate' && request.method === 'POST') {
            return handleQboInitiate(request, env, origin);
        }
        if (path === '/auth/qbo/callback' && request.method === 'GET') {
            return handleQboCallback(request, env, origin);
        }
        if (path === '/auth/qbo/disconnect' && request.method === 'POST') {
            return handleQboDisconnect(request, env, origin);
        }
        if (path === '/auth/qbo/status' && request.method === 'GET') {
            return handleQboStatus(request, env, origin);
        }

        // All data routes require GET method
        if (request.method !== 'GET') {
            return jsonResponse({ error: 'Method not allowed' }, 405, origin);
        }

        // Check required secrets
        if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) {
            return jsonResponse({ error: 'QuickBooks app credentials not configured' }, 500, origin);
        }

        // All data routes require session authentication
        var auth = await checkSession(request, env, origin);
        if (auth.error) return auth.error;

        try {
            // Get user's access token and realm ID
            var tokenData = await getQboAccessToken(auth.user.id, env);
            var accessToken = tokenData.accessToken;
            var realmId = tokenData.realmId;

            // Determine QB API base URL
            var qboBase = env.QBO_ENVIRONMENT === 'production'
                ? 'https://quickbooks.api.intuit.com/v3/company'
                : 'https://sandbox-quickbooks.api.intuit.com/v3/company';

            // Helper to call QB API with user's tokens
            async function qboApiGet(endpoint) {
                var res = await fetch(qboBase + '/' + realmId + '/' + endpoint, {
                    method: 'GET',
                    headers: {
                        'Authorization': 'Bearer ' + accessToken,
                        'Accept': 'application/json'
                    }
                });
                if (!res.ok) {
                    var text = await res.text();
                    throw new Error('QBO API error ' + res.status + ': ' + text);
                }
                return res.json();
            }

            async function qboApiQuery(query) {
                return qboApiGet('query?query=' + encodeURIComponent(query));
            }

            // Route handlers
            if (path === '/companyinfo') {
                var info = await qboApiGet('companyinfo/' + realmId);
                var companyName = info?.CompanyInfo?.CompanyName || 'Connected';
                return jsonResponse({ ok: true, companyName: companyName }, 200, origin);

            } else if (path === '/accounts') {
                var data = await qboApiQuery(
                    "SELECT * FROM Account WHERE AccountType IN ('Bank', 'Credit Card') AND Active = true MAXRESULTS 50"
                );
                var raw = (data.QueryResponse?.Account) || [];
                var accounts = [];
                for (var i = 0; i < raw.length; i++) {
                    var a = raw[i];
                    accounts.push({
                        id: a.Id,
                        name: a.Name,
                        type: a.AccountType,
                        subType: a.AccountSubType || '',
                        balance: parseFloat(a.CurrentBalance) || 0,
                        currency: a.CurrencyRef?.value || 'USD'
                    });
                }
                return jsonResponse({ accounts: accounts }, 200, origin);

            } else if (path === '/expenses') {
                var start = url.searchParams.get('start') || '2024-01-01';
                var end = url.searchParams.get('end') || new Date().toISOString().split('T')[0];

                var [purchaseData, billData] = await Promise.all([
                    qboApiQuery("SELECT * FROM Purchase WHERE TxnDate >= '" + start + "' AND TxnDate <= '" + end + "' ORDERBY TxnDate DESC MAXRESULTS 200"),
                    qboApiQuery("SELECT * FROM Bill WHERE TxnDate >= '" + start + "' AND TxnDate <= '" + end + "' ORDERBY TxnDate DESC MAXRESULTS 200")
                ]);

                var rawPurchases = (purchaseData.QueryResponse?.Purchase) || [];
                var rawBills = (billData.QueryResponse?.Bill) || [];
                var expenses = [];

                for (var p = 0; p < rawPurchases.length; p++) {
                    var pur = rawPurchases[p];
                    var vendor = pur.EntityRef?.name || '';
                    var category = '';
                    if (pur.Line && pur.Line.length > 0) {
                        var detail = pur.Line[0].AccountBasedExpenseLineDetail;
                        if (detail?.AccountRef) category = detail.AccountRef.name || '';
                    }
                    expenses.push({
                        id: pur.Id,
                        date: pur.TxnDate,
                        vendor: vendor,
                        amount: parseFloat(pur.TotalAmt) || 0,
                        category: category,
                        type: 'purchase',
                        accountName: pur.AccountRef?.name || ''
                    });
                }

                for (var b = 0; b < rawBills.length; b++) {
                    var bill = rawBills[b];
                    expenses.push({
                        id: bill.Id,
                        date: bill.TxnDate,
                        vendor: bill.VendorRef?.name || '',
                        amount: parseFloat(bill.TotalAmt) || 0,
                        category: 'Bill',
                        type: 'bill',
                        accountName: ''
                    });
                }

                expenses.sort(function(a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : 0; });
                return jsonResponse({ expenses: expenses }, 200, origin);

            } else if (path === '/invoices') {
                var data = await qboApiQuery("SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS 100");
                var rawInvoices = (data.QueryResponse?.Invoice) || [];
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
                        customer: r.CustomerRef?.name || '',
                        amount: total,
                        balance: balance,
                        dueDate: r.DueDate || '',
                        status: status,
                        docNumber: r.DocNumber || ''
                    });
                }
                return jsonResponse({ invoices: invoices }, 200, origin);

            } else if (path === '/transactions') {
                var accountId = url.searchParams.get('accountId');
                if (!accountId) {
                    return jsonResponse({ error: 'accountId required' }, 400, origin);
                }
                var data = await qboApiQuery("SELECT * FROM Purchase WHERE AccountRef = '" + accountId + "' ORDERBY TxnDate DESC MAXRESULTS 100");
                var rawTxns = (data.QueryResponse?.Purchase) || [];
                var transactions = [];
                for (var t = 0; t < rawTxns.length; t++) {
                    var txn = rawTxns[t];
                    transactions.push({
                        id: txn.Id,
                        date: txn.TxnDate,
                        vendor: txn.EntityRef?.name || '',
                        amount: parseFloat(txn.TotalAmt) || 0,
                        type: txn.PaymentType || 'Other'
                    });
                }
                return jsonResponse({ transactions: transactions }, 200, origin);

            } else {
                return jsonResponse({ error: 'Unknown endpoint' }, 404, origin);
            }
        } catch (e) {
            return jsonResponse({ error: e.message }, 502, origin);
        }
    }
};
