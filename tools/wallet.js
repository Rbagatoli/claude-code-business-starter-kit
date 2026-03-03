// ===== ION MINING GROUP — Watch-Only Wallet =====

var liveBtcPrice = null;
var refreshInterval = null;
var strikeConnected = false;
var strikeBalances = null;
var strikeTransactions = [];
var strikeOnchainAddress = null;

initNav('wallet');

// ===== STRIKE AUTH MODULE =====
var StrikeAuth = (function() {
    var SESSION_KEY = 'ionStrikeSession';
    var USER_KEY = 'ionStrikeUser';

    function getToken() {
        return localStorage.getItem(SESSION_KEY) || '';
    }

    function getUser() {
        try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch(e) { return null; }
    }

    function isLoggedIn() {
        return !!getToken();
    }

    function saveSession(token, user) {
        localStorage.setItem(SESSION_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    }

    function clearSession() {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(USER_KEY);
    }

    function hasStrike() {
        var u = getUser();
        return u && u.strikeConnected;
    }

    return {
        getToken: getToken,
        getUser: getUser,
        isLoggedIn: isLoggedIn,
        hasStrike: hasStrike,
        saveSession: saveSession,
        clearSession: clearSession
    };
})();

// ===== FIREBASE AUTO-LOGIN =====
var _walletAuthResolved = false;

async function autoLoginWithFirebase() {
    // Already have a valid worker session? Just use it.
    if (StrikeAuth.isLoggedIn()) {
        showAuthenticatedUI();
        if (StrikeAuth.hasStrike()) {
            hideConnectStrikePrompt();
        } else {
            showConnectStrikePrompt();
        }
        await loadAndRefreshWallet();
        return;
    }

    // Need Firebase user to get an ID token
    var fbUser = (typeof IonAuth !== 'undefined') ? IonAuth.getUser() : null;
    if (!fbUser) {
        showSignInPrompt();
        return;
    }

    // Exchange Firebase ID token for worker session
    try {
        var idToken = await fbUser.getIdToken(true); // force refresh
        var data = await StrikeAPI.firebaseLogin(idToken);
        if (data && data.ok) {
            StrikeAuth.saveSession(data.token, data.user);
            showAuthenticatedUI();
            if (data.user.strikeConnected) {
                hideConnectStrikePrompt();
            } else {
                showConnectStrikePrompt();
            }
            await loadAndRefreshWallet();
        } else {
            console.warn('[Wallet] Firebase login failed:', data);
            showSignInPrompt(data && data.error ? data.error + (data.message ? ': ' + data.message : '') : 'Login failed');
        }
    } catch(e) {
        console.warn('[Wallet] Firebase auto-login error:', e);
        showSignInPrompt('Auto-login error: ' + (e.message || e));
    }
}

// ===== INIT =====
(async function() {
    var data = await fetchLiveMarketData();
    liveBtcPrice = data.price || 96000;
    window.onCurrencyChange = function() { liveBtcPrice = window.liveBtcPrice || liveBtcPrice; renderWallet(); };
    loadStrikeSettings();

    // Let Firebase onAuthChange drive the wallet auth (avoids race condition)
    if (strikeConnected && typeof IonAuth !== 'undefined') {
        IonAuth.onAuthChange(function(fbUser) {
            _walletAuthResolved = true;
            if (fbUser) {
                autoLoginWithFirebase();
            } else {
                // Firebase says no user — show sign-in
                if (StrikeAuth.isLoggedIn()) {
                    clearAllWalletState();
                } else {
                    showSignInPrompt();
                }
            }
        });
    } else if (strikeConnected) {
        // No Firebase at all — show sign-in
        showSignInPrompt();
    }

    await loadAndRefreshWallet();
    startAutoRefresh();
})();

// Listen for sync engine wallet updates (cross-device)
window.ionWalletSyncRefresh = function() {
    loadAndRefreshWallet();
};

// ===== WALLET DATA MODULE =====
var WalletData = (function() {
    var KEY = 'ionMiningWallet';

    function getData() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return defaultData();
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.addresses) return defaultData();
            return parsed;
        } catch(e) { return defaultData(); }
    }

    function defaultData() {
        return { _v: 1, addresses: [] };
    }

    function saveData(data) {
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch(e) {}
        if (typeof SyncEngine !== 'undefined') SyncEngine.save('wallet', data);
    }

    function addAddress(address, label) {
        var data = getData();
        var entry = {
            id: 'addr_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            address: address,
            label: label || address.substring(0, 12) + '...',
            dateAdded: new Date().toISOString(),
            lastBalance: 0,
            lastTxCount: 0,
            lastFetched: null
        };
        data.addresses.push(entry);
        saveData(data);
        return entry;
    }

    function removeAddress(id) {
        var data = getData();
        data.addresses = data.addresses.filter(function(a) { return a.id !== id; });
        saveData(data);
    }

    function updateAddressData(id, balance, txCount) {
        var data = getData();
        for (var i = 0; i < data.addresses.length; i++) {
            if (data.addresses[i].id === id) {
                data.addresses[i].lastBalance = balance;
                data.addresses[i].lastTxCount = txCount;
                data.addresses[i].lastFetched = new Date().toISOString();
                break;
            }
        }
        saveData(data);
    }

    return {
        getData: getData,
        addAddress: addAddress,
        removeAddress: removeAddress,
        updateAddressData: updateAddressData
    };
})();

// ===== STRIKE API MODULE (via Cloudflare Worker proxy) =====
var StrikeAPI = (function() {
    function getProxyUrl() {
        var settings = FleetData.getSettings();
        return (settings.strike && settings.strike.proxyUrl) || '';
    }

    function authHeaders() {
        var hdrs = { 'Content-Type': 'application/json' };
        var token = StrikeAuth.getToken();
        if (token) hdrs['Authorization'] = 'Bearer ' + token;
        return hdrs;
    }

    function handleAuthError(res) {
        if (res.status === 401) {
            StrikeAuth.clearSession();
            // Try to re-auth with Firebase, or show sign-in prompt
            if (typeof IonAuth !== 'undefined' && IonAuth.isSignedIn()) {
                autoLoginWithFirebase();
            } else {
                showSignInPrompt();
            }
            return true;
        }
        return false;
    }

    async function apiFetch(route) {
        var proxy = getProxyUrl();
        if (!proxy) return { error: 'No proxy URL configured' };
        try {
            var res = await fetch(proxy.replace(/\/$/, '') + route, {
                headers: authHeaders()
            });
            if (handleAuthError(res)) return { error: 'Session expired', loginRequired: true };
            if (res.status === 403) {
                var errData = await res.json().catch(function() { return {}; });
                if (errData.strikeNotConnected) {
                    showConnectStrikePrompt();
                    return { error: 'Strike not connected', strikeNotConnected: true };
                }
                return { error: errData.error || 'Access denied' };
            }
            if (!res.ok) return { error: 'HTTP ' + res.status };
            return await res.json();
        } catch(e) {
            return { error: e.message || 'Network error' };
        }
    }

    async function apiPost(route, body) {
        var proxy = getProxyUrl();
        if (!proxy) return { error: 'No proxy URL configured' };
        try {
            var res = await fetch(proxy.replace(/\/$/, '') + route, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(body)
            });
            if (handleAuthError(res)) return { error: 'Session expired', loginRequired: true };
            var data = await res.json();
            if (!res.ok) {
                if (data.strikeNotConnected) {
                    showConnectStrikePrompt();
                    return { error: 'Strike not connected', strikeNotConnected: true };
                }
                var errMsg = data.error || data.message || data.title || '';
                if (data.data && data.data.validationErrors) errMsg += ' ' + JSON.stringify(data.data.validationErrors);
                if (!errMsg) errMsg = JSON.stringify(data);
                return { error: errMsg, totpRequired: data.totpRequired, pinRequired: data.pinRequired };
            }
            return data;
        } catch(e) {
            return { error: e.message || 'Network error' };
        }
    }

    async function apiPatch(route, body, totpCode, pinCode) {
        var proxy = getProxyUrl();
        if (!proxy) return { error: 'No proxy URL configured' };
        try {
            var hdrs = authHeaders();
            if (totpCode) hdrs['X-Dashboard-TOTP'] = totpCode;
            if (pinCode) hdrs['X-Dashboard-Pin'] = pinCode;
            var res = await fetch(proxy.replace(/\/$/, '') + route, {
                method: 'PATCH',
                headers: hdrs,
                body: JSON.stringify(body || {})
            });
            if (handleAuthError(res)) return { error: 'Session expired', loginRequired: true };
            var data = await res.json();
            if (!res.ok) {
                if (data.strikeNotConnected) {
                    showConnectStrikePrompt();
                    return { error: 'Strike not connected', strikeNotConnected: true };
                }
                return { error: data.error || data.message || 'HTTP ' + res.status, totpRequired: data.totpRequired, pinRequired: data.pinRequired };
            }
            return data;
        } catch(e) {
            return { error: e.message || 'Network error' };
        }
    }

    // Public no-auth fetch (for testing connection before login)
    async function apiPublicFetch(route) {
        var proxy = getProxyUrl();
        if (!proxy) return { error: 'No proxy URL configured' };
        try {
            var res = await fetch(proxy.replace(/\/$/, '') + route);
            if (!res.ok) return { error: 'HTTP ' + res.status };
            return await res.json();
        } catch(e) {
            return { error: e.message || 'Network error' };
        }
    }

    // Firebase login — exchange Firebase ID token for worker session
    async function firebaseLogin(idToken) {
        var proxy = getProxyUrl();
        if (!proxy) return { error: 'No proxy URL configured' };
        try {
            var res = await fetch(proxy.replace(/\/$/, '') + '/auth/firebase-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken: idToken })
            });
            var data = await res.json();
            if (data.ok && data.token) {
                StrikeAuth.saveSession(data.token, data.user);
            }
            return data;
        } catch(e) {
            return { error: e.message || 'Network error' };
        }
    }

    async function logout() {
        var proxy = getProxyUrl();
        if (proxy) {
            try {
                await fetch(proxy.replace(/\/$/, '') + '/auth/logout', {
                    method: 'POST',
                    headers: authHeaders()
                });
            } catch(e) {}
        }
        StrikeAuth.clearSession();
    }

    async function getBalances() { return await apiFetch('/balances'); }
    async function getDeposits() { return await apiFetch('/deposits'); }
    async function getPayouts() { return await apiFetch('/payouts'); }
    async function getReceives() { return await apiFetch('/receives'); }
    async function getInvoices() { return await apiFetch('/invoices'); }

    async function testConnection() {
        return await apiPublicFetch('/ping');
    }

    async function sendQuoteLightning(body) { return await apiPost('/send/quote/lightning', body); }
    async function sendQuoteOnchain(body) { return await apiPost('/send/quote/onchain', body); }
    async function getOnchainTiers(body) { return await apiPost('/send/onchain-tiers', body); }

    async function executeSend(quoteId, totpCode, pinCode) {
        return await apiPatch('/send/execute/' + quoteId, {}, totpCode, pinCode);
    }

    async function createInvoice(body) { return await apiPost('/invoice/create', body); }
    async function createInvoiceQuote(invoiceId) { return await apiPost('/invoice/' + invoiceId + '/quote', {}); }
    async function getInvoice(invoiceId) { return await apiFetch('/invoice/' + invoiceId); }
    async function shareInvoice(body) { return await apiPost('/invoice/share', body); }

    async function setPin(pin) { return await apiPost('/auth/set-pin', { pin: pin }); }

    async function getOnchainAddress() { return await apiPost('/receive/onchain-address', {}); }
    async function getSendStatus(paymentId) { return await apiFetch('/send/status/' + paymentId); }

    // Strike connection
    async function connectStrike(apiKey) { return await apiPost('/auth/connect-strike', { apiKey: apiKey }); }
    async function disconnectStrikeAccount() { return await apiPost('/auth/disconnect-strike', {}); }
    async function updateSettings(settings) { return await apiPatch('/auth/settings', settings); }

    return {
        getProxyUrl: getProxyUrl,
        getBalances: getBalances,
        getDeposits: getDeposits,
        getPayouts: getPayouts,
        getReceives: getReceives,
        getInvoices: getInvoices,
        testConnection: testConnection,
        sendQuoteLightning: sendQuoteLightning,
        sendQuoteOnchain: sendQuoteOnchain,
        getOnchainTiers: getOnchainTiers,
        executeSend: executeSend,
        createInvoice: createInvoice,
        createInvoiceQuote: createInvoiceQuote,
        getInvoice: getInvoice,
        shareInvoice: shareInvoice,
        setPin: setPin,
        getOnchainAddress: getOnchainAddress,
        getSendStatus: getSendStatus,
        firebaseLogin: firebaseLogin,
        logout: logout,
        apiPost: apiPost,
        connectStrike: connectStrike,
        disconnectStrikeAccount: disconnectStrikeAccount,
        updateSettings: updateSettings
    };
})();

// ===== SIGN-IN PROMPT UI =====
function showSignInPrompt(errorMsg) {
    var prompt = document.getElementById('signInPrompt');
    if (prompt) prompt.style.display = '';
    var errEl = document.getElementById('signInError');
    if (errEl) errEl.textContent = errorMsg || '';
    var authBar = document.getElementById('userAuthBar');
    if (authBar) authBar.style.display = 'none';
    var content = document.getElementById('walletContent');
    if (content) content.style.display = 'none';
    hideConnectStrikePrompt();
    updateSendButton();
    update2FAButton();
    updateAccountButtons();
}

function hideSignInPrompt() {
    var prompt = document.getElementById('signInPrompt');
    if (prompt) prompt.style.display = 'none';
}

function showAuthenticatedUI() {
    hideSignInPrompt();
    var content = document.getElementById('walletContent');
    if (content) content.style.display = '';
    var authBar = document.getElementById('userAuthBar');
    if (authBar) {
        authBar.style.display = '';
        var nameEl = document.getElementById('authUsername');
        if (nameEl) {
            // Show Firebase display name or email
            var fbUser = (typeof IonAuth !== 'undefined') ? IonAuth.getUser() : null;
            if (fbUser) {
                nameEl.textContent = fbUser.displayName || fbUser.email || 'User';
            } else {
                var user = StrikeAuth.getUser();
                nameEl.textContent = (user && user.email) || 'User';
            }
        }
    }
    updateSendButton();
    update2FAButton();
    updateAccountButtons();
}

function updateAccountButtons() {
    var settingsBtn = document.getElementById('btnAccountSettings');
    var loggedIn = strikeConnected && StrikeAuth.isLoggedIn();
    if (settingsBtn) settingsBtn.style.display = loggedIn ? '' : 'none';
}

// Clear all wallet state (on sign-out)
function clearAllWalletState() {
    StrikeAPI.logout();
    strikeBalances = null;
    strikeTransactions = [];
    activeSendQuote = null;
    totpEnabled = false;
    clearQuoteExpiry();
    // Close all open slide panels
    var panels = document.querySelectorAll('.slide-panel.open');
    for (var i = 0; i < panels.length; i++) {
        panels[i].classList.remove('open');
    }
    hideConnectStrikePrompt();
    showSignInPrompt();
    renderWallet();
    renderTransactionHistory();
}

// ===== CONNECT STRIKE PROMPT =====
function showConnectStrikePrompt() {
    var prompt = document.getElementById('connectStrikePrompt');
    if (prompt) prompt.style.display = '';
}

function hideConnectStrikePrompt() {
    var prompt = document.getElementById('connectStrikePrompt');
    if (prompt) prompt.style.display = 'none';
}

// ===== STRIKE SETTINGS =====
function loadStrikeSettings() {
    var settings = FleetData.getSettings();
    if (settings.strike && settings.strike.proxyUrl && settings.strike.enabled) {
        document.getElementById('strikeProxyUrl').value = settings.strike.proxyUrl;
        strikeConnected = true;
        updateStrikeStatus('Connected');
    }
    updateSendButton();
    update2FAButton();
    updateAccountButtons();
}

function updateStrikeStatus(label) {
    var badge = document.getElementById('strikeStatusBadge');
    if (label) {
        badge.textContent = 'Strike: ' + label;
        badge.className = 'status-badge status-connected';
    } else {
        badge.textContent = 'Strike: Not Connected';
        badge.className = 'status-badge status-disconnected';
    }
}

// ===== STRIKE DATA FETCH =====
async function fetchStrikeData() {
    if (!strikeConnected) return;
    if (!StrikeAuth.isLoggedIn()) return;

    var balResult = await StrikeAPI.getBalances();
    if (balResult && !balResult.error) {
        strikeBalances = balResult;
        var settings = FleetData.getSettings();
        if (!settings.strike) settings.strike = {};
        settings.strike.lastSync = new Date().toISOString();
        FleetData.saveSettings(settings);
    } else if (balResult && balResult.loginRequired) {
        return;
    } else if (balResult && balResult.strikeNotConnected) {
        return; // Prompt already shown
    } else {
        console.warn('[Wallet] Strike balance fetch error:', balResult.error);
    }

    var strikeTxs = [];
    try {
        var [deposits, payouts, receives] = await Promise.all([
            StrikeAPI.getDeposits(),
            StrikeAPI.getPayouts(),
            StrikeAPI.getReceives()
        ]);

        if (deposits && !deposits.error && Array.isArray(deposits.items || deposits)) {
            var depItems = deposits.items || deposits;
            for (var d = 0; d < depItems.length; d++) {
                var dep = depItems[d];
                strikeTxs.push({
                    source: 'Strike',
                    sourceType: 'Deposit',
                    timestamp: new Date(dep.created || dep.completedAt || dep.createdAt).getTime() / 1000,
                    amount: parseStrikeAmount(dep.amount || dep.amountReceived || dep),
                    status: dep.state || dep.status || 'completed',
                    id: dep.depositId || dep.id || ''
                });
            }
        }

        if (payouts && !payouts.error && Array.isArray(payouts.items || payouts)) {
            var payItems = payouts.items || payouts;
            for (var p = 0; p < payItems.length; p++) {
                var pay = payItems[p];
                strikeTxs.push({
                    source: 'Strike',
                    sourceType: 'Payout',
                    timestamp: new Date(pay.created || pay.completedAt || pay.createdAt).getTime() / 1000,
                    amount: -parseStrikeAmount(pay.amount || pay.amountPaid || pay),
                    status: pay.state || pay.status || 'completed',
                    id: pay.payoutId || pay.id || ''
                });
            }
        }

        if (receives && !receives.error && Array.isArray(receives.items || receives)) {
            var recItems = receives.items || receives;
            for (var r = 0; r < recItems.length; r++) {
                var rec = recItems[r];
                strikeTxs.push({
                    source: 'Strike',
                    sourceType: 'Receive',
                    timestamp: new Date(rec.created || rec.completedAt || rec.createdAt).getTime() / 1000,
                    amount: parseStrikeAmount(rec.amountReceived || rec.amountCredited || rec.amount || rec),
                    status: rec.state || rec.status || 'completed',
                    id: rec.receiveId || rec.id || ''
                });
            }
        }
    } catch(e) {
        console.warn('[Wallet] Strike transaction fetch error:', e);
    }

    strikeTransactions = strikeTxs;
}

function parseStrikeAmount(amountObj) {
    if (!amountObj) return 0;
    if (typeof amountObj === 'object') {
        var val = parseFloat(amountObj.amount) || 0;
        var cur = (amountObj.currency || '').toUpperCase();
        if (cur === 'BTC') return val;
        if (cur === 'USD' && liveBtcPrice > 0) return val / liveBtcPrice;
        return val;
    }
    return parseFloat(amountObj) || 0;
}

function getStrikeBtcBalance() {
    if (!strikeBalances) return 0;
    var balArr = Array.isArray(strikeBalances) ? strikeBalances : (strikeBalances.items || [strikeBalances]);
    for (var i = 0; i < balArr.length; i++) {
        if (balArr[i].currency === 'BTC') {
            return parseFloat(balArr[i].amount || balArr[i].available || 0);
        }
    }
    return 0;
}

function getStrikeUsdBalance() {
    if (!strikeBalances) return 0;
    var balArr = Array.isArray(strikeBalances) ? strikeBalances : (strikeBalances.items || [strikeBalances]);
    for (var i = 0; i < balArr.length; i++) {
        if (balArr[i].currency === 'USD') {
            return parseFloat(balArr[i].amount || balArr[i].available || 0);
        }
    }
    return 0;
}

// ===== MEMPOOL.SPACE API =====
async function fetchAddressData(address) {
    try {
        var res = await fetch('https://mempool.space/api/address/' + address);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        var funded = (data.chain_stats && data.chain_stats.funded_txo_sum) || 0;
        var spent = (data.chain_stats && data.chain_stats.spent_txo_sum) || 0;
        var mFunded = (data.mempool_stats && data.mempool_stats.funded_txo_sum) || 0;
        var mSpent = (data.mempool_stats && data.mempool_stats.spent_txo_sum) || 0;
        var balance = (funded - spent + mFunded - mSpent) / 100000000;
        var txCount = ((data.chain_stats && data.chain_stats.tx_count) || 0) +
                      ((data.mempool_stats && data.mempool_stats.tx_count) || 0);
        return { balance: balance, txCount: txCount };
    } catch(e) {
        console.warn('Wallet: failed to fetch address data for', address, e);
        return { balance: 0, txCount: 0, error: true };
    }
}

async function fetchAddressTxs(address) {
    try {
        var res = await fetch('https://mempool.space/api/address/' + address + '/txs');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch(e) {
        console.warn('Wallet: failed to fetch TXs for', address, e);
        return [];
    }
}

// ===== LOAD & REFRESH =====
async function loadAndRefreshWallet() {
    var data = WalletData.getData();

    if (strikeConnected) {
        await fetchStrikeData();
    }

    if (data.addresses.length === 0 && !strikeConnected) {
        renderWallet();
        renderEmptyTxTable();
        return;
    }

    if (data.addresses.length > 0) {
        var promises = [];
        for (var i = 0; i < data.addresses.length; i++) {
            promises.push(fetchAddressData(data.addresses[i].address));
        }
        var results = await Promise.all(promises);

        for (var j = 0; j < data.addresses.length; j++) {
            if (!results[j].error) {
                WalletData.updateAddressData(data.addresses[j].id, results[j].balance, results[j].txCount);
            }
        }
    }

    renderWallet();
    await renderTransactionHistory();
}

// ===== RENDER SUMMARY + ADDRESS CARDS =====
function renderWallet() {
    var data = WalletData.getData();

    var totalBTC = 0;
    var totalTxCount = 0;
    for (var i = 0; i < data.addresses.length; i++) {
        totalBTC += data.addresses[i].lastBalance;
        totalTxCount += data.addresses[i].lastTxCount;
    }

    if (strikeConnected && strikeBalances) {
        totalBTC += getStrikeBtcBalance();
        totalTxCount += strikeTransactions.length;
    }

    document.getElementById('walletTotalBTC').textContent = fmtBTC(totalBTC, 8);
    document.getElementById('walletTotalUSD').textContent = fmtUSD(totalBTC * liveBtcPrice + (strikeConnected ? getStrikeUsdBalance() : 0));
    document.getElementById('walletPriceLabel').textContent = 'at ' + fmtUSD(liveBtcPrice);
    document.getElementById('walletAddressCount').textContent = data.addresses.length + (strikeConnected ? ' + Strike' : '');
    document.getElementById('walletTotalTxCount').textContent = totalTxCount;

    var now = new Date();
    document.getElementById('walletLastUpdate').textContent =
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');

    renderAddressCards(data);
}

function renderAddressCards(data) {
    var container = document.getElementById('addressCardsGrid');
    var html = '';

    if (strikeConnected && strikeBalances) {
        var strikeBtc = getStrikeBtcBalance();
        var strikeUsd = getStrikeUsdBalance();
        var settings = FleetData.getSettings();
        var lastSync = settings.strike && settings.strike.lastSync;
        var syncLabel = lastSync ? new Date(lastSync).toLocaleTimeString() : 'just now';

        html += '<div class="miner-card strike-card">' +
            '<div class="miner-card-header">' +
                '<div class="miner-card-model"><span class="strike-icon">&#9889;</span> Strike Account</div>' +
                '<span class="status-badge status-connected" style="font-size:10px; padding:2px 8px;">Connected</span>' +
            '</div>' +
            '<div class="miner-card-stats">' +
                '<div class="miner-card-stat"><div class="stat-label">BTC Balance</div><div class="stat-value" style="color:#f7931a;">' + fmtBTC(strikeBtc, 8) + ' BTC</div></div>' +
                '<div class="miner-card-stat"><div class="stat-label">USD Balance</div><div class="stat-value">' + fmtUSD(strikeUsd) + '</div></div>' +
                '<div class="miner-card-stat"><div class="stat-label">BTC in USD</div><div class="stat-value">' + fmtUSD(strikeBtc * liveBtcPrice) + '</div></div>' +
                '<div class="miner-card-stat"><div class="stat-label">Last Synced</div><div class="stat-value" style="font-size:11px;">' + syncLabel + '</div></div>' +
                (function() {
                    var strikeAddr = '';
                    for (var sd = 0; sd < data.addresses.length; sd++) {
                        if (data.addresses[sd].label && data.addresses[sd].label.toLowerCase().indexOf('strike') !== -1) {
                            strikeAddr = data.addresses[sd].address; break;
                        }
                    }
                    if (strikeAddr) {
                        return '<div class="miner-card-stat" style="grid-column:1/-1;">' +
                            '<div class="stat-label">Deposit Address</div>' +
                            '<div style="display:flex; align-items:center; gap:6px;">' +
                                '<div class="stat-value" style="font-family:monospace; font-size:10px; word-break:break-all; line-height:1.4;">' + strikeAddr + '</div>' +
                                '<button class="copy-addr-btn" data-addr="' + strikeAddr + '" style="flex-shrink:0; background:rgba(139,92,246,0.15); border:1px solid rgba(139,92,246,0.3); color:#a78bfa; border-radius:4px; padding:3px 8px; font-size:10px; cursor:pointer;">Copy</button>' +
                            '</div>' +
                        '</div>';
                    }
                    return '<div class="miner-card-stat" style="grid-column:1/-1;">' +
                        '<div class="stat-label">Deposit Address</div>' +
                        '<div class="stat-value" style="font-size:10px; color:#666;">Add via + Add Address (label it &quot;Strike&quot;)</div>' +
                    '</div>';
                })() +
            '</div>' +
            '<div class="miner-card-actions">' +
                '<button onclick="fetchStrikeData().then(function(){renderWallet();})">Sync</button>' +
                '<button class="delete" onclick="disconnectStrike()">Disconnect</button>' +
            '</div>' +
        '</div>';
    }

    if (data.addresses.length === 0 && !html) {
        container.innerHTML = '<div class="empty-state" style="padding:20px;"><p>No addresses added yet</p><div class="hint">Click "+ Add Address" or connect Strike to start monitoring</div></div>';
        return;
    }

    for (var i = 0; i < data.addresses.length; i++) {
        var a = data.addresses[i];
        html += '<div class="miner-card">' +
            '<div class="miner-card-header">' +
                '<div class="miner-card-model">' + escapeHtml(a.label) + '</div>' +
                '<span class="status-badge" style="font-size:10px; padding:2px 8px; background:rgba(247,147,26,0.15); color:#f7931a;">On-chain</span>' +
            '</div>' +
            '<div class="miner-card-stats">' +
                '<div class="miner-card-stat" style="grid-column:1/-1;">' +
                    '<div class="stat-label">Address</div>' +
                    '<div style="display:flex; align-items:center; gap:6px;">' +
                        '<div class="stat-value" style="font-family:monospace; font-size:10px; word-break:break-all; line-height:1.4;">' + escapeHtml(a.address) + '</div>' +
                        '<button class="copy-addr-btn" data-addr="' + a.address + '" style="flex-shrink:0; background:rgba(247,147,26,0.15); border:1px solid rgba(247,147,26,0.3); color:#f7931a; border-radius:4px; padding:3px 8px; font-size:10px; cursor:pointer;">Copy</button>' +
                    '</div>' +
                '</div>' +
                '<div class="miner-card-stat"><div class="stat-label">Balance</div><div class="stat-value" style="color:#f7931a;">' + fmtBTC(a.lastBalance, 8) + ' BTC</div></div>' +
                '<div class="miner-card-stat"><div class="stat-label">USD Value</div><div class="stat-value">' + fmtUSD(a.lastBalance * liveBtcPrice) + '</div></div>' +
                '<div class="miner-card-stat"><div class="stat-label">Transactions</div><div class="stat-value">' + a.lastTxCount + '</div></div>' +
            '</div>' +
            '<div class="miner-card-actions">' +
                '<button onclick="window.open(\'https://mempool.space/address/' + a.address + '\', \'_blank\')">Explorer</button>' +
                '<button class="delete" data-id="' + a.id + '">Remove</button>' +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;

    var copyBtns = container.querySelectorAll('.copy-addr-btn');
    for (var c = 0; c < copyBtns.length; c++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                copyToClipboard(btn.getAttribute('data-addr'), btn);
            });
        })(copyBtns[c]);
    }

    var btns = container.querySelectorAll('.delete[data-id]');
    for (var j = 0; j < btns.length; j++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                if (confirm('Remove this address from watch list?')) {
                    WalletData.removeAddress(btn.getAttribute('data-id'));
                    loadAndRefreshWallet();
                }
            });
        })(btns[j]);
    }
}

// ===== RENDER TRANSACTION HISTORY =====
function renderEmptyTxTable() {
    document.getElementById('txHistoryBody').innerHTML =
        '<tr><td colspan="6" style="text-align:center; padding:20px; color:#555;">No addresses added yet</td></tr>';
}

async function renderTransactionHistory() {
    var data = WalletData.getData();
    var tbody = document.getElementById('txHistoryBody');

    if (data.addresses.length === 0 && strikeTransactions.length === 0) {
        renderEmptyTxTable();
        return;
    }

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#555;">Loading transactions...</td></tr>';

    var allTxs = [];

    for (var i = 0; i < data.addresses.length; i++) {
        var addr = data.addresses[i];
        var txs = await fetchAddressTxs(addr.address);
        var limited = txs.slice(0, 10);

        for (var j = 0; j < limited.length; j++) {
            var tx = limited[j];
            var voutSum = 0;
            var vinSum = 0;

            for (var v = 0; v < (tx.vout || []).length; v++) {
                if (tx.vout[v].scriptpubkey_address === addr.address) {
                    voutSum += tx.vout[v].value;
                }
            }
            for (var n = 0; n < (tx.vin || []).length; n++) {
                if (tx.vin[n].prevout && tx.vin[n].prevout.scriptpubkey_address === addr.address) {
                    vinSum += tx.vin[n].prevout.value;
                }
            }

            var change = (voutSum - vinSum) / 100000000;

            var receivingAddr = '';
            if (change < 0) {
                for (var ra = 0; ra < (tx.vout || []).length; ra++) {
                    var voutAddr = tx.vout[ra].scriptpubkey_address;
                    if (voutAddr && voutAddr !== addr.address) { receivingAddr = voutAddr; break; }
                }
            } else {
                receivingAddr = addr.address;
            }

            allTxs.push({
                source: 'On-chain',
                sourceLabel: addr.label,
                txid: tx.txid,
                timestamp: (tx.status && tx.status.block_time) || Math.floor(Date.now() / 1000),
                confirmed: tx.status && tx.status.confirmed,
                change: change,
                type: 'on-chain',
                receivingAddr: receivingAddr
            });
        }
    }

    for (var s = 0; s < strikeTransactions.length; s++) {
        var st = strikeTransactions[s];
        allTxs.push({
            source: 'Strike',
            sourceLabel: 'Strike',
            txid: st.id,
            timestamp: st.timestamp || Math.floor(Date.now() / 1000),
            confirmed: st.status === 'COMPLETED' || st.status === 'completed',
            change: st.amount,
            type: 'strike',
            strikeType: st.sourceType,
            strikeStatus: st.status
        });
    }

    allTxs.sort(function(a, b) { return b.timestamp - a.timestamp; });

    var html = '';
    var limit = Math.min(30, allTxs.length);
    for (var k = 0; k < limit; k++) {
        var t = allTxs[k];
        var date = new Date(t.timestamp * 1000);
        var dateStr = (date.getMonth() + 1) + '/' + date.getDate() + '/' + date.getFullYear() + ' ' +
            String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
        var changeColor = t.change >= 0 ? '#4ade80' : '#ef4444';
        var changePrefix = t.change >= 0 ? '+' : '';

        var sourceBadge;
        if (t.type === 'strike') {
            sourceBadge = '<span class="strike-source-badge">' + escapeHtml(t.sourceLabel) + '</span>';
        } else {
            sourceBadge = '<span class="onchain-source-badge">' + escapeHtml(t.sourceLabel) + '</span>';
        }

        var typeCol;
        if (t.type === 'strike') {
            typeCol = '<span style="font-size:11px; color:#888;">' + (t.strikeType || 'Transfer') + '</span>';
        } else {
            var txShort = t.txid.substring(0, 10) + '...';
            typeCol = '<a href="https://mempool.space/tx/' + t.txid + '" target="_blank" rel="noopener" style="color:#f7931a; text-decoration:none; font-family:monospace; font-size:11px;" title="' + t.txid + '">' + txShort + '</a>';
        }

        var statusText, statusColor;
        if (t.type === 'strike') {
            var st2 = (t.strikeStatus || '').toUpperCase();
            statusText = st2 === 'COMPLETED' ? 'Completed' : st2 === 'PENDING' ? 'Pending' : t.strikeStatus || 'Unknown';
            statusColor = st2 === 'COMPLETED' ? '#4ade80' : '#f7931a';
        } else {
            statusText = t.confirmed ? 'Confirmed' : 'Unconfirmed';
            statusColor = t.confirmed ? '#4ade80' : '#f7931a';
        }

        var toCol;
        if (t.type === 'on-chain' && t.receivingAddr) {
            var addrShort = t.receivingAddr.substring(0, 8) + '...' + t.receivingAddr.substring(t.receivingAddr.length - 4);
            toCol = '<span style="font-family:monospace; font-size:10px; color:#aaa;" title="' + t.receivingAddr + '">' + addrShort + '</span>';
        } else if (t.type === 'strike') {
            toCol = '<span style="font-size:11px; color:#888;">' + (t.strikeType || '-') + '</span>';
        } else {
            toCol = '<span style="color:#555;">-</span>';
        }

        html += '<tr>' +
            '<td>' + dateStr + '</td>' +
            '<td>' + sourceBadge + '</td>' +
            '<td>' + toCol + '</td>' +
            '<td style="color:' + changeColor + '; font-weight:500;">' + changePrefix + fmtBTC(Math.abs(t.change), 8) + '</td>' +
            '<td>' + typeCol + '</td>' +
            '<td style="color:' + statusColor + ';">' + statusText + '</td>' +
        '</tr>';
    }

    if (!html) {
        html = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#555;">No transactions found</td></tr>';
    }
    tbody.innerHTML = html;
}

// ===== HELPERS =====
function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
}

function copyToClipboard(text, btnEl) {
    navigator.clipboard.writeText(text).then(function() {
        var orig = btnEl.textContent;
        btnEl.textContent = 'Copied!';
        btnEl.style.color = '#4ade80';
        setTimeout(function() { btnEl.textContent = orig; btnEl.style.color = ''; }, 1500);
    }).catch(function() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        var orig = btnEl.textContent;
        btnEl.textContent = 'Copied!';
        btnEl.style.color = '#4ade80';
        setTimeout(function() { btnEl.textContent = orig; btnEl.style.color = ''; }, 1500);
    });
}

function validateBtcAddress(addr) {
    if (!addr || addr.length < 26 || addr.length > 62) return false;
    if (addr.startsWith('1') || addr.startsWith('3') || addr.startsWith('bc1')) return true;
    return false;
}

// ===== AUTO REFRESH =====
function startAutoRefresh() {
    refreshInterval = setInterval(function() {
        loadAndRefreshWallet();
    }, 60000);
}

window.addEventListener('beforeunload', function() {
    if (refreshInterval) clearInterval(refreshInterval);
});

// ===== LOGOUT HANDLER =====
(function() {
    var logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            // Sign out of Firebase — the onAuthChange listener will clear wallet state
            if (typeof IonAuth !== 'undefined') {
                IonAuth.signOut();
            } else {
                clearAllWalletState();
            }
        });
    }
})();

// ===== ADDRESS PANEL HANDLERS =====
var addAddressPanel = document.getElementById('addAddressPanel');

document.getElementById('btnAddAddress').addEventListener('click', function() {
    document.getElementById('faAddress').value = '';
    document.getElementById('faLabel').value = '';
    var warning = document.getElementById('strikeAddressWarning');
    if (warning) warning.style.display = strikeConnected ? 'block' : 'none';
    addAddressPanel.classList.add('open');
});

document.getElementById('cancelAddress').addEventListener('click', function() {
    addAddressPanel.classList.remove('open');
});

document.getElementById('saveAddress').addEventListener('click', async function() {
    var address = document.getElementById('faAddress').value.trim();
    var label = document.getElementById('faLabel').value.trim();

    if (!validateBtcAddress(address)) {
        alert('Please enter a valid Bitcoin address (starts with 1, 3, or bc1)');
        return;
    }

    var data = WalletData.getData();
    for (var i = 0; i < data.addresses.length; i++) {
        if (data.addresses[i].address === address) {
            alert('This address is already being tracked');
            return;
        }
    }

    WalletData.addAddress(address, label);
    addAddressPanel.classList.remove('open');
    await loadAndRefreshWallet();
});

document.getElementById('btnRefreshBalances').addEventListener('click', function() {
    loadAndRefreshWallet();
});

// ===== STRIKE PANEL HANDLERS =====
document.getElementById('btnConnectStrike').addEventListener('click', function() {
    var settings = FleetData.getSettings();
    if (settings.strike && settings.strike.proxyUrl) {
        document.getElementById('strikeProxyUrl').value = settings.strike.proxyUrl;
    }
    document.getElementById('strikeTestResult').innerHTML = '';
    document.getElementById('strikeConnectPanel').classList.toggle('open');
});

document.getElementById('cancelStrike').addEventListener('click', function() {
    document.getElementById('strikeConnectPanel').classList.remove('open');
});

document.getElementById('testStrike').addEventListener('click', async function() {
    var url = document.getElementById('strikeProxyUrl').value.trim();
    var result = document.getElementById('strikeTestResult');
    if (!url) { result.innerHTML = '<span style="color:#f55;">Enter a proxy URL</span>'; return; }

    result.innerHTML = '<span style="color:#888;">Testing connection...</span>';

    var settings = FleetData.getSettings();
    if (!settings.strike) settings.strike = {};
    var oldUrl = settings.strike.proxyUrl;
    settings.strike.proxyUrl = url;
    FleetData.saveSettings(settings);

    var data = await StrikeAPI.testConnection();

    settings.strike.proxyUrl = oldUrl;
    FleetData.saveSettings(settings);

    if (data && !data.error) {
        var balances = data.balances || data;
        var balArr = Array.isArray(balances) ? balances : (balances.items || [balances]);
        var info = [];
        for (var i = 0; i < balArr.length; i++) {
            info.push(balArr[i].currency + ': ' + (balArr[i].available || balArr[i].total || '0'));
        }
        result.innerHTML = '<span style="color:#4ade80;">Connected! Balances: ' + info.join(', ') + '</span>';
    } else {
        result.innerHTML = '<span style="color:#f55;">Failed: ' + (data.error || 'Unknown error') + '</span>';
    }
});

document.getElementById('saveStrike').addEventListener('click', async function() {
    var url = document.getElementById('strikeProxyUrl').value.trim();
    var settings = FleetData.getSettings();

    if (!url) {
        disconnectStrike();
        document.getElementById('strikeConnectPanel').classList.remove('open');
        return;
    }

    settings.strike = { proxyUrl: url, enabled: true, lastSync: null };
    FleetData.saveSettings(settings);
    strikeConnected = true;
    updateStrikeStatus('Connected');
    updateSendButton();
    update2FAButton();
    updateAccountButtons();
    document.getElementById('strikeConnectPanel').classList.remove('open');

    // Auto-login with Firebase if signed in
    await autoLoginWithFirebase();
});

function disconnectStrike() {
    var settings = FleetData.getSettings();
    settings.strike = { proxyUrl: '', enabled: false, lastSync: null };
    FleetData.saveSettings(settings);
    strikeConnected = false;
    strikeBalances = null;
    strikeTransactions = [];
    strikeOnchainAddress = null;
    try { localStorage.removeItem('ionStrikeOnchainAddr'); } catch(e) {}
    StrikeAuth.clearSession();
    updateStrikeStatus(null);
    updateSendButton();
    update2FAButton();
    updateAccountButtons();
    hideConnectStrikePrompt();
    hideSignInPrompt();
    var authBar = document.getElementById('userAuthBar');
    if (authBar) authBar.style.display = 'none';
    renderWallet();
    renderTransactionHistory();
}
window.disconnectStrike = disconnectStrike;

// ===== SEND BTC PANEL =====
var activeSendQuote = null;
var quoteExpiryInterval = null;
var totpEnabled = false;
var pinEnabled = false;

function updateSendButton() {
    var btn = document.getElementById('btnSendBtc');
    var rbtn = document.getElementById('btnReceiveBtc');
    var show = (strikeConnected && StrikeAuth.isLoggedIn()) ? '' : 'none';
    if (btn) btn.style.display = show;
    if (rbtn) rbtn.style.display = show;
}

function updateTotpVisibility() {
    var grp = document.getElementById('totpGroup');
    if (grp) grp.style.display = totpEnabled ? '' : 'none';
}

function updatePinVisibility() {
    var grp = document.getElementById('pinGroup');
    if (grp) grp.style.display = pinEnabled ? '' : 'none';
}

document.getElementById('btnSendBtc').addEventListener('click', function() {
    // Block send if no PIN is set up
    var user = StrikeAuth.getUser();
    if (!user || !user.hasPin) {
        var pinSection = document.getElementById('strikeKeyPinSection');
        var keyPanel = document.getElementById('strikeApiKeyPanel');
        if (pinSection && keyPanel) {
            pinSection.style.display = '';
            keyPanel.classList.add('open');
            var resultEl = document.getElementById('strikeKeyResult');
            if (resultEl) resultEl.innerHTML = '<span style="color:#f7931a;">You must create a send PIN before you can send BTC.</span>';
        }
        return;
    }
    document.getElementById('sendStep1').style.display = '';
    document.getElementById('sendStep2').style.display = 'none';
    document.getElementById('sendResult').innerHTML = '';
    document.getElementById('sendTotpCode').value = '';
    document.getElementById('sendPinCode').value = '';
    document.getElementById('sendDest').value = '';
    document.getElementById('sendAmount').value = '';
    activeSendQuote = null;
    // Check if user has 2FA and/or PIN enabled
    if (user && user.has2FA) {
        totpEnabled = true;
    }
    pinEnabled = true; // PIN is always required now
    updateSendTypeUI();
    updateTotpVisibility();
    updatePinVisibility();
    document.getElementById('sendBtcPanel').classList.toggle('open');
});

document.getElementById('cancelSend').addEventListener('click', function() {
    document.getElementById('sendBtcPanel').classList.remove('open');
    clearQuoteExpiry();
});

document.getElementById('cancelQuote').addEventListener('click', function() {
    document.getElementById('sendStep1').style.display = '';
    document.getElementById('sendStep2').style.display = 'none';
    document.getElementById('sendResult').innerHTML = '';
    clearQuoteExpiry();
});

document.getElementById('sendType').addEventListener('change', updateSendTypeUI);

function updateSendTypeUI() {
    var type = document.getElementById('sendType').value;
    var destLabel = document.getElementById('sendDestLabel');
    var dest = document.getElementById('sendDest');
    var amountGroup = document.getElementById('sendAmountGroup');
    var tierGroup = document.getElementById('sendTierGroup');

    if (type === 'lightning') {
        destLabel.textContent = 'Lightning Invoice';
        dest.placeholder = 'lnbc...';
        amountGroup.style.display = '';
        tierGroup.style.display = 'none';
    } else {
        destLabel.textContent = 'BTC Address';
        dest.placeholder = 'bc1q... or 1... or 3...';
        amountGroup.style.display = '';
        tierGroup.style.display = '';
        loadOnchainTiers();
    }
}

// Real-time USD <-> BTC conversion display in send form
(function() {
    var amountInput = document.getElementById('sendAmount');
    var currencySelect = document.getElementById('sendCurrency');
    var conversionEl = document.getElementById('sendConversion');

    function updateConversion() {
        if (!conversionEl) return;
        var amt = parseFloat(amountInput.value);
        if (!amt || !isFinite(amt) || amt <= 0 || !liveBtcPrice || liveBtcPrice <= 0) {
            conversionEl.textContent = '';
            return;
        }
        var cur = currencySelect.value;
        if (cur === 'USD') {
            var btcEquiv = amt / liveBtcPrice;
            conversionEl.textContent = '\u2248 ' + fmtBTC(btcEquiv, 8) + ' BTC';
        } else {
            var usdEquiv = amt * liveBtcPrice;
            conversionEl.textContent = '\u2248 ' + fmtUSD(usdEquiv);
        }
    }

    if (amountInput) amountInput.addEventListener('input', updateConversion);
    if (currencySelect) currencySelect.addEventListener('change', updateConversion);
})();

// Auto-load on-chain fee tiers when address + amount are both filled
(function() {
    var addrInput = document.getElementById('sendDest');
    var amtInput = document.getElementById('sendAmount');
    function tryLoadTiers() {
        if (document.getElementById('sendType').value !== 'onchain') return;
        if (addrInput.value.trim() && amtInput.value.trim()) {
            loadOnchainTiers();
        }
    }
    if (addrInput) addrInput.addEventListener('blur', tryLoadTiers);
    if (amtInput) amtInput.addEventListener('blur', tryLoadTiers);
    if (amtInput) amtInput.addEventListener('change', tryLoadTiers);
})();

async function loadOnchainTiers() {
    var tierSelect = document.getElementById('sendTier');
    tierSelect.innerHTML = '<option value="">Loading tiers...</option>';

    var addr = document.getElementById('sendDest').value.trim();
    var amt = document.getElementById('sendAmount').value.trim();
    var cur = document.getElementById('sendCurrency').value;
    if (!addr || !amt) {
        tierSelect.innerHTML = '<option value="">Enter address & amount first</option>';
        return;
    }

    var body = { btcAddress: addr, amount: { amount: amt, currency: cur } };
    var data = await StrikeAPI.getOnchainTiers(body);
    var tiers = Array.isArray(data) ? data : (data && data.items ? data.items : (data && data.tiers ? data.tiers : null));
    if (tiers && tiers.length > 0) {
        tierSelect.innerHTML = '';
        for (var i = 0; i < tiers.length; i++) {
            var t = tiers[i];
            var fee = t.estimatedFee ? t.estimatedFee.amount + ' ' + t.estimatedFee.currency : 'free';
            var mins = t.estimatedDeliveryDurationInMin || '?';
            var opt = document.createElement('option');
            opt.value = t.id;
            opt.setAttribute('data-fee', t.estimatedFee ? t.estimatedFee.amount : '0');
            opt.textContent = t.id.replace('tier_', '') + ' (~' + mins + ' min, fee: ' + fee + ')';
            tierSelect.appendChild(opt);
        }
    } else {
        var tierErr = (data && data.error) ? data.error : (data ? JSON.stringify(data) : 'Could not load tiers');
        tierSelect.innerHTML = '<option value="">' + tierErr + '</option>';
    }
}

// Get Quote
document.getElementById('btnGetQuote').addEventListener('click', async function() {
    var type = document.getElementById('sendType').value;
    var dest = document.getElementById('sendDest').value.trim();
    var amt = document.getElementById('sendAmount').value.trim();
    var cur = document.getElementById('sendCurrency').value;
    var result = document.getElementById('sendResult');

    if (!dest) { result.innerHTML = '<span style="color:#f55;">Enter a destination</span>'; return; }
    if (!amt) { result.innerHTML = '<span style="color:#f55;">Enter an amount</span>'; return; }

    result.innerHTML = '<span style="color:#888;">Getting quote...</span>';

    var quoteData;
    if (type === 'lightning') {
        quoteData = await StrikeAPI.sendQuoteLightning({
            lnInvoice: dest,
            sourceCurrency: cur,
            amount: { amount: amt, currency: cur }
        });
    } else {
        var tierSelect = document.getElementById('sendTier');
        var tier = tierSelect.value;
        if (!tier) {
            result.innerHTML = '<span style="color:#888;">Loading fee tiers...</span>';
            await loadOnchainTiers();
            tier = tierSelect.value;
            if (tier) {
                result.innerHTML = '<span style="color:#f90;">Select a fee speed, then tap Get Quote again</span>';
            } else {
                result.innerHTML = '<span style="color:#f55;">Could not load fee tiers</span>';
            }
            return;
        }
        var selectedOpt = tierSelect.options[tierSelect.selectedIndex];
        var tierFee = selectedOpt ? parseFloat(selectedOpt.getAttribute('data-fee') || '0') : 0;
        var amountObj = { amount: amt, currency: cur };
        if (tierFee > 0) amountObj.feePolicy = 'EXCLUSIVE';
        var body = {
            btcAddress: dest,
            sourceCurrency: cur,
            amount: amountObj
        };
        body.onchainTierId = tier;
        quoteData = await StrikeAPI.sendQuoteOnchain(body);
    }

    if (quoteData && !quoteData.error && quoteData.paymentQuoteId) {
        activeSendQuote = quoteData;
        showQuoteConfirmation(quoteData, type, dest);
        result.innerHTML = '';
    } else {
        var errMsg = quoteData.error || quoteData.message || quoteData.title || JSON.stringify(quoteData);
        result.innerHTML = '<span style="color:#f55;">' + errMsg + '</span>';
    }
});

function showQuoteConfirmation(quote, type, dest) {
    document.getElementById('sendStep1').style.display = 'none';
    document.getElementById('sendStep2').style.display = '';

    var totalAmt = quote.totalAmount ? quote.totalAmount.amount + ' ' + quote.totalAmount.currency : '?';
    var totalFee = quote.totalFee ? quote.totalFee.amount + ' ' + quote.totalFee.currency : '0';
    var destShort = dest.length > 30 ? dest.substring(0, 15) + '...' + dest.substring(dest.length - 15) : dest;

    var html = '<div><strong>Type:</strong> ' + (type === 'lightning' ? 'Lightning' : 'On-chain') + '</div>';
    html += '<div><strong>To:</strong> <span style="word-break:break-all; color:#aaa;">' + destShort + '</span></div>';
    html += '<div><strong>Total:</strong> <span style="color:#f7931a;">' + totalAmt + '</span></div>';
    html += '<div><strong>Fee:</strong> ' + totalFee + '</div>';
    if (quote.conversionRate) {
        html += '<div><strong>Rate:</strong> 1 BTC = ' + (1 / parseFloat(quote.conversionRate.amount || 1)).toFixed(2) + ' ' + quote.conversionRate.sourceCurrency + '</div>';
    }

    document.getElementById('quoteDetails').innerHTML = html;

    clearQuoteExpiry();
    if (quote.validUntil) {
        var expiry = new Date(quote.validUntil).getTime();
        quoteExpiryInterval = setInterval(function() {
            var remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
            document.getElementById('quoteExpiry').textContent = remaining > 0 ? 'Quote expires in ' + remaining + 's' : 'Quote expired — go back and get a new one';
            if (remaining <= 0) clearInterval(quoteExpiryInterval);
        }, 1000);
    }
}

function clearQuoteExpiry() {
    if (quoteExpiryInterval) { clearInterval(quoteExpiryInterval); quoteExpiryInterval = null; }
}

// Confirm & Send
document.getElementById('btnConfirmSend').addEventListener('click', async function() {
    var totpCode = (document.getElementById('sendTotpCode').value || '').replace(/\s/g, '');
    var pinCode = (document.getElementById('sendPinCode').value || '').replace(/\s/g, '');
    var result = document.getElementById('sendResult');
    if (pinEnabled && (!pinCode || pinCode.length < 4)) {
        result.innerHTML = '<span style="color:#f55;">Enter your 4-digit send PIN</span>'; return;
    }
    if (totpEnabled && (!totpCode || totpCode.length !== 6)) {
        result.innerHTML = '<span style="color:#f55;">Enter the 6-digit code from Google Authenticator</span>'; return;
    }
    if (!activeSendQuote || !activeSendQuote.paymentQuoteId) { result.innerHTML = '<span style="color:#f55;">No active quote</span>'; return; }

    if (activeSendQuote.validUntil && new Date(activeSendQuote.validUntil).getTime() < Date.now()) {
        result.innerHTML = '<span style="color:#f55;">Quote expired. Go back and get a new one.</span>';
        return;
    }

    result.innerHTML = '<span style="color:#f7931a;">Sending...</span>';
    document.getElementById('btnConfirmSend').disabled = true;

    var sendResult = await StrikeAPI.executeSend(activeSendQuote.paymentQuoteId, totpCode || undefined, pinCode || undefined);

    document.getElementById('btnConfirmSend').disabled = false;
    document.getElementById('sendTotpCode').value = '';
    document.getElementById('sendPinCode').value = '';
    clearQuoteExpiry();

    if (sendResult && !sendResult.error) {
        var state = sendResult.state || 'COMPLETED';
        result.innerHTML = '<span style="color:#4ade80;">Payment ' + state + '!</span>';
        activeSendQuote = null;
        setTimeout(function() {
            document.getElementById('sendBtcPanel').classList.remove('open');
            window.scrollTo(0, 0);
            loadAndRefreshWallet();
        }, 2000);
    } else {
        if (sendResult.totpRequired) {
            totpEnabled = true;
            updateTotpVisibility();
        }
        if (sendResult.pinNotSet) {
            // No PIN configured — redirect to PIN setup
            document.getElementById('sendBtcPanel').classList.remove('open');
            var pinSection = document.getElementById('strikeKeyPinSection');
            var keyPanel = document.getElementById('strikeApiKeyPanel');
            if (pinSection && keyPanel) {
                pinSection.style.display = '';
                keyPanel.classList.add('open');
                keyPanel.dataset.pinRequired = 'true';
                var kr = document.getElementById('strikeKeyResult');
                if (kr) kr.innerHTML = '<span style="color:#f7931a;">You must create a send PIN before you can send BTC.</span>';
            }
        } else if (sendResult.pinRequired) {
            pinEnabled = true;
            updatePinVisibility();
        }
        result.innerHTML = '<span style="color:#f55;">' + (sendResult.error || 'Send failed') + '</span>';
    }
});

// ===== 2FA SETUP =====
var BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateBase32Secret(len) {
    var arr = new Uint8Array(len || 20);
    crypto.getRandomValues(arr);
    var out = '';
    for (var i = 0; i < arr.length; i++) {
        out += BASE32_CHARS[arr[i] % 32];
    }
    return out;
}

function update2FAButton() {
    var btn = document.getElementById('btnSetup2FA');
    if (btn) btn.style.display = (strikeConnected && StrikeAuth.isLoggedIn()) ? '' : 'none';
}

document.getElementById('btnSetup2FA').addEventListener('click', function() {
    document.getElementById('twofa-setup-content').style.display = '';
    document.getElementById('twofa-setup-result').style.display = 'none';
    document.getElementById('setup2FAPanel').classList.toggle('open');
});

document.getElementById('cancel2FA').addEventListener('click', function() {
    document.getElementById('setup2FAPanel').classList.remove('open');
});

document.getElementById('btnGenerate2FA').addEventListener('click', function() {
    var secret = generateBase32Secret(16);
    // Use Firebase email for 2FA label
    var fbUser = (typeof IonAuth !== 'undefined') ? IonAuth.getUser() : null;
    var label = fbUser ? (fbUser.email || fbUser.displayName || 'user') : 'user';
    var otpauthUri = 'otpauth://totp/IonMining:' + label + '?secret=' + secret + '&issuer=IonMining';

    document.getElementById('twofa-secret-display').textContent = secret;
    document.getElementById('twofa-setup-content').style.display = 'none';
    document.getElementById('twofa-setup-result').style.display = '';

    var qrEl = document.getElementById('twofa-qr');
    qrEl.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&data=' + encodeURIComponent(otpauthUri);

    window._pending2FASecret = secret;

    var verifyInput = document.getElementById('twofa-verify-code');
    var saveBtn = document.getElementById('btnSave2FAToWorker');
    var resultEl = document.getElementById('twofa-save-result');
    if (verifyInput) verifyInput.value = '';
    if (resultEl) resultEl.innerHTML = '';
    if (saveBtn) saveBtn.disabled = false;
});

document.getElementById('btnSave2FAToWorker').addEventListener('click', async function() {
    var secret = window._pending2FASecret;
    var code = (document.getElementById('twofa-verify-code').value || '').replace(/\s/g, '');
    var resultEl = document.getElementById('twofa-save-result');

    if (!secret) { resultEl.innerHTML = '<span style="color:#f55;">Generate a secret first.</span>'; return; }
    if (!code || code.length !== 6) { resultEl.innerHTML = '<span style="color:#f55;">Enter the 6-digit code from your authenticator.</span>'; return; }

    resultEl.innerHTML = '<span style="color:#888;">Saving...</span>';
    this.disabled = true;

    var data = await StrikeAPI.apiPost('/auth/setup-totp', { secret: secret, code: code });

    this.disabled = false;
    if (data && data.ok) {
        resultEl.innerHTML = '<span style="color:#4ade80;">2FA activated! All sends now require an authenticator code.</span>';
        totpEnabled = true;
        updateTotpVisibility();
        window._pending2FASecret = null;
        // Update local user record
        var user = StrikeAuth.getUser();
        if (user) {
            user.has2FA = true;
            StrikeAuth.saveSession(StrikeAuth.getToken(), user);
        }
    } else {
        resultEl.innerHTML = '<span style="color:#f55;">' + (data.error || data.message || 'Failed to save') + '</span>';
    }
});

// ===== RECEIVE BTC PANEL =====
document.getElementById('btnReceiveBtc').addEventListener('click', function() {
    document.getElementById('invoiceResult').style.display = 'none';
    document.getElementById('receiveAmount').value = '';
    document.getElementById('receiveDescription').value = '';
    document.getElementById('receiveResult').innerHTML = '';
    document.getElementById('receiveConversion').textContent = '';
    document.getElementById('receiveBtcPanel').classList.toggle('open');
});

document.getElementById('cancelReceive').addEventListener('click', function() {
    document.getElementById('receiveBtcPanel').classList.remove('open');
    if (window._invoicePollInterval) clearInterval(window._invoicePollInterval);
});

// Receive tab switching
(function() {
    var tabs = document.querySelectorAll('#receiveTabs .map-toggle-btn');
    for (var i = 0; i < tabs.length; i++) {
        (function(tab) {
            tab.addEventListener('click', function() {
                for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
                tab.classList.add('active');
                var target = tab.getAttribute('data-tab');
                document.getElementById('receiveTabLightning').style.display = target === 'lightning' ? '' : 'none';
                document.getElementById('receiveTabOnchain').style.display = target === 'onchain' ? '' : 'none';
                if (target === 'onchain') renderOnchainReceiveTab();
            });
        })(tabs[i]);
    }
})();

// Receive amount conversion display
(function() {
    var amtInput = document.getElementById('receiveAmount');
    var curSelect = document.getElementById('receiveCurrency');
    var convEl = document.getElementById('receiveConversion');
    function updateConv() {
        if (!convEl) return;
        var amt = parseFloat(amtInput.value);
        if (!amt || !isFinite(amt) || amt <= 0 || !liveBtcPrice || liveBtcPrice <= 0) { convEl.textContent = ''; return; }
        if (curSelect.value === 'USD') {
            convEl.textContent = '\u2248 ' + fmtBTC(amt / liveBtcPrice, 8) + ' BTC';
        } else {
            convEl.textContent = '\u2248 ' + fmtUSD(amt * liveBtcPrice);
        }
    }
    if (amtInput) amtInput.addEventListener('input', updateConv);
    if (curSelect) curSelect.addEventListener('change', updateConv);
})();

// Create Lightning Invoice
document.getElementById('btnCreateInvoice').addEventListener('click', async function() {
    var amt = document.getElementById('receiveAmount').value.trim();
    var cur = document.getElementById('receiveCurrency').value;
    var desc = document.getElementById('receiveDescription').value.trim();
    var resultEl = document.getElementById('receiveResult');

    if (!amt || parseFloat(amt) <= 0) {
        resultEl.innerHTML = '<span style="color:#f55;">Enter an amount</span>';
        return;
    }

    resultEl.innerHTML = '<span style="color:#888;">Creating invoice...</span>';
    this.disabled = true;

    var body = { correlationId: 'inv_' + Date.now().toString(36), description: desc || 'Payment', amount: { amount: amt, currency: cur } };
    var data = await StrikeAPI.createInvoice(body);

    if (!data || data.error || !data.invoiceId) {
        this.disabled = false;
        resultEl.innerHTML = '<span style="color:#f55;">' + (data && data.error || 'Failed to create invoice') + '</span>';
        return;
    }

    // Step 2: Generate quote to get the bolt11 payment request
    resultEl.innerHTML = '<span style="color:#888;">Generating Lightning invoice...</span>';
    var quote = await StrikeAPI.createInvoiceQuote(data.invoiceId);
    this.disabled = false;

    var bolt11 = (quote && quote.lnInvoice) || '';
    if (!bolt11) {
        resultEl.innerHTML = '<span style="color:#f55;">' + (quote && quote.error || 'Could not generate Lightning invoice') + '</span>';
        return;
    }

    resultEl.innerHTML = '';
    document.getElementById('lnInvoiceText').textContent = bolt11;

    var qrImg = document.getElementById('lnInvoiceQR');
    qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent('lightning:' + bolt11);

    document.getElementById('invoiceResult').style.display = '';
    startInvoicePoll(data.invoiceId);

    // Create shareable invoice link (served from worker at /pay?id=xxx)
    var shareLinkEl = document.getElementById('invoiceShareLink');
    var shareStatusEl = document.getElementById('invoiceStatus');
    if (shareLinkEl) {
        shareLinkEl.style.display = 'none';
        shareStatusEl.innerHTML = '<span style="color:#888;">Generating share link...</span>';
        try {
            var shareData = await StrikeAPI.shareInvoice({ amount: amt, currency: cur, description: desc || 'Payment' });
            if (shareData && shareData.shareId) {
                var shareUrl = StrikeAPI.getProxyUrl().replace(/\/$/, '') + '/pay?id=' + shareData.shareId;
                document.getElementById('shareUrlText').textContent = shareUrl;
                shareLinkEl.style.display = '';
                shareStatusEl.innerHTML = '<span style="color:#4ade80;">Share link ready!</span>';
            } else {
                shareStatusEl.innerHTML = '<span style="color:#f55;">Share failed: ' + (shareData && shareData.error || 'Unknown error') + '</span>';
            }
        } catch(e) {
            shareStatusEl.innerHTML = '<span style="color:#f55;">Share error: ' + e.message + '</span>';
        }
    } else {
    }
});

// Copy invoice
document.getElementById('btnCopyInvoice').addEventListener('click', function() {
    var bolt11 = document.getElementById('lnInvoiceText').textContent;
    copyToClipboard(bolt11, this);
});

// Copy share link
document.getElementById('btnCopyShareLink').addEventListener('click', function() {
    var url = document.getElementById('shareUrlText').textContent;
    copyToClipboard(url, this);
});

// Poll invoice for payment
function startInvoicePoll(invoiceId) {
    if (window._invoicePollInterval) clearInterval(window._invoicePollInterval);
    var statusEl = document.getElementById('invoiceStatus');
    statusEl.innerHTML = '<span style="color:#f7931a;">Waiting for payment...</span>';

    window._invoicePollInterval = setInterval(async function() {
        var inv = await StrikeAPI.getInvoice(invoiceId);
        if (inv && inv.state === 'PAID') {
            clearInterval(window._invoicePollInterval);
            statusEl.innerHTML = '<span style="color:#4ade80;">Payment received!</span>';
            setTimeout(function() { loadAndRefreshWallet(); }, 2000);
        } else if (inv && (inv.state === 'CANCELLED' || inv.state === 'EXPIRED')) {
            clearInterval(window._invoicePollInterval);
            statusEl.innerHTML = '<span style="color:#ef4444;">Invoice expired</span>';
        }
    }, 5000);
}

// Fetch Strike on-chain deposit address with 2-tier caching
async function fetchStrikeOnchainAddress() {
    if (strikeOnchainAddress) return strikeOnchainAddress;
    try {
        var cached = JSON.parse(localStorage.getItem('ionStrikeOnchainAddr') || 'null');
        if (cached && cached.address && cached.ts && (Date.now() - cached.ts < 86400000)) {
            strikeOnchainAddress = cached.address;
            return cached.address;
        }
    } catch(e) {}
    try {
        var data = await StrikeAPI.getOnchainAddress();
        if (data && data.ok && data.address) {
            strikeOnchainAddress = data.address;
            try { localStorage.setItem('ionStrikeOnchainAddr', JSON.stringify({ address: data.address, ts: Date.now() })); } catch(e) {}
            return data.address;
        }
    } catch(e) {}
    return null;
}

function updateOnchainBadge(type) {
    var badge = document.getElementById('onchainAddrBadge');
    if (!badge) return;
    if (type === 'strike') {
        badge.innerHTML = '<span style="font-size:11px; padding:3px 10px; border-radius:6px; background:rgba(139,92,246,0.12); border:1px solid rgba(139,92,246,0.3); color:#a78bfa;">Strike Custodial &mdash; funds appear in your Strike balance</span>';
    } else {
        badge.innerHTML = '<span style="font-size:11px; padding:3px 10px; border-radius:6px; background:rgba(247,147,26,0.08); border:1px solid rgba(247,147,26,0.25); color:#f7931a;">Self-Custody Address</span>';
    }
}

// On-chain receive tab
async function renderOnchainReceiveTab() {
    var container = document.getElementById('onchainReceiveContent');
    var data = WalletData.getData();
    var isStrikeLoggedIn = strikeConnected && StrikeAuth.isLoggedIn();

    // Build unified address list
    var allAddresses = [];
    for (var i = 0; i < data.addresses.length; i++) {
        allAddresses.push({ address: data.addresses[i].address, label: data.addresses[i].label, type: 'manual' });
    }

    // Fetch Strike on-chain address if connected
    if (isStrikeLoggedIn) {
        if (strikeOnchainAddress) {
            allAddresses.unshift({ address: strikeOnchainAddress, label: 'Strike Wallet', type: 'strike' });
        } else {
            container.innerHTML = '<div style="padding:20px; color:#f7931a; font-size:13px;">Fetching Strike deposit address...</div>';
            var addr = await fetchStrikeOnchainAddress();
            if (addr) {
                allAddresses.unshift({ address: addr, label: 'Strike Wallet', type: 'strike' });
            }
        }
    }

    if (allAddresses.length === 0) {
        container.innerHTML = '<div style="padding:20px; color:#888; font-size:13px;">' +
            'No on-chain addresses available.<br><br>' +
            '<button class="btn btn-primary" onclick="document.getElementById(\'btnAddAddress\').click(); document.getElementById(\'receiveBtcPanel\').classList.remove(\'open\');">+ Add Address</button>' +
            '</div>';
        return;
    }

    // Always show selector
    var html = '<div class="input-group" style="margin-bottom:12px; text-align:left;">' +
        '<label>Select Address</label><div class="input-wrapper"><select id="receiveAddrSelect">';
    for (var i = 0; i < allAddresses.length; i++) {
        var a = allAddresses[i];
        var lbl = a.type === 'strike' ? '\u26a1 ' + escapeHtml(a.label) : escapeHtml(a.label);
        html += '<option value="' + a.address + '">' + lbl + '</option>';
    }
    html += '</select></div></div>';
    html += '<div id="onchainAddrBadge" style="margin-bottom:8px; text-align:center;"></div>';
    html += '<div style="margin:12px 0;"><img id="onchainAddrQR" width="200" height="200" style="border-radius:8px; background:#fff; padding:8px;"></div>';
    html += '<div style="font-size:12px; color:#aaa; margin-bottom:6px;">Bitcoin Address:</div>';
    html += '<div style="position:relative;">' +
        '<div id="onchainAddrText" style="background:rgba(255,255,255,0.05); padding:10px 40px 10px 14px; border-radius:8px; font-family:monospace; font-size:11px; word-break:break-all; color:#f7931a;"></div>' +
        '<button class="btn btn-secondary" id="btnCopyOnchainAddr" style="position:absolute; top:6px; right:6px; padding:4px 10px; font-size:11px;">Copy</button>' +
    '</div>';

    container.innerHTML = html;
    showOnchainAddress(allAddresses[0].address);
    updateOnchainBadge(allAddresses[0].type);

    var select = document.getElementById('receiveAddrSelect');
    if (select) {
        select.addEventListener('change', function() {
            showOnchainAddress(this.value);
            for (var j = 0; j < allAddresses.length; j++) {
                if (allAddresses[j].address === this.value) { updateOnchainBadge(allAddresses[j].type); break; }
            }
        });
    }

    document.getElementById('btnCopyOnchainAddr').addEventListener('click', function() {
        copyToClipboard(document.getElementById('onchainAddrText').textContent, this);
    });
}

function showOnchainAddress(address) {
    document.getElementById('onchainAddrText').textContent = address;
    var qrImg = document.getElementById('onchainAddrQR');
    qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent('bitcoin:' + address);
}

// ===== STRIKE API KEY PANEL =====
(function() {
    var promptConnectBtn = document.getElementById('btnConnectStrikeFromPrompt');

    function openStrikeKeyPanel() {
        document.getElementById('strikeApiKeyInput').value = '';
        document.getElementById('strikeKeyResult').innerHTML = '';
        document.getElementById('strikeApiKeyPanel').classList.add('open');
    }

    if (promptConnectBtn) promptConnectBtn.addEventListener('click', openStrikeKeyPanel);

    var cancelBtn = document.getElementById('cancelStrikeKey');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            var panel = document.getElementById('strikeApiKeyPanel');
            if (panel.dataset.pinRequired === 'true') {
                var resultEl = document.getElementById('strikeKeyResult');
                if (resultEl) resultEl.innerHTML = '<span style="color:#f7931a;">You must create a send PIN before continuing.</span>';
                return; // Block close
            }
            panel.classList.remove('open');
        });
    }

    var saveBtn = document.getElementById('saveStrikeKey');
    if (saveBtn) {
        saveBtn.addEventListener('click', async function() {
            var apiKey = document.getElementById('strikeApiKeyInput').value.trim();
            var resultEl = document.getElementById('strikeKeyResult');

            if (!apiKey) { resultEl.innerHTML = '<span style="color:#f55;">Enter your Strike API key</span>'; return; }

            resultEl.innerHTML = '<span style="color:#888;">Connecting to Strike...</span>';
            saveBtn.disabled = true;

            var data = await StrikeAPI.connectStrike(apiKey);
            saveBtn.disabled = false;

            if (data && data.ok) {
                // Update local user
                var user = StrikeAuth.getUser();
                if (user) {
                    user.strikeConnected = true;
                    user.hasOwnKey = true;
                    StrikeAuth.saveSession(StrikeAuth.getToken(), user);
                }
                hideConnectStrikePrompt();
                updateAccountButtons();
                // Show PIN creation UI — PIN is mandatory, cannot skip
                var pinSection = document.getElementById('strikeKeyPinSection');
                if (pinSection && !(user && user.hasPin)) {
                    resultEl.innerHTML = '<span style="color:#4ade80;">Strike connected! Now create a send PIN below.</span>';
                    pinSection.style.display = '';
                    // Mark panel as requiring PIN before close
                    document.getElementById('strikeApiKeyPanel').dataset.pinRequired = 'true';
                } else {
                    resultEl.innerHTML = '<span style="color:#4ade80;">Strike account connected!</span>';
                    setTimeout(function() {
                        document.getElementById('strikeApiKeyPanel').classList.remove('open');
                        loadAndRefreshWallet();
                    }, 1000);
                }
            } else {
                resultEl.innerHTML = '<span style="color:#f55;">' + (data.error || 'Failed to connect') + '</span>';
            }
        });
    }
})();

// ===== PIN SAVE HANDLER =====
(function() {
    var pinBtn = document.getElementById('btnSavePin');
    if (pinBtn) {
        pinBtn.addEventListener('click', async function() {
            var pin = (document.getElementById('newPinInput').value || '').trim();
            var confirm = (document.getElementById('confirmPinInput').value || '').trim();
            var resultEl = document.getElementById('pinSaveResult');

            if (!pin || pin.length < 4 || !/^\d+$/.test(pin)) {
                resultEl.innerHTML = '<span style="color:#f55;">PIN must be 4-6 digits.</span>'; return;
            }
            if (pin !== confirm) {
                resultEl.innerHTML = '<span style="color:#f55;">PINs do not match.</span>'; return;
            }

            resultEl.innerHTML = '<span style="color:#888;">Saving PIN...</span>';
            pinBtn.disabled = true;

            var data = await StrikeAPI.setPin(pin);
            pinBtn.disabled = false;

            if (data && data.ok) {
                resultEl.innerHTML = '<span style="color:#4ade80;">Send PIN saved!</span>';
                pinEnabled = true;
                var user = StrikeAuth.getUser();
                if (user) {
                    user.hasPin = true;
                    StrikeAuth.saveSession(StrikeAuth.getToken(), user);
                }
                setTimeout(function() {
                    document.getElementById('strikeApiKeyPanel').classList.remove('open');
                    loadAndRefreshWallet();
                }, 1500);
            } else {
                resultEl.innerHTML = '<span style="color:#f55;">' + (data.error || data.message || 'Failed to save PIN') + '</span>';
            }
        });
    }
})();

// ===== ACCOUNT SETTINGS PANEL =====
(function() {
    var settingsBtn = document.getElementById('btnAccountSettings');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function() {
            var user = StrikeAuth.getUser();
            if (user) {
                document.getElementById('settingsMaxSend').value = user.maxSendUsd || 1000;
                document.getElementById('settingsSendsPerHour').value = user.maxSendsPerHour || 5;
            }
            document.getElementById('settingsResult').innerHTML = '';
            document.getElementById('accountSettingsPanel').classList.add('open');
        });
    }

    var cancelBtn = document.getElementById('cancelAccountSettings');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            document.getElementById('accountSettingsPanel').classList.remove('open');
        });
    }

    var saveBtn = document.getElementById('saveAccountSettings');
    if (saveBtn) {
        saveBtn.addEventListener('click', async function() {
            var maxSend = parseFloat(document.getElementById('settingsMaxSend').value) || 0;
            var sendsPerHour = parseInt(document.getElementById('settingsSendsPerHour').value) || 5;
            var resultEl = document.getElementById('settingsResult');

            resultEl.innerHTML = '<span style="color:#888;">Saving...</span>';
            saveBtn.disabled = true;

            var data = await StrikeAPI.updateSettings({ maxSendUsd: maxSend, maxSendsPerHour: sendsPerHour });
            saveBtn.disabled = false;

            if (data && data.ok) {
                resultEl.innerHTML = '<span style="color:#4ade80;">Settings saved!</span>';
                // Update local user
                var user = StrikeAuth.getUser();
                if (user) {
                    user.maxSendUsd = data.maxSendUsd;
                    user.maxSendsPerHour = data.maxSendsPerHour;
                    StrikeAuth.saveSession(StrikeAuth.getToken(), user);
                }
            } else {
                resultEl.innerHTML = '<span style="color:#f55;">' + (data.error || 'Failed to save') + '</span>';
            }
        });
    }

    var disconnectBtn = document.getElementById('btnDisconnectStrikeKey');
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', async function() {
            if (!confirm('Disconnect your Strike API key? You can reconnect anytime.')) return;

            var data = await StrikeAPI.disconnectStrikeAccount();
            if (data && data.ok) {
                // Update local user
                var user = StrikeAuth.getUser();
                if (user) {
                    user.strikeConnected = data.strikeConnected;
                    user.hasOwnKey = false;
                    StrikeAuth.saveSession(StrikeAuth.getToken(), user);
                }
                strikeBalances = null;
                strikeTransactions = [];
                updateAccountButtons();
                document.getElementById('accountSettingsPanel').classList.remove('open');
                if (!data.strikeConnected) {
                    showConnectStrikePrompt();
                }
                renderWallet();
                renderTransactionHistory();
            }
        });
    }
})();
