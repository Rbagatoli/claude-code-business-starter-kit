// ===== ION MINING GROUP — Watch-Only Wallet =====

var liveBtcPrice = null;
var refreshInterval = null;

initNav('wallet');

(async function() {
    var data = await fetchLiveMarketData();
    liveBtcPrice = data.price || 96000;
    window.onCurrencyChange = function() { liveBtcPrice = window.liveBtcPrice || liveBtcPrice; renderWallet(); };
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

    if (data.addresses.length === 0) {
        renderWallet();
        renderEmptyTxTable();
        return;
    }

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

    document.getElementById('walletTotalBTC').textContent = fmtBTC(totalBTC, 8);
    document.getElementById('walletTotalUSD').textContent = fmtUSD(totalBTC * liveBtcPrice);
    document.getElementById('walletPriceLabel').textContent = 'at ' + fmtUSD(liveBtcPrice);
    document.getElementById('walletAddressCount').textContent = data.addresses.length;
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

    if (data.addresses.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:20px;"><p>No addresses added yet</p><div class="hint">Click "+ Add Address" to start monitoring</div></div>';
        return;
    }

    var html = '';
    for (var i = 0; i < data.addresses.length; i++) {
        var a = data.addresses[i];
        var shortAddr = a.address.substring(0, 8) + '...' + a.address.substring(a.address.length - 6);
        html += '<div class="miner-card">' +
            '<div class="miner-card-header">' +
                '<div class="miner-card-model">' + escapeHtml(a.label) + '</div>' +
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

    var btns = container.querySelectorAll('.delete');
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

    if (data.addresses.length === 0) {
        renderEmptyTxTable();
        return;
    }

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#555;">Loading transactions...</td></tr>';

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

            allTxs.push({
                label: addr.label,
                txid: tx.txid,
                timestamp: (tx.status && tx.status.block_time) || Math.floor(Date.now() / 1000),
                confirmed: tx.status && tx.status.confirmed,
                change: change
            });
        }
    }

    allTxs.sort(function(a, b) { return b.timestamp - a.timestamp; });

    var html = '';
    var limit = Math.min(25, allTxs.length);
    for (var k = 0; k < limit; k++) {
        var t = allTxs[k];
        var date = new Date(t.timestamp * 1000);
        var dateStr = (date.getMonth() + 1) + '/' + date.getDate() + '/' + date.getFullYear() + ' ' +
            String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
        var txShort = t.txid.substring(0, 12) + '...';
        var changeColor = t.change >= 0 ? '#4ade80' : '#ef4444';
        var changePrefix = t.change >= 0 ? '+' : '';
        var statusText = t.confirmed ? 'Confirmed' : 'Unconfirmed';
        var statusColor = t.confirmed ? '#4ade80' : '#f7931a';

        html += '<tr>' +
            '<td>' + dateStr + '</td>' +
            '<td>' + escapeHtml(t.label) + '</td>' +
            '<td style="color:' + changeColor + '; font-weight:500;">' + changePrefix + fmtBTC(Math.abs(t.change), 8) + '</td>' +
            '<td><a href="https://mempool.space/tx/' + t.txid + '" target="_blank" rel="noopener" style="color:#f7931a; text-decoration:none; font-family:monospace; font-size:11px;" title="' + t.txid + '">' + txShort + '</a></td>' +
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

// ===== PANEL HANDLERS =====
var addAddressPanel = document.getElementById('addAddressPanel');

document.getElementById('btnAddAddress').addEventListener('click', function() {
    document.getElementById('faAddress').value = '';
    document.getElementById('faLabel').value = '';
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

// ===== PWA SERVICE WORKER =====
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=58').catch(function() {});
}
