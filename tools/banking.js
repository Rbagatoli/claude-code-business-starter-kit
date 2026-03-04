// ===== ION MINING GROUP — Banking (Wallet + Income + Accounting) =====

// ===== SECTION 0: UNIFIED STATE =====
var liveBtcPrice = null;
var acctBtcPrice = null;
var refreshInterval = null;
var strikeConnected = false;
var strikeBalances = null;
var strikeTransactions = [];
var strikeOnchainAddress = null;

// Income tab state
var payoutChart = null;
var revCostChart = null;

// Accounting tab state
var qboData = { accounts: [], expenses: [], invoices: [] };
var qboConnected = false;
var acctStrikeConnected = false;
var strikeAcctData = { deposits: [], payouts: [], receives: [] };
var acctPeriod = { start: '', end: '' };
var pnlChart = null;
var expenseDoughnutChart = null;

// Tab state
var bankingActiveTab = 'wallet';
var incomeChartsInited = false;
var accountingChartsInited = false;

// ===== TAB SWITCHING =====
function switchBankingTab(tabName) {
    bankingActiveTab = tabName;

    // Close all open slide panels
    var panels = document.querySelectorAll('.slide-panel.open');
    for (var i = 0; i < panels.length; i++) panels[i].classList.remove('open');

    // Update tab buttons
    var tabs = document.querySelectorAll('#bankingTabs .banking-tab');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tabName);
    }

    // Show/hide tab content
    document.getElementById('tabWallet').style.display = tabName === 'wallet' ? '' : 'none';
    document.getElementById('tabIncome').style.display = tabName === 'income' ? '' : 'none';
    document.getElementById('tabAccounting').style.display = tabName === 'accounting' ? '' : 'none';

    // Lazy-init charts (Chart.js needs visible canvas)
    if (tabName === 'income' && !incomeChartsInited) {
        incomeChartsInited = true;
        initPayoutChart();
        initRevCostChart();
    }
    if (tabName === 'accounting') {
        if (!accountingChartsInited) {
            accountingChartsInited = true;
        }
        // Refresh Strike data and re-render when switching to Accounting tab
        if (acctStrikeConnected && StrikeAuth.isLoggedIn()) {
            fetchStrikeAccountingData().then(function() {
                renderAccounting();
            }).catch(function(e) {
                console.warn('[Accounting] Refresh on tab switch failed:', e);
                renderAccounting(); // Still render with existing data
            });
        } else {
            renderAccounting();
        }
    }

    // Re-init widget drag handles for the newly visible tab
    if (typeof window.initBankingTabWidgets === 'function') {
        window.initBankingTabWidgets();
    }
}
window.switchBankingTab = switchBankingTab;

// Tab bar click handler
document.getElementById('bankingTabs').addEventListener('click', function(e) {
    var btn = e.target.closest('.banking-tab');
    if (!btn) return;
    switchBankingTab(btn.getAttribute('data-tab'));
});

// Hash-based tab selection (early)
(function() {
    var hash = location.hash.replace('#', '');
    if (hash === 'income' || hash === 'wallet' || hash === 'accounting') {
        switchBankingTab(hash);
    }
})();

// ===== SHARED HELPERS =====
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ===== SECTION 1: SHARED DATA MODULES =====

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

// ===== PAYOUT DATA MODULE =====
var PayoutData = (function() {
    var PAYOUT_KEY = 'ionMiningPayouts';

    function getData() {
        try {
            var raw = localStorage.getItem(PAYOUT_KEY);
            if (!raw) return defaultData();
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.payouts) return defaultData();
            return parsed;
        } catch(e) { return defaultData(); }
    }

    function defaultData() {
        return { _v: 1, snapshots: [], payouts: [], lastSnapshotDate: null };
    }

    function saveData(data) {
        try { localStorage.setItem(PAYOUT_KEY, JSON.stringify(data)); } catch(e) {}
        if (typeof SyncEngine !== 'undefined') SyncEngine.save('payouts', data);
    }

    function addSnapshot(snapshot) {
        var data = getData();
        data.snapshots.push(snapshot);
        data.lastSnapshotDate = snapshot.date;
        saveData(data);
    }

    function addPayout(payout) {
        var data = getData();
        payout.id = 'payout_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        data.payouts.push(payout);
        saveData(data);
        return payout;
    }

    function removePayout(id) {
        var data = getData();
        var filtered = [];
        for (var i = 0; i < data.payouts.length; i++) {
            if (data.payouts[i].id !== id) filtered.push(data.payouts[i]);
        }
        data.payouts = filtered;
        saveData(data);
    }

    function hasPayoutWithTxHash(txHash) {
        if (!txHash) return false;
        var data = getData();
        for (var i = 0; i < data.payouts.length; i++) {
            if (data.payouts[i].txHash === txHash) return true;
        }
        return false;
    }

    return {
        getData: getData,
        saveData: saveData,
        addSnapshot: addSnapshot,
        addPayout: addPayout,
        removePayout: removePayout,
        hasPayoutWithTxHash: hasPayoutWithTxHash
    };
})();

// ===== ELECTRICITY DATA MODULE =====
var ElectricityData = (function() {
    var ELEC_KEY = 'ionMiningElectricity';

    function getData() {
        try {
            var raw = localStorage.getItem(ELEC_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch(e) { return []; }
    }

    function saveData(entries) {
        try { localStorage.setItem(ELEC_KEY, JSON.stringify(entries)); } catch(e) {}
        if (typeof SyncEngine !== 'undefined') SyncEngine.save('electricity', entries);
    }

    function addEntry(entry) {
        var entries = getData();
        entry.id = 'elec_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        entry.effectiveRate = entry.kwhUsed > 0 ? entry.costUSD / entry.kwhUsed : 0;
        entries.push(entry);
        saveData(entries);
        return entry;
    }

    function removeEntry(id) {
        var entries = getData();
        var filtered = [];
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].id !== id) filtered.push(entries[i]);
        }
        saveData(filtered);
    }

    function getSummary() {
        var entries = getData();
        var totalCost = 0, totalKWh = 0;
        for (var i = 0; i < entries.length; i++) {
            totalCost += entries[i].costUSD;
            totalKWh += entries[i].kwhUsed;
        }
        var months = entries.length || 1;
        return {
            totalCost: totalCost,
            totalKWh: totalKWh,
            avgMonthly: totalCost / months,
            effectiveRate: totalKWh > 0 ? totalCost / totalKWh : 0,
            count: entries.length
        };
    }

    return {
        getData: getData,
        addEntry: addEntry,
        removeEntry: removeEntry,
        getSummary: getSummary
    };
})();

// ===== SECTION 2: STRIKE AUTH & API MODULES (from wallet.js) =====

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
        if (acctStrikeConnected) await fetchStrikeAccountingData();
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
            if (acctStrikeConnected) await fetchStrikeAccountingData();
        } else {
            console.warn('[Wallet] Firebase login failed:', data);
            showSignInPrompt(data && data.error ? data.error + (data.message ? ': ' + data.message : '') : 'Login failed');
        }
    } catch(e) {
        console.warn('[Wallet] Firebase auto-login error:', e);
        showSignInPrompt('Auto-login error: ' + (e.message || e));
    }
}

// ===== WALLET INIT STUB =====
// (actual init is at bottom in unified init)

// Listen for sync engine wallet updates (cross-device)
window.ionWalletSyncRefresh = function() {
    loadAndRefreshWallet();
    if (acctStrikeConnected) fetchStrikeAccountingData();
};

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

// ===== SECTION 3: WALLET TAB LOGIC (from wallet.js) =====

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
        document.getElementById('walletStrikeProxyUrl').value = settings.strike.proxyUrl;
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
        if (badge) {
            badge.textContent = 'Strike: ' + label;
            badge.className = 'status-badge status-connected';
        }
        // Update global nav bar
        var btnConnect = document.getElementById('btnConnectStrikeGlobal');
        var badgeConnected = document.getElementById('strikeConnectedBadge');
        if (btnConnect) btnConnect.style.display = 'none';
        if (badgeConnected) badgeConnected.style.display = 'flex';
    } else {
        if (badge) {
            badge.textContent = 'Strike: Not Connected';
            badge.className = 'status-badge status-disconnected';
        }
        // Update global nav bar
        var btnConnect = document.getElementById('btnConnectStrikeGlobal');
        var badgeConnected = document.getElementById('strikeConnectedBadge');
        if (btnConnect) btnConnect.style.display = 'block';
        if (badgeConnected) badgeConnected.style.display = 'none';
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

    // Also refresh Accounting tab Strike data if connected
    if (acctStrikeConnected) {
        fetchStrikeAccountingData().catch(function(e) {
            console.warn('[Accounting] Auto-refresh failed:', e);
        });
    }
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
// Old button removed - now using btnConnectStrikeGlobal
var oldStrikeBtn = document.getElementById('btnConnectStrike');
if (oldStrikeBtn) {
    oldStrikeBtn.addEventListener('click', function() {
        var settings = FleetData.getSettings();
        if (settings.strike && settings.strike.proxyUrl) {
            document.getElementById('walletStrikeProxyUrl').value = settings.strike.proxyUrl;
        }
        document.getElementById('walletStrikeTestResult').innerHTML = '';
        document.getElementById('strikeConnectPanel').classList.toggle('open');
    });
}

document.getElementById('cancelWalletStrike').addEventListener('click', function() {
    document.getElementById('strikeConnectPanel').classList.remove('open');
});

document.getElementById('testWalletStrike').addEventListener('click', async function() {
    var url = document.getElementById('walletStrikeProxyUrl').value.trim();
    var result = document.getElementById('walletStrikeTestResult');
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

document.getElementById('saveWalletStrike').addEventListener('click', async function() {
    var url = document.getElementById('walletStrikeProxyUrl').value.trim();
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


// ===== SECTION 4: INCOME TAB LOGIC (from payouts.js) =====

// ===== AUTO-LOG DAILY SNAPSHOT =====
function checkAndLogDailySnapshot() {
    try {
        var settings = FleetData.getSettings();
        var pools = settings.pools || [];
        var hasEnabled = false;
        for (var p = 0; p < pools.length; p++) {
            if (pools[p].enabled) { hasEnabled = true; break; }
        }
        if (!hasEnabled) return;

        // Aggregate earnings from all pools
        var poolEarnings = window.poolEarnings || {};
        var agg = { yesterdayIncome: 0, balance: 0, totalIncome: 0 };
        var hasAny = false;
        var types = Object.keys(poolEarnings);
        for (var k = 0; k < types.length; k++) {
            var pe = poolEarnings[types[k]];
            if (pe) {
                hasAny = true;
                agg.yesterdayIncome += pe.yesterdayIncome || 0;
                agg.balance += pe.balance || 0;
                agg.totalIncome += pe.totalIncome || 0;
            }
        }
        // Backward compat: also check legacy f2poolEarnings
        if (!hasAny && window.f2poolEarnings) {
            agg.yesterdayIncome = window.f2poolEarnings.yesterdayIncome || 0;
            agg.balance = window.f2poolEarnings.balance || 0;
            agg.totalIncome = window.f2poolEarnings.totalIncome || 0;
            hasAny = true;
        }
        if (!hasAny) return;

        var today = new Date().toISOString().split('T')[0];
        var data = PayoutData.getData();
        if (data.lastSnapshotDate === today) return;

        PayoutData.addSnapshot({
            date: today,
            btcEarned: agg.yesterdayIncome,
            btcPrice: liveBtcPrice,
            balance: agg.balance,
            totalIncome: agg.totalIncome
        });
    } catch(e) {}
}

// ===== ALL-POOL PAYOUT SYNC =====
async function syncAllPoolPayouts() {
    var statusEl = document.getElementById('f2poolSyncStatus');
    try {
        var settings = FleetData.getSettings();
        var pools = settings.pools || [];
        var totalAdded = 0;
        var syncedPools = [];

        for (var p = 0; p < pools.length; p++) {
            var pool = pools[p];
            if (!pool.enabled || !pool.workerUrl) continue;

            try {
                var fetchUrl = pool.workerUrl + '/payouts';
                if (pool.username) fetchUrl += '?user=' + encodeURIComponent(pool.username);

                if (statusEl) statusEl.textContent = 'Syncing payouts from ' + pool.name + '...';

                var res = await fetch(fetchUrl);
                if (!res.ok) continue;
                var json = await res.json();

                var transactions = (json.data && json.data.transactions) || json.transactions || [];
                var added = 0;

                for (var i = 0; i < transactions.length; i++) {
                    var tx = transactions[i];
                    var extra = tx.payout_extra;
                    if (!extra || !extra.tx_id) continue;

                    if (PayoutData.hasPayoutWithTxHash(extra.tx_id)) continue;

                    var ts = extra.paid_time || tx.created_at;
                    var d = new Date(ts * 1000);
                    var dateStr = d.getFullYear() + '-' +
                        String(d.getMonth() + 1).padStart(2, '0') + '-' +
                        String(d.getDate()).padStart(2, '0');

                    var btcAmount = parseFloat(extra.value) || Math.abs(parseFloat(tx.changed_balance)) || 0;
                    if (btcAmount <= 0) continue;

                    PayoutData.addPayout({
                        date: dateStr,
                        btcAmount: btcAmount,
                        btcPrice: liveBtcPrice,
                        usdValue: btcAmount * liveBtcPrice,
                        txHash: extra.tx_id,
                        notes: pool.name + ' auto-sync'
                    });
                    added++;
                }
                totalAdded += added;
                if (added > 0) syncedPools.push(pool.name);
            } catch(poolErr) {}
        }

        if (totalAdded > 0) {
            renderPayoutPage();
            updatePayoutChart();
        }

        if (statusEl) {
            if (totalAdded > 0) {
                statusEl.textContent = 'Synced ' + totalAdded + ' new payout' + (totalAdded > 1 ? 's' : '') + ' from ' + syncedPools.join(', ');
            } else if (pools.length > 0) {
                statusEl.textContent = 'All pool payouts up to date';
            }
            setTimeout(function() { statusEl.textContent = ''; }, 5000);
        }
    } catch(e) {
        if (statusEl) {
            statusEl.textContent = 'Pool sync failed';
            setTimeout(function() { statusEl.textContent = ''; }, 5000);
        }
    }
}

// ===== RENDER PAYOUT PAGE =====
function renderPayoutPage() {
    var data = PayoutData.getData();

    // Calculate totals from payouts
    var totalPayoutBTC = 0;
    var totalPayoutUSD = 0;
    for (var p = 0; p < data.payouts.length; p++) {
        totalPayoutBTC += data.payouts[p].btcAmount;
        totalPayoutUSD += data.payouts[p].usdValue;
    }

    // Calculate totals from snapshots
    var totalSnapshotBTC = 0;
    for (var s = 0; s < data.snapshots.length; s++) {
        totalSnapshotBTC += data.snapshots[s].btcEarned;
    }

    var totalBTC = totalPayoutBTC + totalSnapshotBTC;
    var avgDaily = data.snapshots.length > 0 ? totalSnapshotBTC / data.snapshots.length : 0;
    var avgPrice = totalPayoutBTC > 0 ? totalPayoutUSD / totalPayoutBTC : liveBtcPrice;

    // Update summary cards
    document.getElementById('sumTotalEarned').textContent = fmtBTC(totalBTC, 8);
    document.getElementById('sumTotalUSD').textContent = fmtUSD(totalBTC * liveBtcPrice);
    document.getElementById('sumAvgPrice').textContent = 'at current price';
    document.getElementById('sumAvgDaily').textContent = fmtBTC(avgDaily, 8);
    document.getElementById('sumTotalPayouts').textContent = data.payouts.length;
    document.getElementById('sumPayoutBTC').textContent = fmtBTC(totalPayoutBTC, 6) + ' BTC';

    if (data.lastSnapshotDate && data.snapshots.length > 0) {
        var lastSnap = data.snapshots[data.snapshots.length - 1];
        document.getElementById('sumLastSnapshot').textContent = fmtBTC(lastSnap.btcEarned, 8);
        document.getElementById('sumSnapshotDate').textContent = lastSnap.date;
    } else {
        document.getElementById('sumLastSnapshot').textContent = '--';
        document.getElementById('sumSnapshotDate').textContent = 'Connect F2Pool for auto-logging';
    }

    renderPayoutTable();
    renderElectricitySummary();
    renderElectricityTable();
}

// ===== AUTO-ESTIMATE ELECTRICITY FROM FLEET =====
function autoEstimateElectricity() {
    var summary = FleetData.getFleetSummary();
    if (summary.totalPower <= 0) {
        alert('No online miners in fleet. Add miners on the Dashboard page first.');
        return false;
    }

    // Get electricity rate and uptime from calculator settings or fleet defaults
    var calcSettings = null;
    try {
        var raw = localStorage.getItem('btcMinerCalcSettings');
        if (raw) calcSettings = JSON.parse(raw);
    } catch(e) {}

    var elecCost = (calcSettings && calcSettings.elecCost) ? parseFloat(calcSettings.elecCost) : summary.defaults.elecCost;
    var uptime = (calcSettings && calcSettings.uptime !== undefined) ? parseFloat(calcSettings.uptime) : 100;

    // Calculate for current month
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var monthLabel = now.toLocaleString('default', { month: 'long' }) + ' ' + year;
    var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    // Check if fleet estimate already exists for this month
    var entries = ElectricityData.getData();
    for (var i = 0; i < entries.length; i++) {
        if (entries[i].notes && entries[i].notes.indexOf('Fleet estimate') === 0 &&
            entries[i].date.substring(0, 7) === dateStr.substring(0, 7)) {
            alert('Fleet estimate for ' + monthLabel + ' already exists. Delete it first to re-estimate.');
            return false;
        }
    }

    var totalKWh = summary.totalPower * 24 * daysInMonth * (uptime / 100);
    var totalCost = totalKWh * elecCost;

    ElectricityData.addEntry({
        date: dateStr,
        kwhUsed: Math.round(totalKWh),
        costUSD: Math.round(totalCost * 100) / 100,
        notes: 'Fleet estimate — ' + monthLabel + ' (' + summary.totalPower.toFixed(2) + ' kW \u00d7 ' + daysInMonth + 'd @ $' + elecCost.toFixed(4) + '/kWh)'
    });

    renderPayoutPage();
    updateRevCostChart();
    return true;
}

// ===== ELECTRICITY RENDER =====
function renderElectricitySummary() {
    var sum = ElectricityData.getSummary();
    document.getElementById('elecTotalCost').textContent = fmtUSD(sum.totalCost);
    document.getElementById('elecAvgMonthly').textContent = fmtUSD(sum.avgMonthly);
    document.getElementById('elecTotalKWh').textContent = sum.totalKWh.toLocaleString() + ' kWh';
    document.getElementById('elecEffRate').textContent = '$' + sum.effectiveRate.toFixed(4) + '/kWh';
}

function renderElectricityTable() {
    var entries = ElectricityData.getData();
    var tbody = document.getElementById('elecTableBody');

    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#555;">No electricity bills logged yet</td></tr>';
        return;
    }

    var sorted = entries.slice().sort(function(a, b) {
        return new Date(b.date) - new Date(a.date);
    });

    var html = '';
    for (var i = 0; i < sorted.length; i++) {
        var e = sorted[i];
        html += '<tr>' +
            '<td>' + e.date + '</td>' +
            '<td>' + e.kwhUsed.toLocaleString() + '</td>' +
            '<td style="color:#ef4444">' + fmtUSD(e.costUSD) + '</td>' +
            '<td>$' + e.effectiveRate.toFixed(4) + '</td>' +
            '<td>' + (e.notes || '--') + '</td>' +
            '<td><button class="delete-elec" data-id="' + e.id + '">&times;</button></td>' +
        '</tr>';
    }
    tbody.innerHTML = html;

    var btns = tbody.querySelectorAll('.delete-elec');
    for (var j = 0; j < btns.length; j++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                if (confirm('Delete this electricity entry?')) {
                    ElectricityData.removeEntry(btn.getAttribute('data-id'));
                    renderPayoutPage();
                    updateRevCostChart();
                }
            });
        })(btns[j]);
    }
}

function renderPayoutTable() {
    var data = PayoutData.getData();
    var tbody = document.getElementById('payoutTableBody');

    if (data.payouts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#555;">No payouts logged yet</td></tr>';
        return;
    }

    // Sort by date descending
    var sorted = data.payouts.slice().sort(function(a, b) {
        return new Date(b.date) - new Date(a.date);
    });

    var html = '';
    for (var i = 0; i < sorted.length; i++) {
        var p = sorted[i];
        var txDisplay = p.txHash
            ? '<a href="https://mempool.space/tx/' + p.txHash + '" target="_blank" rel="noopener" style="color:#f7931a; text-decoration:none;" title="' + p.txHash + '">' + p.txHash.substring(0, 12) + '...</a>'
            : '--';
        html += '<tr>' +
            '<td>' + p.date + '</td>' +
            '<td style="color:#f7931a">' + fmtBTC(p.btcAmount, 8) + '</td>' +
            '<td>' + fmtUSD(p.btcPrice) + '</td>' +
            '<td>' + fmtUSD(p.usdValue) + '</td>' +
            '<td style="font-family:monospace; font-size:11px;">' + txDisplay + '</td>' +
            '<td>' + (p.notes || '--') + '</td>' +
            '<td><button class="delete-payout" data-id="' + p.id + '">&times;</button></td>' +
        '</tr>';
    }
    tbody.innerHTML = html;

    // Attach delete handlers
    var btns = tbody.querySelectorAll('.delete-payout');
    for (var j = 0; j < btns.length; j++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                if (confirm('Delete this payout entry?')) {
                    PayoutData.removePayout(btn.getAttribute('data-id'));
                    renderPayoutPage();
                    updatePayoutChart();
                }
            });
        })(btns[j]);
    }
}

// ===== PANEL HANDLERS =====
var addPayoutPanel = document.getElementById('addPayoutPanel');
var addBillPanel = document.getElementById('addBillPanel');

// -- Add Bill panel --
document.getElementById('btnAddBill').addEventListener('click', function() {
    document.getElementById('fbDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('fbKwh').value = '';
    document.getElementById('fbCost').value = '';
    document.getElementById('fbNotes').value = '';
    addPayoutPanel.classList.remove('open');
    addBillPanel.classList.toggle('open');
});

document.getElementById('cancelBill').addEventListener('click', function() {
    addBillPanel.classList.remove('open');
});

// -- Estimate from Fleet button --
document.getElementById('btnEstimateFleet').addEventListener('click', function() {
    addPayoutPanel.classList.remove('open');
    addBillPanel.classList.remove('open');
    autoEstimateElectricity();
});

document.getElementById('saveBill').addEventListener('click', function() {
    var date = document.getElementById('fbDate').value;
    var kwhUsed = parseFloat(document.getElementById('fbKwh').value);
    var costUSD = parseFloat(document.getElementById('fbCost').value);
    var notes = document.getElementById('fbNotes').value.trim();

    if (!date || !kwhUsed || kwhUsed <= 0 || !costUSD || costUSD <= 0) return;

    ElectricityData.addEntry({
        date: date,
        kwhUsed: kwhUsed,
        costUSD: costUSD,
        notes: notes
    });

    addBillPanel.classList.remove('open');
    renderPayoutPage();
    updateRevCostChart();
});

document.getElementById('btnAddPayout').addEventListener('click', function() {
    document.getElementById('fpDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('fpBtcAmount').value = '';
    document.getElementById('fpBtcPrice').value = '';
    document.getElementById('fpTxHash').value = '';
    document.getElementById('fpNotes').value = '';
    addBillPanel.classList.remove('open');
    addPayoutPanel.classList.toggle('open');
});

document.getElementById('cancelPayout').addEventListener('click', function() {
    addPayoutPanel.classList.remove('open');
});

document.getElementById('savePayout').addEventListener('click', function() {
    var date = document.getElementById('fpDate').value;
    var btcAmount = parseFloat(document.getElementById('fpBtcAmount').value);
    var btcPrice = parseFloat(document.getElementById('fpBtcPrice').value) || liveBtcPrice;
    var txHash = document.getElementById('fpTxHash').value.trim();
    var notes = document.getElementById('fpNotes').value.trim();

    if (!date || !btcAmount || btcAmount <= 0) return;

    PayoutData.addPayout({
        date: date,
        btcAmount: btcAmount,
        btcPrice: btcPrice,
        usdValue: btcAmount * btcPrice,
        txHash: txHash,
        notes: notes
    });

    addPayoutPanel.classList.remove('open');
    renderPayoutPage();
    updatePayoutChart();
});

// ===== EARNINGS CHART =====
function initPayoutChart() {
    var ctx = document.getElementById('earningsOverTimeChart');
    var chartData = generatePayoutChartData();

    payoutChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: 'Cumulative BTC',
                    data: chartData.btcValues,
                    borderColor: '#f7931a',
                    backgroundColor: 'rgba(247, 147, 26, 0.1)',
                    fill: true,
                    borderWidth: 2,
                    yAxisID: 'y',
                    pointRadius: 3,
                    tension: 0.3
                },
                {
                    label: 'USD Value',
                    data: chartData.usdValues,
                    borderColor: '#4ade80',
                    backgroundColor: 'rgba(74, 222, 128, 0.1)',
                    fill: true,
                    borderWidth: 2,
                    yAxisID: 'y1',
                    pointRadius: 3,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top', labels: { color: '#e8e8e8', font: { size: 11 } } },
                tooltip: {
                    backgroundColor: 'rgba(10, 10, 10, 0.92)',
                    borderColor: 'rgba(255, 255, 255, 0.10)',
                    borderWidth: 1,
                    titleColor: '#e8e8e8',
                    bodyColor: '#e8e8e8',
                    padding: 10
                }
            },
            scales: {
                x: {
                    ticks: { color: '#888', font: { size: 11 } },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    ticks: {
                        color: '#f7931a',
                        font: { size: 11 },
                        callback: function(v) { return v.toFixed(4) + ' BTC'; }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    ticks: {
                        color: '#4ade80',
                        font: { size: 11 },
                        callback: function(v) { return '$' + v.toFixed(0); }
                    },
                    grid: { display: false }
                }
            }
        }
    });

    var emptyMsg = document.getElementById('chartEmptyMsg');
    if (emptyMsg) emptyMsg.style.display = chartData.labels.length === 0 ? 'flex' : 'none';
}

function generatePayoutChartData() {
    var data = PayoutData.getData();
    var labels = [];
    var btcValues = [];
    var usdValues = [];

    // Merge snapshots and payouts, sort by date
    var entries = [];
    for (var i = 0; i < data.snapshots.length; i++) {
        var s = data.snapshots[i];
        entries.push({ date: s.date, btc: s.btcEarned, price: s.btcPrice });
    }
    for (var p = 0; p < data.payouts.length; p++) {
        var pay = data.payouts[p];
        entries.push({ date: pay.date, btc: pay.btcAmount, price: pay.btcPrice });
    }
    entries.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    var cumBTC = 0;
    for (var j = 0; j < entries.length; j++) {
        cumBTC += entries[j].btc;
        labels.push(entries[j].date);
        btcValues.push(cumBTC);
        usdValues.push(cumBTC * entries[j].price);
    }

    return { labels: labels, btcValues: btcValues, usdValues: usdValues };
}

function updatePayoutChart() {
    if (!payoutChart) return;
    var chartData = generatePayoutChartData();
    payoutChart.data.labels = chartData.labels;
    payoutChart.data.datasets[0].data = chartData.btcValues;
    payoutChart.data.datasets[1].data = chartData.usdValues;
    payoutChart.update();
    var emptyMsg = document.getElementById('chartEmptyMsg');
    if (emptyMsg) emptyMsg.style.display = chartData.labels.length === 0 ? 'flex' : 'none';
}

// ===== REVENUE VS COSTS CHART =====
var revCostChart = null;

function initRevCostChart() {
    var ctx = document.getElementById('revVsCostChart');
    if (!ctx) return;
    var chartData = generateRevCostData();

    revCostChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: 'Cumulative Revenue',
                    data: chartData.revenue,
                    borderColor: '#4ade80',
                    backgroundColor: 'rgba(74, 222, 128, 0.1)',
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.3
                },
                {
                    label: 'Cumulative Electricity Cost',
                    data: chartData.costs,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top', labels: { color: '#e8e8e8', font: { size: 11 } } },
                tooltip: {
                    backgroundColor: 'rgba(10, 10, 10, 0.92)',
                    borderColor: 'rgba(255, 255, 255, 0.10)',
                    borderWidth: 1,
                    titleColor: '#e8e8e8',
                    bodyColor: '#e8e8e8',
                    padding: 10,
                    callbacks: {
                        label: function(ctx) { return ctx.dataset.label + ': ' + fmtUSD(ctx.parsed.y); }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#888', font: { size: 11 } },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                },
                y: {
                    ticks: {
                        color: '#e8e8e8',
                        font: { size: 11 },
                        callback: function(v) { return '$' + v.toLocaleString(); }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                }
            }
        }
    });

    var emptyMsg = document.getElementById('revCostEmptyMsg');
    if (emptyMsg) emptyMsg.style.display = chartData.labels.length === 0 ? 'flex' : 'none';
}

function generateRevCostData() {
    var payoutData = PayoutData.getData();
    var elecEntries = ElectricityData.getData();

    // Build date-keyed map of all events
    var dateMap = {};
    for (var i = 0; i < payoutData.payouts.length; i++) {
        var p = payoutData.payouts[i];
        if (!dateMap[p.date]) dateMap[p.date] = { revenue: 0, cost: 0 };
        dateMap[p.date].revenue += p.usdValue;
    }
    for (var s = 0; s < payoutData.snapshots.length; s++) {
        var snap = payoutData.snapshots[s];
        if (!dateMap[snap.date]) dateMap[snap.date] = { revenue: 0, cost: 0 };
        dateMap[snap.date].revenue += snap.btcEarned * snap.btcPrice;
    }
    for (var e = 0; e < elecEntries.length; e++) {
        var bill = elecEntries[e];
        if (!dateMap[bill.date]) dateMap[bill.date] = { revenue: 0, cost: 0 };
        dateMap[bill.date].cost += bill.costUSD;
    }

    // Sort dates
    var dates = Object.keys(dateMap).sort();
    var labels = [];
    var revenue = [];
    var costs = [];
    var cumRev = 0, cumCost = 0;

    for (var d = 0; d < dates.length; d++) {
        cumRev += dateMap[dates[d]].revenue;
        cumCost += dateMap[dates[d]].cost;
        labels.push(dates[d]);
        revenue.push(Math.round(cumRev * 100) / 100);
        costs.push(Math.round(cumCost * 100) / 100);
    }

    return { labels: labels, revenue: revenue, costs: costs };
}

function updateRevCostChart() {
    if (!revCostChart) return;
    var chartData = generateRevCostData();
    revCostChart.data.labels = chartData.labels;
    revCostChart.data.datasets[0].data = chartData.revenue;
    revCostChart.data.datasets[1].data = chartData.costs;
    revCostChart.update();
    var emptyMsg = document.getElementById('revCostEmptyMsg');
    if (emptyMsg) emptyMsg.style.display = chartData.labels.length === 0 ? 'flex' : 'none';
}


// ===== SECTION 5: ACCOUNTING TAB LOGIC (from accounting.js) =====

// ===== PERIOD MANAGEMENT =====
function setPeriod(type) {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth();
    if (type === 'month') {
        acctPeriod.start = y + '-' + String(m + 1).padStart(2, '0') + '-01';
        var lastDay = new Date(y, m + 1, 0).getDate();
        acctPeriod.end = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
    } else if (type === 'quarter') {
        var qStart = Math.floor(m / 3) * 3;
        acctPeriod.start = y + '-' + String(qStart + 1).padStart(2, '0') + '-01';
        var qEndMonth = qStart + 3;
        var qEndYear = y;
        if (qEndMonth > 12) { qEndMonth = 12; }
        var qLastDay = new Date(qEndYear, qEndMonth, 0).getDate();
        acctPeriod.end = qEndYear + '-' + String(qEndMonth).padStart(2, '0') + '-' + String(qLastDay).padStart(2, '0');
    } else if (type === 'year') {
        acctPeriod.start = y + '-01-01';
        acctPeriod.end = y + '-12-31';
    }
}

// Period selector buttons
document.getElementById('periodSelector').addEventListener('click', function(e) {
    var btn = e.target.closest('.range-btn');
    if (!btn) return;
    var period = btn.getAttribute('data-period');

    // Update active state
    var all = document.querySelectorAll('#periodSelector .range-btn');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
    btn.classList.add('active');

    var customRange = document.getElementById('customDateRange');
    if (period === 'custom') {
        customRange.style.display = 'flex';
        return;
    }
    customRange.style.display = 'none';
    setPeriod(period);
    renderAccounting();
});

document.getElementById('btnApplyCustom').addEventListener('click', function() {
    var s = document.getElementById('acctStartDate').value;
    var e = document.getElementById('acctEndDate').value;
    if (s && e) {
        acctPeriod.start = s;
        acctPeriod.end = e;
        renderAccounting();
    }
});

// ===== QBO CONNECTION (OAUTH) =====
function getQboProxyUrl() {
    return 'https://ion-quickbooks.ion-mining.workers.dev';
}

async function connectQuickBooks() {
    // Direct token check instead of StrikeAuth.isLoggedIn() to avoid cache issues
    const token = StrikeAuth.getToken();
    if (!token) {
        alert('Please sign in with Google first (top right corner)');
        return;
    }

    var proxyUrl = getQboProxyUrl();
    var result = document.getElementById('qboTestResult');
    if (result) result.innerHTML = '<span style="color:#888;">Starting OAuth...</span>';

    try {
        var initRes = await fetch(proxyUrl + '/auth/qbo/initiate', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + StrikeAuth.getToken(),
                'Content-Type': 'application/json'
            }
        });

        var initData = await initRes.json();
        if (!initData.authUrl) throw new Error('No auth URL');

        var width = 600, height = 700;
        var left = (screen.width - width) / 2;
        var top = (screen.height - height) / 2;
        var popup = window.open(initData.authUrl, 'QuickBooks OAuth',
            'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top);

        if (!popup) throw new Error('Popup blocked');
        if (result) result.innerHTML = '<span style="color:#888;">Authorize in popup...</span>';

        var handler = function(event) {
            if (event.data && event.data.type === 'qbo-oauth-success') {
                window.removeEventListener('message', handler);
                onQuickBooksConnected(event.data.companyName);
            }
        };
        window.addEventListener('message', handler);

        var interval = setInterval(function() {
            if (popup.closed) {
                clearInterval(interval);
                window.removeEventListener('message', handler);
                checkQboConnectionStatus();
            }
        }, 500);

    } catch (e) {
        if (result) result.innerHTML = '<span style="color:#f55;">Error: ' + e.message + '</span>';
    }
}

async function disconnectQuickBooks() {
    if (!confirm('Disconnect QuickBooks?')) return;

    var proxyUrl = getQboProxyUrl();
    var res = await fetch(proxyUrl + '/auth/qbo/disconnect', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + StrikeAuth.getToken() }
    });

    if (res.ok) {
        qboConnected = false;
        qboData = { accounts: [], expenses: [], invoices: [] };
        updateQboStatus(null);
        renderAccounting();
    }
}

async function disconnectStrike() {
    if (!confirm('Disconnect Strike? You will need to reconnect to view wallet data.')) {
        return;
    }

    try {
        // Clear Strike session
        StrikeAuth.clearStrikeSession();

        // Update global UI
        var btnConnect = document.getElementById('btnConnectStrikeGlobal');
        var badge = document.getElementById('strikeConnectedBadge');
        if (btnConnect) btnConnect.style.display = 'block';
        if (badge) badge.style.display = 'none';

        // Clear Strike wallet data
        if (typeof clearStrikeWalletData === 'function') {
            clearStrikeWalletData();
        }

        alert('Strike disconnected successfully');
    } catch (err) {
        console.error('Strike disconnect error:', err);
        alert('Failed to disconnect Strike: ' + err.message);
    }
}

async function checkQboConnectionStatus() {
    if (!StrikeAuth.isLoggedIn()) return;

    var proxyUrl = getQboProxyUrl();
    var res = await fetch(proxyUrl + '/auth/qbo/status', {
        headers: { 'Authorization': 'Bearer ' + StrikeAuth.getToken() }
    });

    if (res.ok) {
        var data = await res.json();
        if (data.connected) {
            onQuickBooksConnected(data.companyName);
        } else {
            qboConnected = false;
            updateQboStatus(null);
        }
    }
}

function onQuickBooksConnected(companyName) {
    qboConnected = true;
    updateQboStatus(companyName || 'Connected');
    var result = document.getElementById('qboTestResult');
    if (result) result.innerHTML = '<span style="color:#4ade80;">Connected: ' + companyName + '</span>';
    document.getElementById('qboConnectPanel').classList.remove('open');
    loadAccountingData();
}

function updateQboStatus(companyName) {
    var badge = document.getElementById('qboStatusBadge');
    var notConnected = document.getElementById('qboNotConnected');
    var connected = document.getElementById('qboConnected');
    var companyNameEl = document.getElementById('qboCompanyName');

    // Update global nav bar badges
    var btnConnectGlobal = document.getElementById('btnConnectQbGlobal');
    var badgeConnected = document.getElementById('qbConnectedBadge');
    var badgeName = document.getElementById('qbConnectedName');

    if (companyName) {
        if (badge) {
            badge.textContent = 'QuickBooks: ' + companyName;
            badge.className = 'status-badge status-connected';
        }
        if (notConnected) notConnected.style.display = 'none';
        if (connected) connected.style.display = '';
        if (companyNameEl) companyNameEl.textContent = companyName;

        // Update global nav bar
        if (btnConnectGlobal) btnConnectGlobal.style.display = 'none';
        if (badgeConnected) badgeConnected.style.display = 'flex';
        if (badgeName) badgeName.textContent = companyName;
    } else {
        if (badge) {
            badge.textContent = 'QuickBooks: Not Connected';
            badge.className = 'status-badge status-disconnected';
        }
        if (notConnected) notConnected.style.display = '';
        if (connected) connected.style.display = 'none';

        // Update global nav bar
        if (btnConnectGlobal) btnConnectGlobal.style.display = 'block';
        if (badgeConnected) badgeConnected.style.display = 'none';
    }
}

// Old button removed - now using btnConnectQbGlobal
var oldQboBtn = document.getElementById('btnConnectQbo');
if (oldQboBtn) {
    oldQboBtn.addEventListener('click', function() {
        document.getElementById('qboConnectPanel').classList.toggle('open');
    });
}

var connectBtn = document.getElementById('connectQbo');
if (connectBtn) connectBtn.addEventListener('click', connectQuickBooks);

var disconnectBtn = document.getElementById('disconnectQbo');
if (disconnectBtn) disconnectBtn.addEventListener('click', disconnectQuickBooks);

if (typeof StrikeAuth !== 'undefined' && StrikeAuth.isLoggedIn()) {
    checkQboConnectionStatus();
}

// ===== STRIKE CONNECTION =====
function loadStrikeAcctSettings() {
    var settings = FleetData.getSettings();
    if (settings.strike && settings.strike.proxyUrl && settings.strike.enabled) {
        document.getElementById('strikeProxyUrlAcct').value = settings.strike.proxyUrl;
        acctStrikeConnected = true;
        if (StrikeAuth.isLoggedIn()) {
            updateStrikeAcctStatus('Connected & Authenticated');
        } else {
            updateStrikeAcctStatus('Connected (Not Authenticated)');
        }
    }
}

function updateStrikeAcctStatus(label) {
    var badge = document.getElementById('strikeStatusBadgeAcct');
    if (label) {
        badge.textContent = 'Strike: ' + label;
        badge.className = 'status-badge status-connected';
    } else {
        badge.textContent = 'Strike: Not Connected';
        badge.className = 'status-badge status-disconnected';
    }
}

async function fetchStrikeAccountingData() {
    if (!acctStrikeConnected) return;
    if (!StrikeAuth.isLoggedIn()) {
        console.warn('[Accounting] Strike not authenticated, skipping data fetch');
        return;
    }
    try {
        var [deposits, payouts, receives] = await Promise.all([
            StrikeAPI.getDeposits(),
            StrikeAPI.getPayouts(),
            StrikeAPI.getReceives()
        ]);

        // Extract .items from API response (format: { items: [...] } or just [...])
        strikeAcctData.deposits = (deposits && !deposits.error && Array.isArray(deposits.items || deposits))
            ? (deposits.items || deposits) : [];
        strikeAcctData.payouts = (payouts && !payouts.error && Array.isArray(payouts.items || payouts))
            ? (payouts.items || payouts) : [];
        strikeAcctData.receives = (receives && !receives.error && Array.isArray(receives.items || receives))
            ? (receives.items || receives) : [];
    } catch(e) {
        console.error('[Accounting] Strike fetch error:', e);
    }
}

function parseStrikeAmountAcct(amountObj) {
    if (!amountObj) return { btc: 0, usd: 0, currency: 'BTC' };
    if (typeof amountObj === 'object') {
        var val = parseFloat(amountObj.amount) || 0;
        var cur = (amountObj.currency || '').toUpperCase();
        if (cur === 'BTC') return { btc: val, usd: val * (acctBtcPrice || 0), currency: 'BTC' };
        if (cur === 'USD') return { btc: (acctBtcPrice > 0 ? val / acctBtcPrice : 0), usd: val, currency: 'USD' };
        return { btc: 0, usd: val, currency: cur };
    }
    return { btc: 0, usd: 0, currency: 'BTC' };
}

function strikeItemDate(item) {
    var d = item.completed || item.completedAt || item.created || item.createdAt || '';
    if (!d) return '';
    return d.substring(0, 10); // YYYY-MM-DD
}

// Strike panel handlers (old accounting button removed - now using global)
var oldStrikeAcctBtn = document.getElementById('btnConnectStrikeAcct');
if (oldStrikeAcctBtn) {
    oldStrikeAcctBtn.addEventListener('click', function() {
        var settings = FleetData.getSettings();
        if (settings.strike && settings.strike.proxyUrl) {
            var urlInput = document.getElementById('strikeProxyUrlAcct');
            if (urlInput) urlInput.value = settings.strike.proxyUrl;
        }
        var result = document.getElementById('strikeTestResultAcct');
        if (result) result.innerHTML = '';
        var panel = document.getElementById('acctStrikeConnectPanel');
        if (panel) panel.classList.toggle('open');
    });
}

document.getElementById('cancelStrikeAcct').addEventListener('click', function() {
    document.getElementById('acctStrikeConnectPanel').classList.remove('open');
});

document.getElementById('testStrikeAcct').addEventListener('click', async function() {
    var url = document.getElementById('strikeProxyUrlAcct').value.trim();
    var result = document.getElementById('strikeTestResultAcct');
    if (!url) { result.innerHTML = '<span style="color:#f55;">Enter a proxy URL</span>'; return; }
    result.innerHTML = '<span style="color:#888;">Testing...</span>';
    var settings = FleetData.getSettings();
    if (!settings.strike) settings.strike = {};
    var oldUrl = settings.strike.proxyUrl;
    settings.strike.proxyUrl = url;
    FleetData.saveSettings(settings);
    var data = await strikeApiFetch('/ping');
    settings.strike.proxyUrl = oldUrl;
    FleetData.saveSettings(settings);
    if (data && !data.error && data.ok) {
        var balances = data.balances || data;
        var balArr = Array.isArray(balances) ? balances : (balances.items || [balances]);
        var info = [];
        for (var i = 0; i < balArr.length; i++) info.push(balArr[i].currency + ': ' + (balArr[i].available || balArr[i].total || balArr[i].amount || '0'));
        result.innerHTML = '<span style="color:#4ade80;">Connected! Balances: ' + info.join(', ') + '</span>';
    } else {
        result.innerHTML = '<span style="color:#f55;">Failed: ' + ((data && data.error) || 'Unknown') + '</span>';
    }
});

document.getElementById('saveStrikeAcct').addEventListener('click', async function() {
    var url = document.getElementById('strikeProxyUrlAcct').value.trim();
    var settings = FleetData.getSettings();
    if (!url) {
        settings.strike = { proxyUrl: '', enabled: false, lastSync: null };
        FleetData.saveSettings(settings);
        acctStrikeConnected = false;
        strikeAcctData = { deposits: [], payouts: [], receives: [] };
        updateStrikeAcctStatus(null);
        document.getElementById('acctStrikeConnectPanel').classList.remove('open');
        renderAccounting();
        return;
    }
    settings.strike = { proxyUrl: url, enabled: true, lastSync: new Date().toISOString() };
    FleetData.saveSettings(settings);
    acctStrikeConnected = true;
    updateStrikeAcctStatus('Connected');
    document.getElementById('acctStrikeConnectPanel').classList.remove('open');
    await fetchStrikeAccountingData();
    renderAccounting();
});

// ===== DATA LOADING =====
async function loadAccountingData() {
    if (!qboConnected || !StrikeAuth.isLoggedIn()) return;

    var proxyUrl = getQboProxyUrl();
    var headers = { 'Authorization': 'Bearer ' + StrikeAuth.getToken() };

    try {
        var [accountsRes, expensesRes, invoicesRes] = await Promise.all([
            fetch(proxyUrl + '/accounts', { headers: headers }).then(function(r) { return r.json(); }).catch(function() { return { accounts: [] }; }),
            fetch(proxyUrl + '/expenses?start=' + acctPeriod.start + '&end=' + acctPeriod.end, { headers: headers }).then(function(r) { return r.json(); }).catch(function() { return { expenses: [] }; }),
            fetch(proxyUrl + '/invoices', { headers: headers }).then(function(r) { return r.json(); }).catch(function() { return { invoices: [] }; })
        ]);
        qboData.accounts = accountsRes.accounts || [];
        qboData.expenses = expensesRes.expenses || [];
        qboData.invoices = invoicesRes.invoices || [];
    } catch (e) {
        console.warn('[Accounting] QBO fetch error:', e.message);
    }
}

// ===== UNIFIED P&L CALCULATION =====
function buildUnifiedPnL() {
    var payoutData = PayoutData.getData();
    var elecData = ElectricityData.getData();
    var fleet = FleetData.getFleet();
    var mult = getCurrencyMultiplier();

    var totalRevenueBtc = 0;
    var totalRevenueUsd = 0;
    var totalExpenses = 0;
    var totalCapex = 0;
    var revenueEntries = [];

    // BTC Revenue: payouts
    for (var i = 0; i < payoutData.payouts.length; i++) {
        var p = payoutData.payouts[i];
        if (p.date >= acctPeriod.start && p.date <= acctPeriod.end) {
            var usd = p.usdValue || (p.btcAmount * p.btcPrice);
            totalRevenueBtc += p.btcAmount;
            totalRevenueUsd += usd;
            revenueEntries.push({
                date: p.date,
                source: p.notes || 'Payout',
                btcAmount: p.btcAmount,
                btcPrice: p.btcPrice,
                usdValue: usd,
                category: 'Payout'
            });
        }
    }

    // BTC Revenue: snapshots
    for (var s = 0; s < payoutData.snapshots.length; s++) {
        var snap = payoutData.snapshots[s];
        if (snap.date >= acctPeriod.start && snap.date <= acctPeriod.end) {
            var snapUsd = snap.btcEarned * snap.btcPrice;
            totalRevenueBtc += snap.btcEarned;
            totalRevenueUsd += snapUsd;
            revenueEntries.push({
                date: snap.date,
                source: 'Daily Snapshot',
                btcAmount: snap.btcEarned,
                btcPrice: snap.btcPrice,
                usdValue: snapUsd,
                category: 'Mining'
            });
        }
    }

    // Strike deposits + receives as revenue
    if (acctStrikeConnected) {
        var allStrikeIn = strikeAcctData.deposits.concat(strikeAcctData.receives);
        for (var si = 0; si < allStrikeIn.length; si++) {
            var sItem = allStrikeIn[si];
            var sDate = strikeItemDate(sItem);
            if (sDate >= acctPeriod.start && sDate <= acctPeriod.end) {
                var sAmt = parseStrikeAmountAcct(sItem.amountReceived || sItem.amountCredited || sItem.amount);
                totalRevenueBtc += sAmt.btc;
                totalRevenueUsd += sAmt.usd;
                revenueEntries.push({
                    date: sDate,
                    source: 'Strike ' + (sItem.depositId ? 'Deposit' : 'Receive'),
                    btcAmount: sAmt.btc,
                    btcPrice: acctBtcPrice || 0,
                    usdValue: sAmt.usd,
                    category: 'Strike Deposit'
                });
            }
        }
    }

    revenueEntries.sort(function(a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : 0; });

    // Expenses: QBO expenses or local electricity bills
    var expenseEntries = [];
    if (qboConnected && qboData.expenses.length > 0) {
        for (var e = 0; e < qboData.expenses.length; e++) {
            var exp = qboData.expenses[e];
            totalExpenses += exp.amount;
            expenseEntries.push({
                date: exp.date,
                vendor: exp.vendor,
                category: exp.category,
                amount: exp.amount,
                account: exp.accountName
            });
        }
    } else {
        // Fallback to local electricity data
        for (var b = 0; b < elecData.length; b++) {
            var bill = elecData[b];
            if (bill.date >= acctPeriod.start && bill.date <= acctPeriod.end) {
                totalExpenses += bill.costUSD;
                expenseEntries.push({
                    date: bill.date,
                    vendor: 'Electric Utility',
                    category: 'Electricity (' + bill.kwhUsed + ' kWh)',
                    amount: bill.costUSD,
                    account: 'Local Data'
                });
            }
        }
    }

    // Strike payouts as expenses
    if (acctStrikeConnected) {
        for (var sp = 0; sp < strikeAcctData.payouts.length; sp++) {
            var sPay = strikeAcctData.payouts[sp];
            var spDate = strikeItemDate(sPay);
            if (spDate >= acctPeriod.start && spDate <= acctPeriod.end) {
                var spAmt = parseStrikeAmountAcct(sPay.amount || sPay.amountPaid);
                totalExpenses += spAmt.usd;
                expenseEntries.push({
                    date: spDate,
                    vendor: 'Strike Payout',
                    category: 'Strike Transfer',
                    amount: spAmt.usd,
                    account: 'Strike'
                });
            }
        }
    }

    // Equipment CAPEX
    var capexCount = 0;
    for (var mi = 0; mi < fleet.miners.length; mi++) {
        var m = fleet.miners[mi];
        var pDate = m.purchaseDate || m.dateAdded.split('T')[0];
        if (pDate >= acctPeriod.start && pDate <= acctPeriod.end) {
            var minerCost = m.cost * m.quantity;
            totalCapex += minerCost;
            capexCount += m.quantity;
        }
    }

    // Unpaid balance from pool earnings
    var unpaidBtc = 0;
    if (window.poolEarnings) {
        for (var poolId in window.poolEarnings) {
            var pe = window.poolEarnings[poolId];
            if (pe && pe.balance) unpaidBtc += pe.balance;
        }
    }

    return {
        revenueBtc: totalRevenueBtc,
        revenueUsd: totalRevenueUsd * mult,
        expenses: totalExpenses * mult,
        capex: totalCapex * mult,
        net: (totalRevenueUsd - totalExpenses - totalCapex) * mult,
        unpaidBtc: unpaidBtc,
        unpaidUsd: unpaidBtc * (acctBtcPrice || 0) * mult,
        revenueEntries: revenueEntries,
        expenseEntries: expenseEntries,
        capexCount: capexCount,
        expenseSource: (function() {
            var sources = [];
            if (qboConnected && qboData.expenses.length > 0) sources.push('QuickBooks');
            if (acctStrikeConnected && strikeAcctData.payouts.length > 0) sources.push('Strike');
            return sources.length > 0 ? 'from ' + sources.join(' + ') : 'from local data';
        })()
    };
}

// ===== RENDERING =====
function renderAccounting() {
    var pnl = buildUnifiedPnL();
    renderPnLSummary(pnl);
    updatePnLChart(pnl);
    updateExpenseDoughnut(pnl);
    renderBankAccounts();
    renderRevenueTable(pnl.revenueEntries);
    renderExpenseTable(pnl.expenseEntries);
    renderInvoiceTable();
    renderAssetsOverview();
}

function renderAssetsOverview() {
    var html = '';
    var totalUSD = 0;
    var totalBTC = 0;

    // 1. Cold Wallets
    var walletData = WalletData.getData();
    var coldWalletBTC = 0;
    for (var i = 0; i < walletData.addresses.length; i++) {
        coldWalletBTC += walletData.addresses[i].lastBalance;
    }
    var coldWalletUSD = coldWalletBTC * liveBtcPrice;
    totalBTC += coldWalletBTC;
    totalUSD += coldWalletUSD;

    html += '<div class="metric-card">';
    html += '<div class="label">Cold Wallets</div>';
    html += '<div class="value btc-orange">' + fmtBTC(coldWalletBTC, 8) + '</div>';
    html += '<div class="sub">' + fmtUSD(coldWalletUSD) + '</div>';
    html += '</div>';

    // 2. Strike BTC
    var strikeBTC = 0;
    var strikeUSD = 0;
    if (acctStrikeConnected && StrikeAuth.isLoggedIn()) {
        strikeBTC = getStrikeBtcBalance();
        var strikeBTCUsd = strikeBTC * liveBtcPrice;
        totalBTC += strikeBTC;
        totalUSD += strikeBTCUsd;

        html += '<div class="metric-card">';
        html += '<div class="label">Strike (BTC)</div>';
        html += '<div class="value btc-orange">' + fmtBTC(strikeBTC, 8) + '</div>';
        html += '<div class="sub">' + fmtUSD(strikeBTCUsd) + '</div>';
        html += '</div>';

        // 3. Strike USD
        strikeUSD = getStrikeUsdBalance();
        totalUSD += strikeUSD;

        html += '<div class="metric-card">';
        html += '<div class="label">Strike (USD)</div>';
        html += '<div class="value positive">' + fmtUSD(strikeUSD) + '</div>';
        html += '<div class="sub">Fiat balance</div>';
        html += '</div>';
    }

    // 4. Pool Unpaid
    var pnl = buildUnifiedPnL();
    var unpaidBTC = pnl.unpaidBtc || 0;
    var unpaidUSD = unpaidBTC * liveBtcPrice;
    totalBTC += unpaidBTC;
    totalUSD += unpaidUSD;

    html += '<div class="metric-card">';
    html += '<div class="label">Pool Unpaid</div>';
    html += '<div class="value btc-orange">' + fmtBTC(unpaidBTC, 8) + '</div>';
    html += '<div class="sub">' + fmtUSD(unpaidUSD) + '</div>';
    html += '</div>';

    // 5. QBO Bank Accounts (if connected)
    var qboTotal = 0;
    if (qboConnected && qboData.accounts && qboData.accounts.length > 0) {
        for (var i = 0; i < qboData.accounts.length; i++) {
            var acct = qboData.accounts[i];
            var balance = acct.balance || 0;
            qboTotal += balance;
            html += '<div class="metric-card">';
            html += '<div class="label">' + escapeHtml(acct.name || 'Bank Account') + '</div>';
            html += '<div class="value neutral">' + fmtUSD(balance) + '</div>';
            html += '<div class="sub">QuickBooks</div>';
            html += '</div>';
        }
    }
    totalUSD += qboTotal;

    // Update total display
    var displayMode = localStorage.getItem('assetsDisplayMode') || 'USD';
    var totalDisplay = document.getElementById('assetsTotalDisplay');
    var toggleBtn = document.getElementById('assetsToggleBtn');

    if (displayMode === 'BTC') {
        totalDisplay.textContent = fmtBTC(totalBTC, 8);
        totalDisplay.className = 'value btc-orange';
        toggleBtn.textContent = 'BTC';
    } else {
        totalDisplay.textContent = fmtUSD(totalUSD);
        totalDisplay.className = 'value positive';
        toggleBtn.textContent = 'USD';
    }

    document.getElementById('assetsGrid').innerHTML = html;
    document.querySelector('[data-widget="assets-overview"]').style.display = '';
}

function toggleAssetsDisplay() {
    var currentMode = localStorage.getItem('assetsDisplayMode') || 'USD';
    var newMode = currentMode === 'USD' ? 'BTC' : 'USD';
    localStorage.setItem('assetsDisplayMode', newMode);
    renderAssetsOverview();
}

function renderPnLSummary(pnl) {
    document.getElementById('pnlRevenue').textContent = fmtUSD(pnl.revenueUsd);
    document.getElementById('pnlRevenueBtc').textContent = fmtBTC(pnl.revenueBtc, 6) + ' BTC';
    document.getElementById('pnlExpenses').textContent = '-' + fmtUSD(pnl.expenses);
    document.getElementById('pnlExpensesSrc').textContent = pnl.expenseSource;
    document.getElementById('pnlCapex').textContent = '-' + fmtUSD(pnl.capex);
    document.getElementById('pnlCapexCount').textContent = pnl.capexCount + ' units purchased';

    var netEl = document.getElementById('pnlNet');
    netEl.textContent = fmtUSD(pnl.net);
    netEl.className = 'value ' + (pnl.net >= 0 ? 'positive' : 'negative');

    document.getElementById('pnlUnpaid').textContent = fmtBTC(pnl.unpaidBtc, 6) + ' BTC';
}

function renderBankAccounts() {
    var section = document.getElementById('bankAccountsSection');
    var grid = document.getElementById('bankAccountsGrid');
    if (!qboConnected || qboData.accounts.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';
    var html = '';
    for (var i = 0; i < qboData.accounts.length; i++) {
        var a = qboData.accounts[i];
        var colorClass = a.type === 'Credit Card' ? 'negative' : 'positive';
        html += '<div class="metric-card">' +
            '<div class="label">' + escapeHtml(a.name) + '</div>' +
            '<div class="value ' + colorClass + '">' + fmtUSD(a.balance) + '</div>' +
            '<div class="sub">' + escapeHtml(a.type + (a.subType ? ' — ' + a.subType : '')) + '</div>' +
        '</div>';
    }
    grid.innerHTML = html;
}

function renderRevenueTable(entries) {
    var tbody = document.getElementById('revenueTableBody');
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#555;">No revenue in this period</td></tr>';
        return;
    }
    var mult = getCurrencyMultiplier();
    var html = '';
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];

        // Determine source badge color
        var sourceLower = e.source.toLowerCase();
        var sourceBadgeStyle = '';
        if (sourceLower.indexOf('strike') !== -1) {
            sourceBadgeStyle = 'background:rgba(139,92,246,0.12); border:1px solid rgba(139,92,246,0.3); color:#a78bfa;';
        } else {
            sourceBadgeStyle = 'background:rgba(247,147,26,0.12); border:1px solid rgba(247,147,26,0.3); color:#f7931a;';
        }

        // Determine category badge color
        var categoryLower = e.category.toLowerCase();
        var categoryBadgeStyle = '';
        if (categoryLower.indexOf('mining') !== -1 || categoryLower.indexOf('payout') !== -1) {
            categoryBadgeStyle = 'background:rgba(74,222,128,0.12); border:1px solid rgba(74,222,128,0.3); color:#4ade80;';
        } else if (categoryLower.indexOf('payment') !== -1 || categoryLower.indexOf('receive') !== -1) {
            categoryBadgeStyle = 'background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.3); color:#60a5fa;';
        } else {
            categoryBadgeStyle = 'background:rgba(156,163,175,0.12); border:1px solid rgba(156,163,175,0.3); color:#9ca3af;';
        }

        html += '<tr>' +
            '<td>' + e.date + '</td>' +
            '<td><span style="font-size:11px; padding:3px 8px; border-radius:4px; display:inline-block; ' + sourceBadgeStyle + '">' + escapeHtml(e.source) + '</span></td>' +
            '<td class="btc-orange">' + fmtBTC(e.btcAmount, 8) + '</td>' +
            '<td>' + fmtUSD(e.btcPrice * mult) + '</td>' +
            '<td class="positive">' + fmtUSD(e.usdValue * mult) + '</td>' +
            '<td><span style="font-size:11px; padding:3px 8px; border-radius:4px; display:inline-block; ' + categoryBadgeStyle + '">' + escapeHtml(e.category) + '</span></td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
}

function renderExpenseTable(entries) {
    var tbody = document.getElementById('expenseTableBody');
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#555;">No expenses in this period</td></tr>';
        return;
    }
    var html = '';
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        html += '<tr>' +
            '<td>' + e.date + '</td>' +
            '<td>' + escapeHtml(e.vendor) + '</td>' +
            '<td>' + escapeHtml(e.category) + '</td>' +
            '<td class="negative">-' + fmtUSD(e.amount) + '</td>' +
            '<td>' + escapeHtml(e.account) + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
}

function renderInvoiceTable() {
    var section = document.getElementById('invoicesSection');
    var tbody = document.getElementById('invoiceTableBody');
    if (!qboConnected || qboData.invoices.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';
    var html = '';
    for (var i = 0; i < qboData.invoices.length; i++) {
        var inv = qboData.invoices[i];
        var statusClass = 'status-' + inv.status;
        var statusLabel = inv.status.charAt(0).toUpperCase() + inv.status.slice(1);
        html += '<tr>' +
            '<td>' + inv.date + '</td>' +
            '<td>' + escapeHtml(inv.customer) + '</td>' +
            '<td>' + fmtUSD(inv.amount) + '</td>' +
            '<td>' + (inv.dueDate || '--') + '</td>' +
            '<td><span class="status-badge ' + statusClass + '">' + statusLabel + '</span></td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
}

// ===== P&L BAR CHART =====
function updatePnLChart(pnl) {
    var emptyMsg = document.getElementById('pnlChartEmpty');
    var allEntries = pnl.revenueEntries.concat(pnl.expenseEntries);
    if (allEntries.length === 0) {
        emptyMsg.style.display = 'flex';
        if (pnlChart) { pnlChart.destroy(); pnlChart = null; }
        return;
    }
    emptyMsg.style.display = 'none';

    // Group by month
    var months = {};
    for (var i = 0; i < pnl.revenueEntries.length; i++) {
        var key = pnl.revenueEntries[i].date.substring(0, 7);
        if (!months[key]) months[key] = { revenue: 0, expenses: 0 };
        months[key].revenue += pnl.revenueEntries[i].usdValue;
    }
    for (var j = 0; j < pnl.expenseEntries.length; j++) {
        var eKey = pnl.expenseEntries[j].date.substring(0, 7);
        if (!months[eKey]) months[eKey] = { revenue: 0, expenses: 0 };
        months[eKey].expenses += pnl.expenseEntries[j].amount;
    }
    // Add CAPEX to expense month if present
    var fleet = FleetData.getFleet();
    for (var mi = 0; mi < fleet.miners.length; mi++) {
        var m = fleet.miners[mi];
        var pDate = m.purchaseDate || m.dateAdded.split('T')[0];
        if (pDate >= acctPeriod.start && pDate <= acctPeriod.end) {
            var cKey = pDate.substring(0, 7);
            if (!months[cKey]) months[cKey] = { revenue: 0, expenses: 0 };
            months[cKey].expenses += m.cost * m.quantity;
        }
    }

    var sortedKeys = Object.keys(months).sort();
    var labels = sortedKeys.map(function(k) {
        var parts = k.split('-');
        var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return monthNames[parseInt(parts[1], 10) - 1] + ' ' + parts[0].slice(2);
    });
    var revData = sortedKeys.map(function(k) { return +months[k].revenue.toFixed(2); });
    var expData = sortedKeys.map(function(k) { return +months[k].expenses.toFixed(2); });
    var netData = sortedKeys.map(function(k) { return +(months[k].revenue - months[k].expenses).toFixed(2); });

    if (pnlChart) pnlChart.destroy();
    var ctx = document.getElementById('pnlBarChart').getContext('2d');
    pnlChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Revenue',
                    data: revData,
                    backgroundColor: 'rgba(74, 222, 128, 0.6)',
                    borderColor: '#4ade80',
                    borderWidth: 1,
                    borderRadius: 4,
                    order: 2
                },
                {
                    label: 'Expenses',
                    data: expData,
                    backgroundColor: 'rgba(239, 68, 68, 0.6)',
                    borderColor: '#ef4444',
                    borderWidth: 1,
                    borderRadius: 4,
                    order: 2
                },
                {
                    label: 'Net Income',
                    type: 'line',
                    data: netData,
                    borderColor: '#f7931a',
                    backgroundColor: 'rgba(247, 147, 26, 0.1)',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#f7931a',
                    fill: true,
                    tension: 0.3,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    backgroundColor: 'rgba(10, 10, 10, 0.92)',
                    borderColor: 'rgba(255, 255, 255, 0.10)',
                    borderWidth: 1,
                    titleColor: '#e8e8e8',
                    bodyColor: '#e8e8e8',
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(ctx) { return ctx.dataset.label + ': $' + ctx.parsed.y.toLocaleString(); }
                    }
                },
                legend: { labels: { color: '#bbb', font: { size: 12 } } }
            },
            scales: {
                x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                y: {
                    ticks: {
                        color: '#888',
                        callback: function(v) { return '$' + v.toLocaleString(); }
                    },
                    grid: { color: 'rgba(255,255,255,0.06)' }
                }
            }
        }
    });
}

// ===== EXPENSE DOUGHNUT CHART =====
function updateExpenseDoughnut(pnl) {
    var emptyMsg = document.getElementById('expenseChartEmpty');
    var hasExpenses = pnl.expenseEntries.length > 0 || pnl.capex > 0;
    if (!hasExpenses) {
        emptyMsg.style.display = 'flex';
        if (expenseDoughnutChart) { expenseDoughnutChart.destroy(); expenseDoughnutChart = null; }
        return;
    }
    emptyMsg.style.display = 'none';

    // Group by category
    var cats = {};
    for (var i = 0; i < pnl.expenseEntries.length; i++) {
        var cat = pnl.expenseEntries[i].category || 'Other';
        // Normalize electricity categories
        if (cat.indexOf('Electricity') === 0) cat = 'Electricity';
        if (!cats[cat]) cats[cat] = 0;
        cats[cat] += pnl.expenseEntries[i].amount;
    }
    // Add equipment CAPEX as its own slice
    if (pnl.capex > 0) {
        var mult = getCurrencyMultiplier();
        cats['Equipment'] = (cats['Equipment'] || 0) + (pnl.capex / mult); // pnl.capex already multiplied
    }

    var catLabels = Object.keys(cats);
    var catValues = catLabels.map(function(k) { return +cats[k].toFixed(2); });
    var totalExp = catValues.reduce(function(a, b) { return a + b; }, 0);

    var palette = ['#ef4444', '#f7931a', '#60a5fa', '#a78bfa', '#4ade80', '#fbbf24', '#f472b6', '#38bdf8'];
    var colors = catLabels.map(function(_, i) { return palette[i % palette.length]; });

    if (expenseDoughnutChart) expenseDoughnutChart.destroy();
    var ctx = document.getElementById('expenseDoughnut').getContext('2d');
    expenseDoughnutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: catLabels,
            datasets: [{
                data: catValues,
                backgroundColor: colors,
                borderColor: 'rgba(0,0,0,0.3)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                tooltip: {
                    backgroundColor: 'rgba(10, 10, 10, 0.92)',
                    borderColor: 'rgba(255, 255, 255, 0.10)',
                    borderWidth: 1,
                    titleColor: '#e8e8e8',
                    bodyColor: '#e8e8e8',
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(ctx) {
                            var pct = ((ctx.parsed / totalExp) * 100).toFixed(1);
                            return ctx.label + ': $' + ctx.parsed.toLocaleString() + ' (' + pct + '%)';
                        }
                    }
                },
                legend: { position: 'bottom', labels: { color: '#bbb', font: { size: 12 }, padding: 12 } }
            }
        },
        plugins: [{
            id: 'centerText',
            afterDraw: function(chart) {
                var ctx2 = chart.ctx;
                var w = chart.width;
                var h = chart.height;
                ctx2.save();
                ctx2.font = 'bold 16px sans-serif';
                ctx2.fillStyle = '#e8e8e8';
                ctx2.textAlign = 'center';
                ctx2.textBaseline = 'middle';
                ctx2.fillText('$' + totalExp.toLocaleString(undefined, { maximumFractionDigits: 0 }), w / 2, h / 2 - 8);
                ctx2.font = '11px sans-serif';
                ctx2.fillStyle = '#888';
                ctx2.fillText('Total Expenses', w / 2, h / 2 + 12);
                ctx2.restore();
            }
        }]
    });
}

// ===== TAX EXPORT (moved from payouts.js) =====
document.getElementById('btnTaxExport').addEventListener('click', function() {
    var today = new Date().toISOString().split('T')[0];
    var yearStart = new Date().getFullYear() + '-01-01';
    document.getElementById('taxStartDate').value = yearStart;
    document.getElementById('taxEndDate').value = today;
    document.getElementById('taxYearPreset').value = '';
    document.getElementById('taxExportPanel').classList.toggle('open');
});

document.getElementById('cancelTaxExport').addEventListener('click', function() {
    document.getElementById('taxExportPanel').classList.remove('open');
});

document.getElementById('taxYearPreset').addEventListener('change', function() {
    var year = this.value;
    if (!year) return;
    document.getElementById('taxStartDate').value = year + '-01-01';
    document.getElementById('taxEndDate').value = year + '-12-31';
});

document.getElementById('downloadTaxCSV').addEventListener('click', function() {
    var startDate = document.getElementById('taxStartDate').value;
    var endDate = document.getElementById('taxEndDate').value;
    var reportType = document.getElementById('taxReportType').value;
    if (reportType === 'full') {
        exportFullReport(startDate, endDate);
    } else if (reportType === 'tax') {
        exportTaxReport(startDate, endDate);
    } else {
        exportCSV(startDate, endDate);
    }
    document.getElementById('taxExportPanel').classList.remove('open');
});

// ===== CSV EXPORT =====
function exportCSV(startDate, endDate) {
    var data = PayoutData.getData();
    var rows = [['Date', 'Type', 'BTC Amount', 'BTC Price (USD)', 'USD Value', 'TX Hash', 'Notes']];

    for (var i = 0; i < data.snapshots.length; i++) {
        var s = data.snapshots[i];
        if (s.date >= startDate && s.date <= endDate) {
            rows.push([s.date, 'earning', s.btcEarned.toFixed(8), s.btcPrice.toFixed(2), (s.btcEarned * s.btcPrice).toFixed(2), '', 'Daily snapshot']);
        }
    }

    for (var p = 0; p < data.payouts.length; p++) {
        var pay = data.payouts[p];
        if (pay.date >= startDate && pay.date <= endDate) {
            rows.push([pay.date, 'payout', pay.btcAmount.toFixed(8), pay.btcPrice.toFixed(2), pay.usdValue.toFixed(2), pay.txHash || '', pay.notes || '']);
        }
    }

    var header = rows[0];
    var body = rows.slice(1).sort(function(a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    rows = [header].concat(body);
    downloadCSVFile(rows, 'ion-mining-payouts-' + startDate + '-to-' + endDate + '.csv');
}

// ===== TAX REPORT EXPORT =====
function exportTaxReport(startDate, endDate) {
    var payoutData = PayoutData.getData();
    var elecData = ElectricityData.getData();
    var fleet = FleetData.getFleet();
    var rows = [['Date', 'Description', 'BTC Amount', 'BTC Price (USD)', 'USD Value', 'Cost Basis', 'Gain/Loss', 'Category']];

    var totalIncome = 0;
    var totalExpenses = 0;
    var totalCapex = 0;

    // Mining Income
    var payouts = [];
    for (var i = 0; i < payoutData.payouts.length; i++) {
        var p = payoutData.payouts[i];
        if (p.date >= startDate && p.date <= endDate) payouts.push(p);
    }
    for (var s = 0; s < payoutData.snapshots.length; s++) {
        var snap = payoutData.snapshots[s];
        if (snap.date >= startDate && snap.date <= endDate) {
            payouts.push({ date: snap.date, btcAmount: snap.btcEarned, btcPrice: snap.btcPrice, usdValue: snap.btcEarned * snap.btcPrice, notes: 'Daily mining snapshot' });
        }
    }
    payouts.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    for (var pi = 0; pi < payouts.length; pi++) {
        var pay = payouts[pi];
        var usd = pay.usdValue || (pay.btcAmount * pay.btcPrice);
        totalIncome += usd;
        rows.push([pay.date, 'Mining income' + (pay.notes ? ' - ' + pay.notes : ''), pay.btcAmount.toFixed(8), pay.btcPrice.toFixed(2), usd.toFixed(2), usd.toFixed(2), '0.00', 'Mining Income']);
    }

    // Electricity Expenses
    for (var e = 0; e < elecData.length; e++) {
        var bill = elecData[e];
        if (bill.date >= startDate && bill.date <= endDate) {
            totalExpenses += bill.costUSD;
            rows.push([bill.date, 'Electricity' + (bill.notes ? ' - ' + bill.notes : '') + ' (' + bill.kwhUsed + ' kWh)', '', '', '-' + bill.costUSD.toFixed(2), '', '', 'Electricity Expense']);
        }
    }

    // Equipment CAPEX
    for (var mi = 0; mi < fleet.miners.length; mi++) {
        var m = fleet.miners[mi];
        var pDate = m.purchaseDate || m.dateAdded.split('T')[0];
        if (pDate >= startDate && pDate <= endDate) {
            var minerCost = m.cost * m.quantity;
            totalCapex += minerCost;
            rows.push([pDate, 'Equipment: ' + m.model + ' x' + m.quantity, '', '', '-' + minerCost.toFixed(2), minerCost.toFixed(2), '', 'Equipment Purchase']);
        }
    }

    // Summary
    var netTaxable = totalIncome - totalExpenses - totalCapex;
    rows.push([]);
    rows.push(['', 'SUMMARY', '', '', '', '', '', '']);
    rows.push(['', 'Total Mining Income', '', '', totalIncome.toFixed(2), '', '', '']);
    rows.push(['', 'Total Electricity Expenses', '', '', '-' + totalExpenses.toFixed(2), '', '', '']);
    rows.push(['', 'Total Equipment Purchases', '', '', '-' + totalCapex.toFixed(2), '', '', '']);
    rows.push(['', 'Net Taxable Income', '', '', netTaxable.toFixed(2), '', '', '']);

    downloadCSVFile(rows, 'ion-mining-tax-report-' + startDate + '-to-' + endDate + '.csv');
}

// ===== FULL REPORT (with QBO expenses) =====
function exportFullReport(startDate, endDate) {
    var payoutData = PayoutData.getData();
    var elecData = ElectricityData.getData();
    var fleet = FleetData.getFleet();
    var rows = [['Date', 'Description', 'BTC Amount', 'BTC Price (USD)', 'USD Value', 'Cost Basis', 'Gain/Loss', 'Category']];

    var totalIncome = 0;
    var totalElecExpenses = 0;
    var totalQboExpenses = 0;
    var totalCapex = 0;

    // Mining Income
    var payouts = [];
    for (var i = 0; i < payoutData.payouts.length; i++) {
        var p = payoutData.payouts[i];
        if (p.date >= startDate && p.date <= endDate) payouts.push(p);
    }
    for (var s = 0; s < payoutData.snapshots.length; s++) {
        var snap = payoutData.snapshots[s];
        if (snap.date >= startDate && snap.date <= endDate) {
            payouts.push({ date: snap.date, btcAmount: snap.btcEarned, btcPrice: snap.btcPrice, usdValue: snap.btcEarned * snap.btcPrice, notes: 'Daily mining snapshot' });
        }
    }
    payouts.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    for (var pi = 0; pi < payouts.length; pi++) {
        var pay = payouts[pi];
        var usd = pay.usdValue || (pay.btcAmount * pay.btcPrice);
        totalIncome += usd;
        rows.push([pay.date, 'Mining income' + (pay.notes ? ' - ' + pay.notes : ''), pay.btcAmount.toFixed(8), pay.btcPrice.toFixed(2), usd.toFixed(2), usd.toFixed(2), '0.00', 'Mining Income']);
    }

    // Local Electricity Expenses
    for (var e = 0; e < elecData.length; e++) {
        var bill = elecData[e];
        if (bill.date >= startDate && bill.date <= endDate) {
            totalElecExpenses += bill.costUSD;
            rows.push([bill.date, 'Electricity' + (bill.notes ? ' - ' + bill.notes : '') + ' (' + bill.kwhUsed + ' kWh)', '', '', '-' + bill.costUSD.toFixed(2), '', '', 'Electricity Expense']);
        }
    }

    // QBO Expenses
    if (qboConnected && qboData.expenses.length > 0) {
        for (var q = 0; q < qboData.expenses.length; q++) {
            var qExp = qboData.expenses[q];
            if (qExp.date >= startDate && qExp.date <= endDate) {
                totalQboExpenses += qExp.amount;
                rows.push([qExp.date, (qExp.vendor || 'Expense') + ' - ' + (qExp.category || ''), '', '', '-' + qExp.amount.toFixed(2), '', '', 'QBO Expense']);
            }
        }
    }

    // Equipment CAPEX
    for (var mi = 0; mi < fleet.miners.length; mi++) {
        var m = fleet.miners[mi];
        var pDate = m.purchaseDate || m.dateAdded.split('T')[0];
        if (pDate >= startDate && pDate <= endDate) {
            var minerCost = m.cost * m.quantity;
            totalCapex += minerCost;
            rows.push([pDate, 'Equipment: ' + m.model + ' x' + m.quantity, '', '', '-' + minerCost.toFixed(2), minerCost.toFixed(2), '', 'Equipment Purchase']);
        }
    }

    // Summary
    var totalAllExpenses = totalElecExpenses + totalQboExpenses;
    var netTaxable = totalIncome - totalAllExpenses - totalCapex;
    rows.push([]);
    rows.push(['', 'SUMMARY', '', '', '', '', '', '']);
    rows.push(['', 'Total Mining Income', '', '', totalIncome.toFixed(2), '', '', '']);
    rows.push(['', 'Total Electricity Expenses', '', '', '-' + totalElecExpenses.toFixed(2), '', '', '']);
    rows.push(['', 'Total QuickBooks Expenses', '', '', '-' + totalQboExpenses.toFixed(2), '', '', '']);
    rows.push(['', 'Total Equipment Purchases', '', '', '-' + totalCapex.toFixed(2), '', '', '']);
    rows.push(['', 'Net Taxable Income', '', '', netTaxable.toFixed(2), '', '', '']);

    downloadCSVFile(rows, 'ion-mining-full-report-' + startDate + '-to-' + endDate + '.csv');
}

// ===== CSV DOWNLOAD HELPER =====
function downloadCSVFile(rows, filename) {
    var csv = '';
    for (var r = 0; r < rows.length; r++) {
        var line = '';
        var row = rows[r];
        var cols = row.length || 8;
        for (var c = 0; c < cols; c++) {
            if (c > 0) line += ',';
            line += '"' + String(row[c] !== undefined ? row[c] : '').replace(/"/g, '""') + '"';
        }
        csv += line + '\n';
    }

    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


// Accounting auto-refresh (5 minutes)
setInterval(async function() {
    if (bankingActiveTab !== 'accounting') return;
    if (qboConnected) await loadAccountingData();
    if (acctStrikeConnected) await fetchStrikeAccountingData();
    if (qboConnected || acctStrikeConnected) renderAccounting();
}, 300000);

// ===== SECTION 6: UNIFIED INIT =====
initNav('banking');

(async function() {
    var data = await fetchLiveMarketData();
    liveBtcPrice = data.price || 96000;
    acctBtcPrice = liveBtcPrice;

    window.onCurrencyChange = function() {
        liveBtcPrice = window.liveBtcPrice || liveBtcPrice;
        acctBtcPrice = liveBtcPrice;
        renderWallet();
        renderPayoutPage();
        if (bankingActiveTab === 'accounting') renderAccounting();
    };

    // Wallet init
    loadStrikeSettings();
    if (strikeConnected && typeof IonAuth !== 'undefined') {
        IonAuth.onAuthChange(function(fbUser) {
            _walletAuthResolved = true;
            if (fbUser) {
                autoLoginWithFirebase();
            } else {
                if (StrikeAuth.isLoggedIn()) {
                    clearAllWalletState();
                } else {
                    showSignInPrompt();
                }
            }
        });
    } else if (strikeConnected) {
        showSignInPrompt();
    }
    await loadAndRefreshWallet();
    startAutoRefresh();

    // Wire up global connection buttons in nav bar
    var btnConnectQbGlobal = document.getElementById('btnConnectQbGlobal');
    if (btnConnectQbGlobal) {
        btnConnectQbGlobal.addEventListener('click', function() {
            document.getElementById('qboConnectPanel').classList.add('open');
        });
    }

    var btnConnectStrikeGlobal = document.getElementById('btnConnectStrikeGlobal');
    if (btnConnectStrikeGlobal) {
        btnConnectStrikeGlobal.addEventListener('click', function() {
            var settings = FleetData.getSettings();
            if (settings.strike && settings.strike.proxyUrl) {
                document.getElementById('walletStrikeProxyUrl').value = settings.strike.proxyUrl;
            }
            document.getElementById('walletStrikeTestResult').innerHTML = '';
            document.getElementById('strikeConnectPanel').classList.add('open');
        });
    }

    var btnDisconnectQbGlobal = document.getElementById('btnDisconnectQbGlobal');
    if (btnDisconnectQbGlobal) {
        btnDisconnectQbGlobal.addEventListener('click', disconnectQuickBooks);
    }

    var btnDisconnectStrikeGlobal = document.getElementById('btnDisconnectStrikeGlobal');
    if (btnDisconnectStrikeGlobal) {
        btnDisconnectStrikeGlobal.addEventListener('click', disconnectStrike);
    }

    // Re-init widget drag handles for Wallet tab after DOM is ready
    if (typeof window.initBankingTabWidgets === 'function') {
        setTimeout(function() {
            window.initBankingTabWidgets();
        }, 150);
    }

    // Income (payouts) init
    checkAndLogDailySnapshot();
    await syncAllPoolPayouts();
    renderPayoutPage();
    // Charts are lazy-inited on first tab switch

    // Accounting init
    setPeriod('month');
    loadQboSettings();
    loadStrikeAcctSettings();
    await loadAccountingData();
    await fetchStrikeAccountingData();
    // renderAccounting() is lazy-inited on first tab switch

    // Re-check hash after data is loaded
    var hash = location.hash.replace('#', '');
    if (hash === 'income' || hash === 'accounting') {
        switchBankingTab(hash);
    }
})();
