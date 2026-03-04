// ===== ION MINING GROUP — Accounting Page =====

// ===== STATE =====
var acctBtcPrice = null;
var qboData = { accounts: [], expenses: [], invoices: [] };
var qboConnected = false;
var acctStrikeConnected = false;
var strikeAcctData = { deposits: [], payouts: [], receives: [] };
var acctPeriod = { start: '', end: '' };
var pnlChart = null;
var expenseDoughnutChart = null;

// ===== INIT =====
initNav('accounting');

(async function() {
    var data = await fetchLiveMarketData();
    acctBtcPrice = data.price || 96000;
    window.onCurrencyChange = function() {
        acctBtcPrice = window.liveBtcPrice || acctBtcPrice;
        renderAccounting();
    };
    setPeriod('month');
    loadQboSettings();
    loadStrikeAcctSettings();
    await loadAccountingData();
    await fetchStrikeAccountingData();
    renderAccounting();
})();

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
    if (!StrikeAuth.isLoggedIn()) {
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

    if (companyName) {
        if (badge) {
            badge.textContent = 'QuickBooks: ' + companyName;
            badge.className = 'status-badge status-connected';
        }
        if (notConnected) notConnected.style.display = 'none';
        if (connected) connected.style.display = '';
        if (companyNameEl) companyNameEl.textContent = companyName;
    } else {
        if (badge) {
            badge.textContent = 'QuickBooks: Not Connected';
            badge.className = 'status-badge status-disconnected';
        }
        if (notConnected) notConnected.style.display = '';
        if (connected) connected.style.display = 'none';
    }
}

document.getElementById('btnConnectQbo').addEventListener('click', function() {
    document.getElementById('qboConnectPanel').classList.toggle('open');
});

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
        updateStrikeAcctStatus('Connected');
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

async function strikeApiFetch(route) {
    var settings = FleetData.getSettings();
    var proxy = (settings.strike && settings.strike.proxyUrl) || '';
    if (!proxy) return { error: 'No proxy URL configured' };
    try {
        var res = await fetch(proxy.replace(/\/$/, '') + route);
        if (!res.ok) return { error: 'HTTP ' + res.status };
        return await res.json();
    } catch(e) {
        return { error: e.message || 'Network error' };
    }
}

async function fetchStrikeAccountingData() {
    if (!acctStrikeConnected) return;
    try {
        var [deposits, payouts, receives] = await Promise.all([
            strikeApiFetch('/deposits'),
            strikeApiFetch('/payouts'),
            strikeApiFetch('/receives')
        ]);
        strikeAcctData.deposits = (deposits && !deposits.error) ? (deposits.items || deposits) : [];
        strikeAcctData.payouts = (payouts && !payouts.error) ? (payouts.items || payouts) : [];
        strikeAcctData.receives = (receives && !receives.error) ? (receives.items || receives) : [];
        if (!Array.isArray(strikeAcctData.deposits)) strikeAcctData.deposits = [];
        if (!Array.isArray(strikeAcctData.payouts)) strikeAcctData.payouts = [];
        if (!Array.isArray(strikeAcctData.receives)) strikeAcctData.receives = [];
    } catch(e) {
        console.warn('[Accounting] Strike fetch error:', e);
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

// Strike panel handlers
document.getElementById('btnConnectStrikeAcct').addEventListener('click', function() {
    var settings = FleetData.getSettings();
    if (settings.strike && settings.strike.proxyUrl) {
        document.getElementById('strikeProxyUrlAcct').value = settings.strike.proxyUrl;
    }
    document.getElementById('strikeTestResultAcct').innerHTML = '';
    document.getElementById('strikeConnectPanel').classList.toggle('open');
});

document.getElementById('cancelStrikeAcct').addEventListener('click', function() {
    document.getElementById('strikeConnectPanel').classList.remove('open');
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
        document.getElementById('strikeConnectPanel').classList.remove('open');
        renderAccounting();
        return;
    }
    settings.strike = { proxyUrl: url, enabled: true, lastSync: new Date().toISOString() };
    FleetData.saveSettings(settings);
    acctStrikeConnected = true;
    updateStrikeAcctStatus('Connected');
    document.getElementById('strikeConnectPanel').classList.remove('open');
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
        html += '<tr>' +
            '<td>' + e.date + '</td>' +
            '<td>' + escapeHtml(e.source) + '</td>' +
            '<td>' + fmtBTC(e.btcAmount, 8) + '</td>' +
            '<td>' + fmtUSD(e.btcPrice * mult) + '</td>' +
            '<td class="positive">' + fmtUSD(e.usdValue * mult) + '</td>' +
            '<td>' + escapeHtml(e.category) + '</td>' +
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

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ===== AUTO-REFRESH =====
setInterval(async function() {
    if (qboConnected) await loadAccountingData();
    if (acctStrikeConnected) await fetchStrikeAccountingData();
    if (qboConnected || acctStrikeConnected) renderAccounting();
}, 300000); // 5 minutes
