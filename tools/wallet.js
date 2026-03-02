// ===== ION MINING GROUP — Watch-Only Wallet =====

var liveBtcPrice = null;
var refreshInterval = null;
var strikeConnected = false;
var strikeBalances = null;
var strikeTransactions = [];

initNav('wallet');

(async function() {
    var data = await fetchLiveMarketData();
    liveBtcPrice = data.price || 96000;
    window.onCurrencyChange = function() { liveBtcPrice = window.liveBtcPrice || liveBtcPrice; renderWallet(); };
    loadStrikeSettings();
    await loadAndRefreshWallet();
    startAutoRefresh();
})();

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

    async function apiFetch(route) {
        var proxy = getProxyUrl();
        if (!proxy) return { error: 'No proxy URL configured' };
        try {
            var res = await fetch(proxy.replace(/\/$/, '') + route);
            if (res.status === 403) return { error: 'Access denied' };
            if (!res.ok) return { error: 'HTTP ' + res.status };
            return await res.json();
        } catch(e) {
            return { error: e.message || 'Network error' };
        }
    }

    async function getBalances() {
        return await apiFetch('/balances');
    }

    async function getDeposits() {
        return await apiFetch('/deposits');
    }

    async function getPayouts() {
        return await apiFetch('/payouts');
    }

    async function getReceives() {
        return await apiFetch('/receives');
    }

    async function getInvoices() {
        return await apiFetch('/invoices');
    }

    async function testConnection() {
        var proxy = getProxyUrl();
        if (!proxy) return { error: 'No proxy URL configured' };
        try {
            var res = await fetch(proxy.replace(/\/$/, '') + '/ping');
            if (!res.ok) return { error: 'HTTP ' + res.status };
            var data = await res.json();
            if (data.ok) return data.balances || data;
            return { error: data.error || 'Unknown error' };
        } catch(e) {
            return { error: e.message || 'Network error' };
        }
    }

    async function apiPostWithPin(route, body, pin) {
        var proxy = getProxyUrl();
        if (!proxy) return { error: 'No proxy URL configured' };
        try {
            var res = await fetch(proxy.replace(/\/$/, '') + route, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Dashboard-Pin': pin },
                body: JSON.stringify(body)
            });
            var data = await res.json();
            if (!res.ok) return { error: data.error || data.message || 'HTTP ' + res.status };
            return data;
        } catch(e) {
            return { error: e.message || 'Network error' };
        }
    }

    async function apiPatchWithPin(route, body, pin, totpCode) {
        var proxy = getProxyUrl();
        if (!proxy) return { error: 'No proxy URL configured' };
        try {
            var hdrs = { 'Content-Type': 'application/json', 'X-Dashboard-Pin': pin };
            if (totpCode) hdrs['X-Dashboard-TOTP'] = totpCode;
            var res = await fetch(proxy.replace(/\/$/, '') + route, {
                method: 'PATCH',
                headers: hdrs,
                body: JSON.stringify(body || {})
            });
            var data = await res.json();
            if (!res.ok) return { error: data.error || data.message || 'HTTP ' + res.status, totpRequired: data.totpRequired };
            return data;
        } catch(e) {
            return { error: e.message || 'Network error' };
        }
    }

    async function apiGetWithPin(route, pin) {
        var proxy = getProxyUrl();
        if (!proxy) return { error: 'No proxy URL configured' };
        try {
            var res = await fetch(proxy.replace(/\/$/, '') + route, {
                headers: { 'X-Dashboard-Pin': pin }
            });
            var data = await res.json();
            if (!res.ok) return { error: data.error || data.message || 'HTTP ' + res.status };
            return data;
        } catch(e) {
            return { error: e.message || 'Network error' };
        }
    }

    async function sendQuoteLightning(body, pin) {
        return await apiPostWithPin('/send/quote/lightning', body, pin);
    }

    async function sendQuoteOnchain(body, pin) {
        return await apiPostWithPin('/send/quote/onchain', body, pin);
    }

    async function getOnchainTiers(body, pin) {
        return await apiPostWithPin('/send/onchain-tiers', body, pin);
    }

    async function executeSend(quoteId, pin, totpCode) {
        return await apiPatchWithPin('/send/execute/' + quoteId, {}, pin, totpCode);
    }

    async function getSendStatus(paymentId, pin) {
        return await apiGetWithPin('/send/status/' + paymentId, pin);
    }

    return {
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
        getSendStatus: getSendStatus
    };
})();

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

    // Fetch balances
    var balResult = await StrikeAPI.getBalances();
    if (balResult && !balResult.error) {
        strikeBalances = balResult;
        // Save last sync time
        var settings = FleetData.getSettings();
        if (!settings.strike) settings.strike = {};
        settings.strike.lastSync = new Date().toISOString();
        FleetData.saveSettings(settings);
    } else {
        console.warn('[Wallet] Strike balance fetch error:', balResult.error);
    }

    // Fetch transactions (deposits + payouts + receives)
    var strikeTxs = [];
    try {
        var [deposits, payouts, receives] = await Promise.all([
            StrikeAPI.getDeposits(),
            StrikeAPI.getPayouts(),
            StrikeAPI.getReceives()
        ]);

        // Process deposits (incoming)
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

        // Process payouts (outgoing)
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

        // Process receives (incoming Lightning/on-chain)
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
    // Strike returns {amount: "0.001", currency: "BTC"} or similar
    if (typeof amountObj === 'object') {
        var val = parseFloat(amountObj.amount) || 0;
        var cur = (amountObj.currency || '').toUpperCase();
        if (cur === 'BTC') return val;
        // If USD, convert to BTC
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

    // Fetch Strike data if connected
    if (strikeConnected) {
        await fetchStrikeData();
    }

    if (data.addresses.length === 0 && !strikeConnected) {
        renderWallet();
        renderEmptyTxTable();
        return;
    }

    // Fetch on-chain address data
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

    // Add Strike BTC balance
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

    // Strike balance card (shown first if connected)
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
            '</div>' +
            '<div class="miner-card-actions">' +
                '<button onclick="fetchStrikeData().then(function(){renderWallet();})">Sync</button>' +
                '<button class="delete" onclick="disconnectStrike()">Disconnect</button>' +
            '</div>' +
        '</div>';
    }

    // On-chain address cards
    if (data.addresses.length === 0 && !html) {
        container.innerHTML = '<div class="empty-state" style="padding:20px;"><p>No addresses added yet</p><div class="hint">Click "+ Add Address" or connect Strike to start monitoring</div></div>';
        return;
    }

    for (var i = 0; i < data.addresses.length; i++) {
        var a = data.addresses[i];
        var shortAddr = a.address.substring(0, 8) + '...' + a.address.substring(a.address.length - 6);
        html += '<div class="miner-card">' +
            '<div class="miner-card-header">' +
                '<div class="miner-card-model">' + escapeHtml(a.label) + '</div>' +
                '<span class="status-badge" style="font-size:10px; padding:2px 8px; background:rgba(247,147,26,0.15); color:#f7931a;">On-chain</span>' +
            '</div>' +
            '<div class="miner-card-stats">' +
                '<div class="miner-card-stat"><div class="stat-label">Address</div><div class="stat-value" style="font-family:monospace; font-size:11px;">' + shortAddr + '</div></div>' +
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
        '<tr><td colspan="5" style="text-align:center; padding:20px; color:#555;">No addresses added yet</td></tr>';
}

async function renderTransactionHistory() {
    var data = WalletData.getData();
    var tbody = document.getElementById('txHistoryBody');

    if (data.addresses.length === 0 && strikeTransactions.length === 0) {
        renderEmptyTxTable();
        return;
    }

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#555;">Loading transactions...</td></tr>';

    var allTxs = [];

    // On-chain transactions
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

            allTxs.push({
                source: 'On-chain',
                sourceLabel: addr.label,
                txid: tx.txid,
                timestamp: (tx.status && tx.status.block_time) || Math.floor(Date.now() / 1000),
                confirmed: tx.status && tx.status.confirmed,
                change: change,
                type: 'on-chain'
            });
        }
    }

    // Strike transactions
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

        // Source badge
        var sourceBadge;
        if (t.type === 'strike') {
            sourceBadge = '<span class="strike-source-badge">' + escapeHtml(t.sourceLabel) + '</span>';
        } else {
            sourceBadge = '<span class="onchain-source-badge">' + escapeHtml(t.sourceLabel) + '</span>';
        }

        // Type/TX column
        var typeCol;
        if (t.type === 'strike') {
            typeCol = '<span style="font-size:11px; color:#888;">' + (t.strikeType || 'Transfer') + '</span>';
        } else {
            var txShort = t.txid.substring(0, 10) + '...';
            typeCol = '<a href="https://mempool.space/tx/' + t.txid + '" target="_blank" rel="noopener" style="color:#f7931a; text-decoration:none; font-family:monospace; font-size:11px;" title="' + t.txid + '">' + txShort + '</a>';
        }

        // Status
        var statusText, statusColor;
        if (t.type === 'strike') {
            var st2 = (t.strikeStatus || '').toUpperCase();
            statusText = st2 === 'COMPLETED' ? 'Completed' : st2 === 'PENDING' ? 'Pending' : t.strikeStatus || 'Unknown';
            statusColor = st2 === 'COMPLETED' ? '#4ade80' : '#f7931a';
        } else {
            statusText = t.confirmed ? 'Confirmed' : 'Unconfirmed';
            statusColor = t.confirmed ? '#4ade80' : '#f7931a';
        }

        html += '<tr>' +
            '<td>' + dateStr + '</td>' +
            '<td>' + sourceBadge + '</td>' +
            '<td style="color:' + changeColor + '; font-weight:500;">' + changePrefix + fmtBTC(Math.abs(t.change), 8) + '</td>' +
            '<td>' + typeCol + '</td>' +
            '<td style="color:' + statusColor + ';">' + statusText + '</td>' +
        '</tr>';
    }

    if (!html) {
        html = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#555;">No transactions found</td></tr>';
    }
    tbody.innerHTML = html;
}

// ===== HELPERS =====
function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
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

    // Check for duplicates
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

    // Temporarily set URL to test
    var settings = FleetData.getSettings();
    if (!settings.strike) settings.strike = {};
    var oldUrl = settings.strike.proxyUrl;
    settings.strike.proxyUrl = url;
    FleetData.saveSettings(settings);

    var data = await StrikeAPI.testConnection();

    // Restore old URL if test only
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
        // Disconnect
        disconnectStrike();
        document.getElementById('strikeConnectPanel').classList.remove('open');
        return;
    }

    // Save and connect
    settings.strike = { proxyUrl: url, enabled: true, lastSync: null };
    FleetData.saveSettings(settings);
    strikeConnected = true;
    updateStrikeStatus('Connected');
    updateSendButton();
    update2FAButton();
    document.getElementById('strikeConnectPanel').classList.remove('open');
    await loadAndRefreshWallet();
});

function disconnectStrike() {
    var settings = FleetData.getSettings();
    settings.strike = { proxyUrl: '', enabled: false, lastSync: null };
    FleetData.saveSettings(settings);
    strikeConnected = false;
    strikeBalances = null;
    strikeTransactions = [];
    updateStrikeStatus(null);
    updateSendButton();
    update2FAButton();
    renderWallet();
    renderTransactionHistory();
}
// Make available globally for inline onclick
window.disconnectStrike = disconnectStrike;

// ===== SEND BTC PANEL =====
var activeSendQuote = null;
var quoteExpiryInterval = null;
var totpEnabled = false; // Detected when worker returns totpRequired flag

// Show send button only when Strike is connected
function updateSendButton() {
    var btn = document.getElementById('btnSendBtc');
    if (btn) btn.style.display = strikeConnected ? '' : 'none';
}

// Show/hide TOTP input based on whether 2FA is enabled
function updateTotpVisibility() {
    var grp = document.getElementById('totpGroup');
    if (grp) grp.style.display = totpEnabled ? '' : 'none';
}

document.getElementById('btnSendBtc').addEventListener('click', function() {
    document.getElementById('sendStep1').style.display = '';
    document.getElementById('sendStep2').style.display = 'none';
    document.getElementById('sendResult').innerHTML = '';
    document.getElementById('sendPin').value = '';
    document.getElementById('sendPinConfirm').value = '';
    document.getElementById('sendTotpCode').value = '';
    document.getElementById('sendDest').value = '';
    document.getElementById('sendAmount').value = '';
    activeSendQuote = null;
    updateSendTypeUI();
    updateTotpVisibility();
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

async function loadOnchainTiers() {
    var pin = document.getElementById('sendPin').value;
    var tierSelect = document.getElementById('sendTier');
    tierSelect.innerHTML = '<option value="">Loading tiers...</option>';

    var addr = document.getElementById('sendDest').value.trim();
    var amt = document.getElementById('sendAmount').value.trim();
    var cur = document.getElementById('sendCurrency').value;
    if (!addr || !amt || !pin) {
        tierSelect.innerHTML = '<option value="">Enter address, amount & PIN first</option>';
        return;
    }

    var body = { btcAddress: addr, amount: { amount: amt, currency: cur } };
    var data = await StrikeAPI.getOnchainTiers(body, pin);
    if (data && !data.error && Array.isArray(data)) {
        tierSelect.innerHTML = '';
        for (var i = 0; i < data.length; i++) {
            var t = data[i];
            var fee = t.estimatedFee ? t.estimatedFee.amount + ' ' + t.estimatedFee.currency : 'free';
            var mins = t.estimatedDeliveryDurationInMin || '?';
            var opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.id.replace('tier_', '') + ' (~' + mins + ' min, fee: ' + fee + ')';
            tierSelect.appendChild(opt);
        }
    } else {
        tierSelect.innerHTML = '<option value="">' + (data.error || 'Could not load tiers') + '</option>';
    }
}

// Get Quote
document.getElementById('btnGetQuote').addEventListener('click', async function() {
    var type = document.getElementById('sendType').value;
    var dest = document.getElementById('sendDest').value.trim();
    var amt = document.getElementById('sendAmount').value.trim();
    var cur = document.getElementById('sendCurrency').value;
    var pin = document.getElementById('sendPin').value;
    var result = document.getElementById('sendResult');

    if (!dest) { result.innerHTML = '<span style="color:#f55;">Enter a destination</span>'; return; }
    if (!amt) { result.innerHTML = '<span style="color:#f55;">Enter an amount</span>'; return; }
    if (!pin) { result.innerHTML = '<span style="color:#f55;">Enter your PIN</span>'; return; }

    result.innerHTML = '<span style="color:#888;">Getting quote...</span>';

    var quoteData;
    if (type === 'lightning') {
        quoteData = await StrikeAPI.sendQuoteLightning({
            lnInvoice: dest,
            sourceCurrency: cur,
            amount: { amount: amt, currency: cur }
        }, pin);
    } else {
        var tier = document.getElementById('sendTier').value;
        var body = {
            btcAddress: dest,
            sourceCurrency: cur,
            amount: { amount: amt, currency: cur, feePolicy: 'EXCLUSIVE' }
        };
        if (tier) body.onchainTierId = tier;
        quoteData = await StrikeAPI.sendQuoteOnchain(body, pin);
    }

    if (quoteData && !quoteData.error && quoteData.paymentQuoteId) {
        activeSendQuote = quoteData;
        showQuoteConfirmation(quoteData, type, dest);
        result.innerHTML = '';
    } else {
        result.innerHTML = '<span style="color:#f55;">' + (quoteData.error || 'Quote failed') + '</span>';
    }
});

function showQuoteConfirmation(quote, type, dest) {
    document.getElementById('sendStep1').style.display = 'none';
    document.getElementById('sendStep2').style.display = '';
    document.getElementById('sendPinConfirm').value = '';

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

    // Expiry countdown
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
    var pin = document.getElementById('sendPinConfirm').value;
    var totpCode = (document.getElementById('sendTotpCode').value || '').replace(/\s/g, '');
    var result = document.getElementById('sendResult');
    if (!pin) { result.innerHTML = '<span style="color:#f55;">Enter your PIN to confirm</span>'; return; }
    if (totpEnabled && (!totpCode || totpCode.length !== 6)) {
        result.innerHTML = '<span style="color:#f55;">Enter the 6-digit code from Google Authenticator</span>'; return;
    }
    if (!activeSendQuote || !activeSendQuote.paymentQuoteId) { result.innerHTML = '<span style="color:#f55;">No active quote</span>'; return; }

    // Check if quote expired
    if (activeSendQuote.validUntil && new Date(activeSendQuote.validUntil).getTime() < Date.now()) {
        result.innerHTML = '<span style="color:#f55;">Quote expired. Go back and get a new one.</span>';
        return;
    }

    result.innerHTML = '<span style="color:#f7931a;">Sending...</span>';
    document.getElementById('btnConfirmSend').disabled = true;

    var sendResult = await StrikeAPI.executeSend(activeSendQuote.paymentQuoteId, pin, totpCode || undefined);

    document.getElementById('btnConfirmSend').disabled = false;
    document.getElementById('sendPinConfirm').value = '';
    document.getElementById('sendTotpCode').value = '';
    clearQuoteExpiry();

    if (sendResult && !sendResult.error) {
        var state = sendResult.state || 'COMPLETED';
        result.innerHTML = '<span style="color:#4ade80;">Payment ' + state + '!</span>';
        activeSendQuote = null;
        // Refresh balances after send
        setTimeout(function() {
            document.getElementById('sendBtcPanel').classList.remove('open');
            loadAndRefreshWallet();
        }, 2000);
    } else {
        // If worker says TOTP is required, auto-show the TOTP field
        if (sendResult.totpRequired) {
            totpEnabled = true;
            updateTotpVisibility();
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
    if (btn) btn.style.display = strikeConnected ? '' : 'none';
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
    var secret = generateBase32Secret(20);
    var issuer = 'Ion%20Mining';
    var account = 'dashboard';
    var otpauthUri = 'otpauth://totp/' + issuer + ':' + account + '?secret=' + secret + '&issuer=' + issuer + '&digits=6&period=30';

    // Show result panel FIRST (canvas can't render in display:none)
    document.getElementById('twofa-secret-display').textContent = secret;
    document.getElementById('twofa-setup-content').style.display = 'none';
    document.getElementById('twofa-setup-result').style.display = '';

    // Generate QR code client-side AFTER container is visible
    var qrEl = document.getElementById('twofa-qr');
    qrEl.innerHTML = '';
    new QRCode(qrEl, { text: otpauthUri, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff' });
});
