// ===== ION MINING GROUP — Payouts & Tax Export =====

// ===== STATE =====
var liveBtcPrice = null;
var payoutChart = null;

// ===== INIT =====
initNav('payouts');

(async function() {
    var data = await fetchLiveMarketData();
    liveBtcPrice = data.price || 96000;
    checkAndLogDailySnapshot();
    await syncF2PoolPayouts();
    renderPayoutPage();
    initPayoutChart();
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

// ===== AUTO-LOG DAILY SNAPSHOT =====
function checkAndLogDailySnapshot() {
    try {
        var settings = FleetData.getSettings();
        if (!settings.f2pool || !settings.f2pool.enabled) return;
        if (!window.f2poolEarnings) return;

        var today = new Date().toISOString().split('T')[0];
        var data = PayoutData.getData();
        if (data.lastSnapshotDate === today) return;

        var e = window.f2poolEarnings;
        PayoutData.addSnapshot({
            date: today,
            btcEarned: e.yesterdayIncome || 0,
            btcPrice: liveBtcPrice,
            balance: e.balance || 0,
            totalIncome: e.totalIncome || 0
        });
    } catch(e) {}
}

// ===== F2POOL PAYOUT SYNC =====
async function syncF2PoolPayouts() {
    var statusEl = document.getElementById('f2poolSyncStatus');
    try {
        var settings = FleetData.getSettings();
        if (!settings.f2pool || !settings.f2pool.enabled) return;

        var url = settings.f2pool.workerUrl;
        var user = settings.f2pool.username;
        if (!url || !user) return;

        if (statusEl) statusEl.textContent = 'Syncing payouts from F2Pool...';

        var res = await fetch(url + '/payouts?user=' + encodeURIComponent(user));
        if (!res.ok) throw new Error('HTTP ' + res.status);
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
                notes: 'F2Pool auto-sync'
            });
            added++;
        }

        if (added > 0) {
            renderPayoutPage();
            updatePayoutChart();
        }

        if (statusEl) {
            statusEl.textContent = added > 0 ? 'Synced ' + added + ' new payout' + (added > 1 ? 's' : '') + ' from F2Pool' : 'F2Pool payouts up to date';
            setTimeout(function() { statusEl.textContent = ''; }, 5000);
        }
    } catch(e) {
        if (statusEl) {
            statusEl.textContent = 'F2Pool sync failed';
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
        var txDisplay = p.txHash ? p.txHash.substring(0, 12) + '...' : '--';
        html += '<tr>' +
            '<td>' + p.date + '</td>' +
            '<td style="color:#f7931a">' + fmtBTC(p.btcAmount, 8) + '</td>' +
            '<td>' + fmtUSD(p.btcPrice) + '</td>' +
            '<td>' + fmtUSD(p.usdValue) + '</td>' +
            '<td style="font-family:monospace; font-size:11px;" title="' + (p.txHash || '') + '">' + txDisplay + '</td>' +
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
var exportPanel = document.getElementById('exportPanel');

document.getElementById('btnAddPayout').addEventListener('click', function() {
    document.getElementById('fpDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('fpBtcAmount').value = '';
    document.getElementById('fpBtcPrice').value = '';
    document.getElementById('fpTxHash').value = '';
    document.getElementById('fpNotes').value = '';
    exportPanel.classList.remove('open');
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

document.getElementById('btnExportCSV').addEventListener('click', function() {
    var today = new Date().toISOString().split('T')[0];
    var yearStart = new Date().getFullYear() + '-01-01';
    document.getElementById('exStartDate').value = yearStart;
    document.getElementById('exEndDate').value = today;
    document.getElementById('exYearPreset').value = '';
    addPayoutPanel.classList.remove('open');
    exportPanel.classList.toggle('open');
});

document.getElementById('cancelExport').addEventListener('click', function() {
    exportPanel.classList.remove('open');
});

document.getElementById('exYearPreset').addEventListener('change', function() {
    var year = this.value;
    if (!year) return;
    document.getElementById('exStartDate').value = year + '-01-01';
    document.getElementById('exEndDate').value = year + '-12-31';
});

document.getElementById('downloadCSV').addEventListener('click', function() {
    var startDate = document.getElementById('exStartDate').value;
    var endDate = document.getElementById('exEndDate').value;
    exportCSV(startDate, endDate);
    exportPanel.classList.remove('open');
});

// ===== CSV EXPORT =====
function exportCSV(startDate, endDate) {
    var data = PayoutData.getData();
    var rows = [['Date', 'Type', 'BTC Amount', 'BTC Price (USD)', 'USD Value', 'TX Hash', 'Notes']];

    // Snapshots (daily earnings)
    for (var i = 0; i < data.snapshots.length; i++) {
        var s = data.snapshots[i];
        if (s.date >= startDate && s.date <= endDate) {
            rows.push([
                s.date, 'earning',
                s.btcEarned.toFixed(8),
                s.btcPrice.toFixed(2),
                (s.btcEarned * s.btcPrice).toFixed(2),
                '', 'Daily snapshot'
            ]);
        }
    }

    // Payouts
    for (var p = 0; p < data.payouts.length; p++) {
        var pay = data.payouts[p];
        if (pay.date >= startDate && pay.date <= endDate) {
            rows.push([
                pay.date, 'payout',
                pay.btcAmount.toFixed(8),
                pay.btcPrice.toFixed(2),
                pay.usdValue.toFixed(2),
                pay.txHash || '', pay.notes || ''
            ]);
        }
    }

    // Sort by date (skip header)
    var header = rows[0];
    var body = rows.slice(1).sort(function(a, b) {
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    rows = [header].concat(body);

    var csv = '';
    for (var r = 0; r < rows.length; r++) {
        var line = '';
        for (var c = 0; c < rows[r].length; c++) {
            if (c > 0) line += ',';
            line += '"' + String(rows[r][c]).replace(/"/g, '""') + '"';
        }
        csv += line + '\n';
    }

    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ion-mining-payouts-' + startDate + '-to-' + endDate + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

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

// ===== PWA SERVICE WORKER =====
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=44').catch(function() {});
}
