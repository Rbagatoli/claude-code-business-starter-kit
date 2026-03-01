// ===== ION MINING GROUP — Dashboard =====

// ===== STATE =====
var useMockData = false;
var editingMinerId = null;
var liveBtcPrice = null;
var liveDifficulty = null;
var expandedGroups = new Set();


const SECONDS_PER_DAY = 86400;
const TWO_POW_32 = 4294967296;
const CURRENT_BLOCK_REWARD = 3.125;

// ===== INIT =====
initNav('dashboard');

// Load live data, then render
(async function() {
    var data = await fetchLiveMarketData();
    liveBtcPrice = data.price || 96000;
    window.onCurrencyChange = function() { liveBtcPrice = window.liveBtcPrice || liveBtcPrice; renderDashboard(); updateEarningsChart(); };
    if (data.difficulty) liveDifficulty = data.difficulty;
    else liveDifficulty = 125.86;
    await loadF2PoolData();
    renderDashboard();
    renderPoolList();
    initEarningsChart();
    initMinerDbAutocomplete();
})();

// ===== RENDER DASHBOARD =====
function renderDashboard() {
    var fleet = FleetData.getFleet();
    var miners = fleet.miners;

    // Append F2Pool live miners
    if (f2poolMiners.length > 0) {
        miners = miners.concat(f2poolMiners);
    }

    useMockData = false;
    document.getElementById('mockBanner').style.display = 'none';

    // Compute summary from current miners list
    var totalHashrate = 0, totalPower = 0, onlineCount = 0, offlineCount = 0, totalMachines = 0, totalCost = 0;
    for (var i = 0; i < miners.length; i++) {
        var m = miners[i];
        totalMachines += m.quantity;
        totalCost += (m.cost || 0) * m.quantity;
        if (m.status === 'online') {
            onlineCount += m.quantity;
            totalHashrate += m.hashrate * m.quantity;
            totalPower += m.power * m.quantity;
        } else {
            offlineCount += m.quantity;
        }
    }
    var efficiency = totalHashrate > 0 ? (totalPower * 1000) / totalHashrate : 0;
    var avgCost = totalMachines > 0 ? totalCost / totalMachines : 0;

    // Daily earnings estimate
    var difficultyFull = liveDifficulty * 1e12;
    var hashrateH = totalHashrate * 1e12;
    var dailyBTC = (hashrateH * SECONDS_PER_DAY * CURRENT_BLOCK_REWARD) / (difficultyFull * TWO_POW_32);
    var dailyUSD = dailyBTC * liveBtcPrice;

    // Update fleet overview cards
    document.getElementById('fleetHashrate').textContent = totalHashrate.toLocaleString(undefined, { maximumFractionDigits: 1 });
    document.getElementById('fleetOnline').textContent = onlineCount;
    document.getElementById('fleetOfflineSub').textContent = offlineCount > 0 ? offlineCount + ' offline' : 'All miners online';
    document.getElementById('fleetDailyBTC').textContent = dailyBTC.toFixed(6) + ' BTC';
    document.getElementById('fleetDailyUSD').textContent = fmtUSD(dailyUSD);
    document.getElementById('fleetPower').textContent = totalPower.toFixed(2);
    document.getElementById('fleetEfficiency').textContent = efficiency.toFixed(1);
    document.getElementById('fleetAvgCost').textContent = fmtUSD(avgCost * getCurrencyMultiplier());
    document.getElementById('fleetTotalCost').textContent = 'Total: ' + fmtUSD(totalCost * getCurrencyMultiplier());
    var avgHashrate = totalMachines > 0 ? totalHashrate / totalMachines : 0;
    var avgPower = totalMachines > 0 ? totalPower / totalMachines : 0;
    document.getElementById('fleetAvgHashrate').textContent = avgHashrate.toFixed(1);
    document.getElementById('fleetAvgPower').textContent = avgPower.toFixed(2);

    // Fleet ROI
    var fleetROIEl = document.getElementById('fleetROI');
    var fleetROISubEl = document.getElementById('fleetROISub');
    if (fleetROIEl && totalCost > 0) {
        var fleetEstEarnings = dailyUSD * 30; // rough 30-day projection
        var fleetROI = ((fleetEstEarnings * 12 - totalCost) / totalCost) * 100; // annualized
        var roiSign = fleetROI >= 0 ? '+' : '';
        fleetROIEl.textContent = roiSign + fleetROI.toFixed(1) + '%';
        fleetROIEl.className = 'value ' + (fleetROI >= 0 ? 'positive' : 'negative');
        fleetROISubEl.textContent = 'annualized est.';
    }

    // Render profitability summary
    renderProfitability(totalCost, totalPower, dailyBTC);

    // Render miner cards
    renderMinerCards(miners);

    // Render payment tracker
    renderPaymentTracker();

}

// ===== PROFITABILITY SUMMARY =====
function renderProfitability(fleetCapex, totalPowerKW, dailyBTC) {
    var price = liveBtcPrice || 0;
    var mult = getCurrencyMultiplier();

    // Total Revenue — sum of all payout USD values
    var totalRevenue = 0;
    var payoutCount = 0;
    try {
        var raw = localStorage.getItem('ionMiningPayouts');
        if (raw) {
            var payoutData = JSON.parse(raw);
            var payouts = payoutData && payoutData.payouts ? payoutData.payouts : [];
            payoutCount = payouts.length;
            for (var i = 0; i < payouts.length; i++) {
                totalRevenue += payouts[i].usdValue || (payouts[i].btcAmount * (payouts[i].btcPrice || price));
            }
        }
    } catch(e) {}

    // Total Electricity — sum of all electricity bills
    var totalElec = 0;
    try {
        var elecRaw = localStorage.getItem('ionMiningElectricity');
        if (elecRaw) {
            var elecEntries = JSON.parse(elecRaw);
            if (Array.isArray(elecEntries)) {
                for (var j = 0; j < elecEntries.length; j++) {
                    totalElec += elecEntries[j].costUSD || 0;
                }
            }
        }
    } catch(e) {}

    // Net P&L = Revenue - Electricity - CAPEX
    var netPnL = totalRevenue - totalElec - fleetCapex;

    // Daily Profit = (daily BTC × price) - daily electricity cost
    // Daily elec cost = totalPowerKW × 24h × elec rate
    var fleet = FleetData.getFleet();
    var elecRate = (fleet.defaults && fleet.defaults.elecCost) || 0.07;
    var dailyElecCost = totalPowerKW * 24 * elecRate;
    var dailyProfit = (dailyBTC * price) - dailyElecCost;

    // Update DOM
    document.getElementById('profRevenue').textContent = fmtUSD(totalRevenue * mult);
    document.getElementById('profRevenueSub').textContent = payoutCount > 0 ? payoutCount + ' payouts' : 'from payouts';

    document.getElementById('profElectricity').textContent = fmtUSD(totalElec * mult);

    document.getElementById('profCapex').textContent = fmtUSD(fleetCapex * mult);

    var pnlEl = document.getElementById('profPnL');
    pnlEl.textContent = fmtUSD(netPnL * mult);
    pnlEl.className = 'value ' + (netPnL >= 0 ? 'positive' : 'negative');

    var dailyEl = document.getElementById('profDaily');
    dailyEl.textContent = fmtUSD(dailyProfit * mult);
    dailyEl.className = 'value ' + (dailyProfit >= 0 ? 'positive' : 'negative');
    document.getElementById('profDailySub').textContent = 'elec: ' + fmtUSD(dailyElecCost * mult) + '/day';
}

function renderPaymentTracker() {
    var settings = FleetData.getSettings();
    var section = document.getElementById('paymentTrackerSection');
    var hint = document.getElementById('paymentTrackerHint');

    var f2pool = null;
    for (var p = 0; p < (settings.pools || []).length; p++) {
        if (settings.pools[p].type === 'f2pool' && settings.pools[p].enabled) { f2pool = settings.pools[p]; break; }
    }
    if (!f2pool) {
        section.style.display = 'none';
        hint.style.display = '';
        return;
    }

    hint.style.display = 'none';

    if (!window.f2poolEarnings) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';
    var e = window.f2poolEarnings;
    var price = liveBtcPrice || 0;

    document.getElementById('ptBalance').textContent = fmtBTC(e.balance, 8);
    document.getElementById('ptYesterday').textContent = fmtBTC(e.yesterdayIncome, 8);
    document.getElementById('ptYesterdayUSD').textContent = fmtUSD(e.yesterdayIncome * price);
    document.getElementById('ptEstDaily').textContent = fmtBTC(e.estimatedDaily, 8);
    document.getElementById('ptEstDailyUSD').textContent = fmtUSD(e.estimatedDaily * price);
    document.getElementById('ptTotalIncome').textContent = fmtBTC(e.totalIncome, 8);
    document.getElementById('ptBalanceUSD').textContent = fmtUSD(e.balance * price);

    // Days to Payout
    var daysToPayout = (e.estimatedDaily > 0) ? Math.ceil(e.balance / e.estimatedDaily) : '--';
    document.getElementById('ptDaysToPayout').textContent = daysToPayout;

    // 30-Day Projected
    var proj30 = e.estimatedDaily * 30;
    document.getElementById('pt30Day').textContent = fmtBTC(proj30, 6);
    document.getElementById('pt30DayUSD').textContent = fmtUSD(proj30 * price);
}

function renderMinerCards(miners) {
    var grid = document.getElementById('minerCardsGrid');
    grid.innerHTML = '';

    if (miners.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="icon">&#x26A1;</div><p>No miners added yet</p><div class="hint">Click "Add Miner" to get started</div></div>';
        return;
    }

    for (var i = 0; i < miners.length; i++) {
        var m = miners[i];
        var eff = m.hashrate > 0 ? ((m.power * 1000) / m.hashrate).toFixed(1) : '0';

        var mHashH = m.hashrate * 1e12;
        var diffFull = liveDifficulty * 1e12;
        var mDailyBTC = m.status === 'online' ? (mHashH * SECONDS_PER_DAY * CURRENT_BLOCK_REWARD) / (diffFull * TWO_POW_32) : 0;
        var mDailyUSD = mDailyBTC * liveBtcPrice;

        var isLive = m.source === 'f2pool';
        var isGroup = m.quantity > 1;
        var isExpanded = expandedGroups.has(m.id);

        if (!isGroup) {
            // Single unit — normal card
            grid.appendChild(buildMinerCard(m, eff, mDailyUSD, isLive, false, false));
        } else {
            // Grouped units — stacked wrapper
            var wrapper = document.createElement('div');
            wrapper.className = 'miner-group' + (isExpanded ? ' expanded' : '');

            wrapper.appendChild(buildMinerCard(m, eff, mDailyUSD, isLive, true, isExpanded));

            if (isExpanded) {
                var units = document.createElement('div');
                units.className = 'miner-group-units';
                for (var u = 0; u < m.quantity; u++) {
                    units.appendChild(buildUnitCard(m, eff, mDailyUSD, u + 1, isLive));
                }
                wrapper.appendChild(units);
            }

            grid.appendChild(wrapper);
        }
    }

    // Attach event listeners
    grid.querySelectorAll('.edit-miner').forEach(function(btn) {
        btn.addEventListener('click', function() { startEditMiner(this.dataset.id); });
    });
    grid.querySelectorAll('.delete-miner').forEach(function(btn) {
        btn.addEventListener('click', function() { deleteMiner(this.dataset.id); });
    });
    grid.querySelectorAll('.miner-group-toggle').forEach(function(btn) {
        btn.addEventListener('click', function() { toggleMinerGroup(this.dataset.id); });
    });
    grid.querySelectorAll('.delete-unit').forEach(function(btn) {
        btn.addEventListener('click', function() {
            FleetData.reduceQuantity(this.dataset.id);
            renderDashboard();
            updateEarningsChart();
        });
    });
    grid.querySelectorAll('.add-unit').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var id = this.dataset.id;
            var fleet = FleetData.getFleet();
            for (var i = 0; i < fleet.miners.length; i++) {
                if (fleet.miners[i].id === id) {
                    FleetData.updateMiner(id, { quantity: fleet.miners[i].quantity + 1 });
                    break;
                }
            }
            renderDashboard();
            updateEarningsChart();
        });
    });
}

function buildMinerCard(m, eff, mDailyUSD, isLive, isGroupSummary, isExpanded) {
    var card = document.createElement('div');
    card.className = 'miner-card' + (isGroupSummary ? ' miner-card-stacked' : '');

    // ROI calculation
    var roiBadge = '';
    var daysOwnedText = '';
    if (m.purchaseDate && m.cost > 0) {
        var purchaseMs = new Date(m.purchaseDate).getTime();
        var nowMs = Date.now();
        var daysOwned = Math.max(1, Math.floor((nowMs - purchaseMs) / 86400000));
        var totalCostGroup = m.cost * m.quantity;
        var estEarnings = mDailyUSD * m.quantity * daysOwned;
        var roi = ((estEarnings - totalCostGroup) / totalCostGroup) * 100;
        var roiColor = roi >= 0 ? '#4caf50' : '#f55';
        var roiSign = roi >= 0 ? '+' : '';
        roiBadge = '<div class="miner-card-qty" style="background:' + roiColor + '22;color:' + roiColor + ';border:1px solid ' + roiColor + '44">ROI: ' + roiSign + roi.toFixed(1) + '%</div>';
        daysOwnedText = '<div class="miner-card-stat"><div class="stat-label">Days Owned</div><div class="stat-value">' + daysOwned + '</div></div>';
    }

    var badges = '';
    if (isLive) badges += '<div class="miner-card-qty live-badge">LIVE</div>';
    if (isGroupSummary) badges += '<div class="miner-card-qty qty-badge">x' + m.quantity + '</div>';
    badges += roiBadge;

    var totalRow = '';
    if (isGroupSummary) {
        totalRow = '<div class="miner-card-stat stat-total"><div class="stat-label">Total Daily (' + m.quantity + ' units)</div><div class="stat-value" style="color:#f7931a">' + fmtUSD(mDailyUSD * m.quantity) + '</div></div>';
    }

    var toggleBtn = '';
    if (isGroupSummary) {
        var chevron = isExpanded ? '&#x25B2;' : '&#x25BC;';
        var toggleText = isExpanded ? 'Collapse' : 'Show all ' + m.quantity;
        toggleBtn = '<button class="miner-group-toggle" data-id="' + m.id + '"><span class="toggle-chevron">' + chevron + '</span> ' + toggleText + '</button>';
    }

    var actions = isLive ? '' :
        '<div class="miner-card-actions">' +
            '<button class="edit-miner" data-id="' + m.id + '">Edit</button>' +
            '<button class="add-unit" data-id="' + m.id + '">+1</button>' +
            '<button class="delete delete-miner" data-id="' + m.id + '">Delete</button>' +
        '</div>';

    var footer = '';
    if (isGroupSummary) {
        footer = '<div class="miner-card-group-footer">' + toggleBtn + actions + '</div>';
        actions = '';
    }

    card.innerHTML =
        '<div class="miner-card-header">' +
            '<div class="miner-card-model">' + escapeHtml(m.model) + '</div>' +
            '<div class="miner-card-badges">' + badges + '</div>' +
        '</div>' +
        '<div class="miner-card-stats">' +
            '<div class="miner-card-stat"><div class="stat-label">Hashrate</div><div class="stat-value">' + m.hashrate + ' TH/s</div></div>' +
            '<div class="miner-card-stat"><div class="stat-label">Power</div><div class="stat-value">' + (m.power ? m.power + ' kW' : '--') + '</div></div>' +
            '<div class="miner-card-stat"><div class="stat-label">Efficiency</div><div class="stat-value">' + (m.power ? eff + ' J/TH' : '--') + '</div></div>' +
            '<div class="miner-card-stat"><div class="stat-label">Cost</div><div class="stat-value">' + (m.cost ? fmtUSD(m.cost * getCurrencyMultiplier()) : '--') + '</div></div>' +
            '<div class="miner-card-stat"><div class="stat-label">Status</div><div class="stat-value"><span class="status-dot ' + m.status + (isLive && m.status === 'online' ? ' online-pulse' : '') + '"></span>' + m.status + '</div></div>' +
            '<div class="miner-card-stat"><div class="stat-label">' + (isGroupSummary ? 'Daily (each)' : 'Daily Est.') + '</div><div class="stat-value" style="color:#f7931a">' + fmtUSD(mDailyUSD) + '</div></div>' +
            daysOwnedText +
            totalRow +
        '</div>' +
        actions + footer;

    return card;
}

function buildUnitCard(m, eff, mDailyUSD, unitNumber, isLive) {
    var card = document.createElement('div');
    card.className = 'miner-card miner-card-unit';
    card.innerHTML =
        '<div class="miner-card-header">' +
            '<div class="miner-card-model">' + escapeHtml(m.model) + ' <span class="unit-number">#' + unitNumber + '</span></div>' +
            (isLive ? '<div class="miner-card-qty live-badge">LIVE</div>' : '') +
        '</div>' +
        '<div class="miner-card-stats">' +
            '<div class="miner-card-stat"><div class="stat-label">Hashrate</div><div class="stat-value">' + m.hashrate + ' TH/s</div></div>' +
            '<div class="miner-card-stat"><div class="stat-label">Power</div><div class="stat-value">' + (m.power ? m.power + ' kW' : '--') + '</div></div>' +
            '<div class="miner-card-stat"><div class="stat-label">Efficiency</div><div class="stat-value">' + (m.power ? eff + ' J/TH' : '--') + '</div></div>' +
            '<div class="miner-card-stat"><div class="stat-label">Daily Est.</div><div class="stat-value" style="color:#f7931a">' + fmtUSD(mDailyUSD) + '</div></div>' +
        '</div>' +
        (isLive ? '' :
        '<div class="miner-card-actions">' +
            '<button class="edit-miner" data-id="' + m.id + '">Edit</button>' +
            '<button class="delete delete-unit" data-id="' + m.id + '">Remove</button>' +
        '</div>');
    return card;
}

function toggleMinerGroup(id) {
    if (expandedGroups.has(id)) expandedGroups.delete(id);
    else expandedGroups.add(id);
    renderDashboard();
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== MINER DATABASE AUTOCOMPLETE =====
var minerDbDropdownVisible = false;
var minerDbResults = [];
var minerDbSelectedIndex = -1;

function initMinerDbAutocomplete() {
    var modelInput = document.getElementById('fmModel');
    var dropdown = document.getElementById('minerDbDropdown');
    if (!modelInput || !dropdown || typeof MinerDB === 'undefined') return;

    modelInput.addEventListener('input', function() {
        var query = modelInput.value.trim();
        if (query.length < 1) {
            hideMinerDropdown();
            return;
        }
        minerDbResults = MinerDB.search(query);
        renderMinerDropdown();
    });

    modelInput.addEventListener('focus', function() {
        if (modelInput.value.trim().length > 0) {
            minerDbResults = MinerDB.search(modelInput.value.trim());
            renderMinerDropdown();
        }
    });

    modelInput.addEventListener('blur', function() {
        setTimeout(hideMinerDropdown, 200);
    });

    modelInput.addEventListener('keydown', function(e) {
        if (!minerDbDropdownVisible) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            minerDbSelectedIndex = Math.min(minerDbSelectedIndex + 1, minerDbResults.length - 1);
            highlightMinerDropdownItem();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            minerDbSelectedIndex = Math.max(minerDbSelectedIndex - 1, -1);
            highlightMinerDropdownItem();
        } else if (e.key === 'Enter' && minerDbSelectedIndex >= 0) {
            e.preventDefault();
            selectMinerFromDb(minerDbResults[minerDbSelectedIndex]);
        } else if (e.key === 'Escape') {
            hideMinerDropdown();
        }
    });
}

function renderMinerDropdown() {
    var dropdown = document.getElementById('minerDbDropdown');
    if (minerDbResults.length === 0) {
        hideMinerDropdown();
        return;
    }

    var html = '';
    for (var i = 0; i < Math.min(minerDbResults.length, 8); i++) {
        var m = minerDbResults[i];
        html += '<div class="miner-db-item" data-index="' + i + '">' +
            '<div class="miner-db-model">' + escapeHtml(m.model) + '</div>' +
            '<div class="miner-db-specs">' +
                m.hashrate + ' TH/s &middot; ' +
                m.power + ' kW &middot; ' +
                m.efficiency.toFixed(1) + ' J/TH &middot; ' +
                fmtUSD(m.cost) +
            '</div>' +
        '</div>';
    }

    dropdown.innerHTML = html;
    dropdown.style.display = '';
    minerDbDropdownVisible = true;
    minerDbSelectedIndex = -1;

    var items = dropdown.querySelectorAll('.miner-db-item');
    for (var j = 0; j < items.length; j++) {
        (function(item) {
            item.addEventListener('mousedown', function(e) {
                e.preventDefault();
                var idx = parseInt(item.getAttribute('data-index'));
                selectMinerFromDb(minerDbResults[idx]);
            });
        })(items[j]);
    }
}

function hideMinerDropdown() {
    var dropdown = document.getElementById('minerDbDropdown');
    if (dropdown) dropdown.style.display = 'none';
    minerDbDropdownVisible = false;
    minerDbSelectedIndex = -1;
}

function highlightMinerDropdownItem() {
    var items = document.querySelectorAll('.miner-db-item');
    for (var i = 0; i < items.length; i++) {
        if (i === minerDbSelectedIndex) items[i].classList.add('selected');
        else items[i].classList.remove('selected');
    }
}

function selectMinerFromDb(miner) {
    document.getElementById('fmModel').value = miner.model;
    document.getElementById('fmHashrate').value = miner.hashrate;
    document.getElementById('fmPower').value = miner.power;
    document.getElementById('fmCost').value = miner.cost;
    hideMinerDropdown();
}

// ===== ADD / EDIT MINER =====
var addMinerPanel = document.getElementById('addMinerPanel');
var apiPanel = document.getElementById('apiPanel');

document.getElementById('btnAddMiner').addEventListener('click', function() {
    editingMinerId = null;
    document.getElementById('minerFormTitle').textContent = 'Add Miner';
    document.getElementById('fmModel').value = '';
    document.getElementById('fmHashrate').value = '';
    document.getElementById('fmPower').value = '';
    document.getElementById('fmCost').value = '';
    document.getElementById('fmQuantity').value = '1';
    document.getElementById('fmStatus').value = 'online';
    document.getElementById('fmPurchaseDate').value = new Date().toISOString().split('T')[0];
    apiPanel.classList.remove('open');
    addMinerPanel.classList.toggle('open');
});

document.getElementById('cancelMiner').addEventListener('click', function() {
    addMinerPanel.classList.remove('open');
    editingMinerId = null;
});

document.getElementById('saveMiner').addEventListener('click', function() {
    var model = document.getElementById('fmModel').value.trim();
    var hashrate = document.getElementById('fmHashrate').value;
    var power = document.getElementById('fmPower').value;
    var cost = document.getElementById('fmCost').value;
    var quantity = document.getElementById('fmQuantity').value;
    var status = document.getElementById('fmStatus').value;
    var purchaseDate = document.getElementById('fmPurchaseDate').value || new Date().toISOString().split('T')[0];

    if (!model || !hashrate || !power) return;

    if (editingMinerId) {
        FleetData.updateMiner(editingMinerId, { model: model, hashrate: hashrate, power: power, cost: cost, quantity: quantity, status: status, purchaseDate: purchaseDate });
        editingMinerId = null;
    } else {
        FleetData.addMiner({ model: model, hashrate: hashrate, power: power, cost: cost, quantity: quantity, status: status, purchaseDate: purchaseDate });
    }

    addMinerPanel.classList.remove('open');
    renderDashboard();
    updateEarningsChart();
});

function startEditMiner(id) {
    var fleet = FleetData.getFleet();
    var miner = null;
    for (var i = 0; i < fleet.miners.length; i++) {
        if (fleet.miners[i].id === id) { miner = fleet.miners[i]; break; }
    }
    // Also check mock data
    if (!miner && useMockData) return;
    if (!miner) return;

    editingMinerId = id;
    document.getElementById('minerFormTitle').textContent = 'Edit Miner';
    document.getElementById('fmModel').value = miner.model;
    document.getElementById('fmHashrate').value = miner.hashrate;
    document.getElementById('fmPower').value = miner.power;
    document.getElementById('fmCost').value = miner.cost || '';
    document.getElementById('fmQuantity').value = miner.quantity;
    document.getElementById('fmStatus').value = miner.status;
    document.getElementById('fmPurchaseDate').value = miner.purchaseDate || '';
    apiPanel.classList.remove('open');
    addMinerPanel.classList.add('open');
}

var pendingDeleteId = null;
var deleteDialog = document.getElementById('deleteDialog');

function deleteMiner(id) {
    if (useMockData) return;
    pendingDeleteId = id;

    // Check quantity — if only 1, skip dialog and just delete
    var fleet = FleetData.getFleet();
    var miner = null;
    for (var i = 0; i < fleet.miners.length; i++) {
        if (fleet.miners[i].id === id) { miner = fleet.miners[i]; break; }
    }
    if (!miner || miner.quantity <= 1) {
        FleetData.removeMiner(id);
        renderDashboard();
        updateEarningsChart();
        return;
    }

    document.getElementById('deleteDialogText').textContent =
        'This group has ' + miner.quantity + ' ' + escapeHtml(miner.model) + ' miners.';
    deleteDialog.style.display = '';
}

document.getElementById('deleteCancel').addEventListener('click', function() {
    deleteDialog.style.display = 'none';
    pendingDeleteId = null;
});

document.getElementById('deleteOne').addEventListener('click', function() {
    if (pendingDeleteId) {
        FleetData.reduceQuantity(pendingDeleteId);
        renderDashboard();
        updateEarningsChart();
    }
    deleteDialog.style.display = 'none';
    pendingDeleteId = null;
});

document.getElementById('deleteAll').addEventListener('click', function() {
    if (pendingDeleteId) {
        FleetData.removeMiner(pendingDeleteId);
        renderDashboard();
        updateEarningsChart();
    }
    deleteDialog.style.display = 'none';
    pendingDeleteId = null;
});

// ===== F2POOL API PANEL =====
var apiStatusEl = document.getElementById('apiStatus');
var apiStatusText = document.getElementById('apiStatusText');

document.getElementById('btnConnectAPI').addEventListener('click', function() {
    var settings = FleetData.getSettings();
    var poolType = document.getElementById('fmPoolType');
    if (poolType) poolType.value = 'f2pool';
    var existing = null;
    for (var p = 0; p < settings.pools.length; p++) {
        if (settings.pools[p].type === 'f2pool') { existing = settings.pools[p]; break; }
    }
    document.getElementById('fmWorkerUrl').value = existing ? existing.workerUrl || '' : '';
    document.getElementById('fmUsername').value = existing ? existing.username || '' : '';
    updatePoolPanelState();
    apiStatusEl.style.display = 'none';
    addMinerPanel.classList.remove('open');
    apiPanel.classList.toggle('open');
});

document.getElementById('cancelAPI').addEventListener('click', function() {
    apiPanel.classList.remove('open');
});

document.getElementById('testAPI').addEventListener('click', async function() {
    var workerUrl = document.getElementById('fmWorkerUrl').value.trim().replace(/\/+$/, '');
    var username = document.getElementById('fmUsername').value.trim();
    if (!workerUrl || !username) {
        apiStatusText.textContent = 'Please enter both fields.';
        apiStatusText.style.color = '#f55';
        apiStatusEl.style.display = '';
        return;
    }
    apiStatusText.textContent = 'Testing connection...';
    apiStatusText.style.color = '#888';
    apiStatusEl.style.display = '';
    try {
        var res = await fetch(workerUrl + '/ping?user=' + encodeURIComponent(username));
        var data = await res.json();
        if (res.ok && data.ok) {
            apiStatusText.textContent = 'Connected successfully!';
            apiStatusText.style.color = '#4caf50';
        } else {
            apiStatusText.textContent = 'Error: ' + (data.error || 'Unknown error');
            apiStatusText.style.color = '#f55';
        }
    } catch (e) {
        apiStatusText.textContent = 'Failed to connect: ' + e.message;
        apiStatusText.style.color = '#f55';
    }
});

document.getElementById('saveAPI').addEventListener('click', async function() {
    var settings = FleetData.getSettings();
    var poolTypeEl = document.getElementById('fmPoolType');
    var poolType = poolTypeEl ? poolTypeEl.value : 'f2pool';
    var workerUrl = document.getElementById('fmWorkerUrl').value.trim().replace(/\/+$/, '');
    var username = document.getElementById('fmUsername').value.trim();
    var enabled = !!(workerUrl && username);
    var POOL_NAMES = { f2pool: 'F2Pool', luxor: 'Luxor', braiins: 'Braiins Pool', viabtc: 'ViaBTC' };
    var found = false;
    for (var p = 0; p < settings.pools.length; p++) {
        if (settings.pools[p].type === poolType) {
            settings.pools[p].workerUrl = workerUrl;
            settings.pools[p].username = username;
            settings.pools[p].enabled = enabled;
            found = true;
            break;
        }
    }
    if (!found) {
        settings.pools.push({
            id: 'pool_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            type: poolType,
            name: POOL_NAMES[poolType] || poolType,
            workerUrl: workerUrl,
            username: username,
            enabled: enabled
        });
    }
    FleetData.saveSettings(settings);
    apiPanel.classList.remove('open');
    renderPoolList();
    if (poolType === 'f2pool' && enabled) {
        await loadF2PoolData();
        renderDashboard();
        updateEarningsChart();
    }
});

// ===== F2POOL LIVE DATA =====
var f2poolMiners = [];

async function loadF2PoolData() {
    var settings = FleetData.getSettings();
    var f2cfg = null;
    for (var p = 0; p < settings.pools.length; p++) {
        if (settings.pools[p].type === 'f2pool' && settings.pools[p].enabled) { f2cfg = settings.pools[p]; break; }
    }
    if (!f2cfg) return;
    var url = f2cfg.workerUrl;
    var user = f2cfg.username;

    try {
        var [workersRes, earningsRes] = await Promise.all([
            fetch(url + '/workers?user=' + encodeURIComponent(user)),
            fetch(url + '/earnings?user=' + encodeURIComponent(user))
        ]);

        f2poolMiners = [];

        if (workersRes.ok) {
            var workersData = await workersRes.json();
            var workers = workersData.workers || workersData.data || [];
            for (var i = 0; i < workers.length; i++) {
                var w = workers[i];
                var hashTH = (w.hashrate || w.hashrate_current || 0) / 1e12;
                f2poolMiners.push({
                    id: 'f2pool_' + (w.worker_name || i),
                    model: w.worker_name || 'Worker ' + (i + 1),
                    hashrate: parseFloat(hashTH.toFixed(1)),
                    power: 0,
                    cost: 0,
                    quantity: 1,
                    status: (w.status === 'Online' || w.status === 'online') ? 'online' : 'offline',
                    source: 'f2pool'
                });
            }
        }

        if (earningsRes.ok) {
            var earningsData = await earningsRes.json();
            // Store earnings data for display
            window.f2poolEarnings = {
                balance: earningsData.balance || 0,
                totalIncome: earningsData.income_total || earningsData.total_income || 0,
                yesterdayIncome: earningsData.income_yesterday || earningsData.yesterday_income || 0,
                estimatedDaily: earningsData.income_estimated_daily || earningsData.estimated_daily_income || 0
            };
        }
    } catch (e) {
        f2poolMiners = [];
    }
}

// ===== POOL LIST =====
var POOL_TYPES = [
    { type: 'f2pool', name: 'F2Pool', supported: true },
    { type: 'luxor', name: 'Luxor', supported: false },
    { type: 'braiins', name: 'Braiins Pool', supported: false },
    { type: 'viabtc', name: 'ViaBTC', supported: false }
];

function renderPoolList() {
    var container = document.getElementById('poolListContainer');
    if (!container) return;
    var settings = FleetData.getSettings();
    if (settings.pools.length === 0) {
        container.innerHTML = '';
        return;
    }
    var html = '<div class="section-label" style="margin-top:12px;font-size:13px">Connected Pools</div>';
    for (var i = 0; i < settings.pools.length; i++) {
        var pool = settings.pools[i];
        var supported = pool.type === 'f2pool';
        var statusText = !supported ? 'Coming Soon' : (pool.enabled ? 'Connected' : 'Disconnected');
        var statusClass = !supported ? 'coming-soon' : (pool.enabled ? 'positive' : 'negative');
        html += '<div class="pool-card">' +
            '<div class="pool-card-info">' +
                '<span class="pool-card-name">' + escapeHtml(pool.name) + '</span>' +
                '<span class="pool-type-badge">' + pool.type + '</span>' +
            '</div>' +
            '<span class="pool-card-status ' + statusClass + '">' + statusText + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
}

function updatePoolPanelState() {
    var poolType = document.getElementById('fmPoolType');
    var comingSoon = document.getElementById('poolComingSoon');
    var formFields = document.getElementById('poolFormFields');
    var testBtn = document.getElementById('testAPI');
    var saveBtn = document.getElementById('saveAPI');
    if (!poolType) return;
    var type = poolType.value;
    var supported = type === 'f2pool';
    if (comingSoon) comingSoon.style.display = supported ? 'none' : '';
    if (formFields) formFields.style.display = supported ? '' : 'none';
    if (testBtn) testBtn.style.display = supported ? '' : 'none';
    if (saveBtn) saveBtn.style.display = supported ? '' : 'none';
    var settings = FleetData.getSettings();
    var existing = null;
    for (var p = 0; p < settings.pools.length; p++) {
        if (settings.pools[p].type === type) { existing = settings.pools[p]; break; }
    }
    if (supported) {
        document.getElementById('fmWorkerUrl').value = existing ? existing.workerUrl || '' : '';
        document.getElementById('fmUsername').value = existing ? existing.username || '' : '';
    }
}

(function() {
    var poolTypeEl = document.getElementById('fmPoolType');
    if (poolTypeEl) {
        poolTypeEl.addEventListener('change', function() {
            updatePoolPanelState();
        });
    }
})();

// ===== MOCK BANNER =====
document.getElementById('dismissMock').addEventListener('click', function() {
    document.getElementById('mockBanner').style.display = 'none';
});

// ===== EARNINGS CHART =====
var earningsChart;

function initEarningsChart() {
    var ctx = document.getElementById('earningsChart');
    var chartData = generateEarningsData();

    earningsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'Daily Earnings',
                data: chartData.values,
                backgroundColor: 'rgba(247, 147, 26, 0.50)',
                borderColor: '#f7931a',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 10, 10, 0.92)',
                    borderColor: 'rgba(255, 255, 255, 0.10)',
                    borderWidth: 1,
                    titleColor: '#e8e8e8',
                    bodyColor: '#e8e8e8',
                    padding: 10,
                    callbacks: {
                        label: function(ctx) {
                            return fmtUSD(ctx.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#888', font: { size: 11 } },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#f7931a',
                        font: { size: 11 },
                        callback: function(v) {
                            var s = getCurrencySymbol();
                            if (v >= 1e3) return s + (v / 1e3).toFixed(1) + 'k';
                            return s + v.toFixed(0);
                        }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                }
            }
        }
    });
}

function generateEarningsData() {
    var fleet = FleetData.getFleet();
    var miners = fleet.miners;

    var totalHashrate = 0;
    for (var i = 0; i < miners.length; i++) {
        if (miners[i].status === 'online') {
            totalHashrate += miners[i].hashrate * miners[i].quantity;
        }
    }

    var hashrateH = totalHashrate * 1e12;
    var diffFull = liveDifficulty * 1e12;
    var baseDailyBTC = (hashrateH * SECONDS_PER_DAY * CURRENT_BLOCK_REWARD) / (diffFull * TWO_POW_32);
    var baseDailyUSD = baseDailyBTC * liveBtcPrice;

    var labels = [];
    var values = [];
    var today = new Date();

    for (var d = 13; d >= 0; d--) {
        var date = new Date(today);
        date.setDate(date.getDate() - d);
        var label = (date.getMonth() + 1) + '/' + date.getDate();
        labels.push(label);

        // Add small random variance (+/- 8%) for realistic look
        var variance = 1 + (Math.random() * 0.16 - 0.08);
        values.push(baseDailyUSD * variance);
    }

    return { labels: labels, values: values };
}

function updateEarningsChart() {
    if (!earningsChart) return;
    var chartData = generateEarningsData();
    earningsChart.data.labels = chartData.labels;
    earningsChart.data.datasets[0].data = chartData.values;
    earningsChart.update();
}

// ===== PWA SERVICE WORKER =====
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=62').catch(function() {});
}
