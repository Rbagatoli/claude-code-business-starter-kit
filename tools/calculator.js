// ===== ION MINING GROUP — Calculator Engine =====

// One-time migration: clear old settings so new defaults take effect
try {
    var _raw = localStorage.getItem('btcMinerCalcSettings');
    if (_raw) {
        var _s = JSON.parse(_raw);
        if (!_s._v || _s._v < 3) {
            localStorage.removeItem('btcMinerCalcSettings');
        }
    }
} catch(e) {}

// ===== CONSTANTS =====
const SECONDS_PER_DAY = 86400;
const TWO_POW_32 = 4294967296;
const CURRENT_BLOCK_REWARD = 3.125;

const PERIOD_CONFIG = {
    daily:   { days: 1,     perMonth: 30.44, label: 'days',   labelSingular: 'day' },
    weekly:  { days: 7,     perMonth: 4.348, label: 'weeks',  labelSingular: 'week' },
    monthly: { days: 30.44, perMonth: 1,     label: 'months', labelSingular: 'month' }
};

const HALVINGS = [
    { date: new Date('2028-04-17'), reward: 1.5625 },
    { date: new Date('2032-04-17'), reward: 0.78125 },
    { date: new Date('2036-04-17'), reward: 0.390625 },
    { date: new Date('2040-04-17'), reward: 0.1953125 },
    { date: new Date('2044-04-17'), reward: 0.09765625 },
    { date: new Date('2048-04-17'), reward: 0.048828125 },
    { date: new Date('2052-04-17'), reward: 0.0244140625 },
    { date: new Date('2056-04-17'), reward: 0.01220703125 },
    { date: new Date('2060-04-17'), reward: 0.006103515625 },
    { date: new Date('2064-04-17'), reward: 0.0030517578125 },
    { date: new Date('2068-04-17'), reward: 0.00152587890625 },
    { date: new Date('2072-04-17'), reward: 0.000762939453125 },
    { date: new Date('2076-04-17'), reward: 0.0003814697265625 },
    { date: new Date('2080-04-17'), reward: 0.00019073486328125 },
    { date: new Date('2084-04-17'), reward: 0.000095367431640625 },
    { date: new Date('2088-04-17'), reward: 0.0000476837158203125 },
    { date: new Date('2092-04-17'), reward: 0.00002384185791015625 },
    { date: new Date('2096-04-17'), reward: 0.000011920928955078125 },
    { date: new Date('2100-04-17'), reward: 0.0000059604644775390625 },
];

function getBlockReward(date) {
    let reward = CURRENT_BLOCK_REWARD;
    for (const h of HALVINGS) {
        if (date >= h.date) reward = h.reward;
    }
    return reward;
}

// ===== DOM REFS =====
const inputIds = [
    'btcPrice', 'priceChange', 'difficulty', 'diffChange', 'investPeriod',
    'hashrate', 'power', 'capex', 'machineCount', 'minerAdditions', 'minerLifespan', 'salvageValue', 'btcTreasury', 'elecCost', 'poolFee', 'uptime', 'hodlRatio'
];
const el = {};
inputIds.forEach(id => el[id] = document.getElementById(id));
const hodlSlider = document.getElementById('hodlSlider');
const periodLengthSel = document.getElementById('periodLength');
const reinvestToggle = document.getElementById('reinvestToggle');
const reinvestRow = document.getElementById('reinvestRow');
const additionCapexToggle = document.getElementById('additionCapexToggle');
const additionCapexRow = document.getElementById('additionCapexRow');
const savingsElecToggle = document.getElementById('savingsElecToggle');
const savingsElecRow = document.getElementById('savingsElecRow');
const autoReplaceToggle = document.getElementById('autoReplaceToggle');
const autoReplaceRow = document.getElementById('autoReplaceRow');

// ===== FLEET DATA TOGGLE =====
const useFleetToggle = document.getElementById('useFleetToggle');
const fleetToggleRow = document.getElementById('fleetToggleRow');
function applyFleetData() {
    var summary = FleetData.getFleetSummary();
    if (summary.totalMachines === 0) return;

    // Pre-fill inputs from fleet — user can still adjust freely
    var avgHashrate = summary.totalMachines > 0 ? summary.totalHashrate / summary.totalMachines : 0;
    var avgPower = summary.totalMachines > 0 ? summary.totalPower / summary.totalMachines : 0;

    // Compute average cost from fleet miners
    var fleet = FleetData.getFleet();
    var totalCost = 0;
    for (var i = 0; i < fleet.miners.length; i++) {
        totalCost += (fleet.miners[i].cost || 0) * fleet.miners[i].quantity;
    }
    var avgCost = summary.totalMachines > 0 ? totalCost / summary.totalMachines : 0;

    el.hashrate.value = avgHashrate.toFixed(1);
    el.power.value = avgPower.toFixed(2);
    el.capex.value = Math.round(avgCost);
    el.machineCount.value = summary.totalMachines;
    el.elecCost.value = summary.defaults.elecCost;
    el.poolFee.value = summary.defaults.poolFee;
    el.uptime.value = summary.defaults.uptime;

    fleetToggleRow.classList.add('active');
    recalculate();
}

function removeFleetData() {
    fleetToggleRow.classList.remove('active');
    recalculate();
}

useFleetToggle.addEventListener('change', function() {
    var settings = FleetData.getSettings();
    settings.useFleetData = useFleetToggle.checked;
    FleetData.saveSettings(settings);
    if (useFleetToggle.checked) {
        applyFleetData();
    } else {
        removeFleetData();
    }
});

// ===== LOCALSTORAGE PERSISTENCE =====
const STORAGE_KEY = 'btcMinerCalcSettings';

function saveSettings() {
    const settings = {};
    inputIds.forEach(id => { settings[id] = el[id].value; });
    settings.periodLength = periodLengthSel.value;
    settings.reinvest = reinvestToggle.checked;
    settings.additionCapex = additionCapexToggle.checked;
    settings.savingsElec = savingsElecToggle.checked;
    settings._v = 3;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch(e) {}
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        inputIds.forEach(id => { if (s[id] !== undefined) el[id].value = s[id]; });
        if (s.periodLength) periodLengthSel.value = s.periodLength;
        if (s.reinvest) {
            reinvestToggle.checked = true;
            reinvestRow.classList.add('active');
        }
        if (s.additionCapex === false) {
            additionCapexToggle.checked = false;
        } else {
            additionCapexToggle.checked = true;
            additionCapexRow.classList.add('active');
        }
        if (s.savingsElec) {
            savingsElecToggle.checked = true;
            savingsElecRow.classList.add('active');
        }
        hodlSlider.value = el.hodlRatio.value;
    } catch(e) {}
}

// ===== LIVE DATA FETCH =====
async function fetchLiveData() {
    const status = document.getElementById('liveStatus');
    var data = await fetchLiveMarketData();
    if (data.price || data.difficulty) {
        if (data.price) el.btcPrice.value = data.price;
        if (data.difficulty) el.difficulty.value = data.difficulty;
        status.textContent = 'Live data loaded';
        status.className = 'live-status live';
    } else {
        status.textContent = 'Using saved values (offline)';
        status.className = 'live-status offline';
    }
    setTimeout(() => { status.style.opacity = '0'; }, 3000);
}

// ===== CHART =====
let comboChart;
let halvingPeriodIdxs = [];

const halvingPlugin = {
    id: 'halvingLine',
    afterDraw(chart) {
        if (halvingPeriodIdxs.length === 0) return;
        const xScale = chart.scales.x;
        const dataLen = chart.data.labels.length;
        const ctx = chart.ctx;
        ctx.save();
        for (const h of halvingPeriodIdxs) {
            if (h.idx >= dataLen) continue;
            const x = xScale.getPixelForValue(h.idx);
            if (x < chart.chartArea.left || x > chart.chartArea.right) continue;
            ctx.beginPath();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#f7931a';
            ctx.lineWidth = 2;
            ctx.moveTo(x, chart.chartArea.top);
            ctx.lineTo(x, chart.chartArea.bottom);
            ctx.stroke();
            ctx.fillStyle = '#f7931a';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('HALVING \u2192 ' + h.reward + ' BTC', x, chart.chartArea.top - 6);
        }
        ctx.restore();
    }
};

const darkGrid = 'rgba(255, 255, 255, 0.06)';
const muted = '#888';

function createGlossGradient(ctx, chartArea, r, g, b, alpha) {
    const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha + 0.25) + ')');
    grad.addColorStop(0.35, 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')');
    grad.addColorStop(0.65, 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha - 0.12) + ')');
    grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha + 0.05) + ')');
    return grad;
}

const glossPlugin = {
    id: 'glossBars',
    beforeDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const area = chart.chartArea;
        if (!area) return;
        chart.data.datasets[0].backgroundColor = createGlossGradient(ctx, area, 247, 147, 26, 0.55);
        chart.data.datasets[1].backgroundColor = createGlossGradient(ctx, area, 140, 140, 140, 0.40);
    }
};

function initChart() {
    comboChart = new Chart(document.getElementById('comboChart'), {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    type: 'bar',
                    label: 'PnL BTC',
                    data: [],
                    backgroundColor: 'rgba(247, 147, 26, 0.60)',
                    borderColor: '#f7931a',
                    borderWidth: 1,
                    borderRadius: 3,
                    yAxisID: 'yBTC',
                    order: 2
                },
                {
                    type: 'bar',
                    label: 'BTC HODL',
                    data: [],
                    backgroundColor: 'rgba(140, 140, 140, 0.45)',
                    borderColor: '#999',
                    borderWidth: 1,
                    borderRadius: 3,
                    yAxisID: 'yBTC',
                    order: 3
                },
                {
                    type: 'line',
                    label: 'Total Economic Value (USD)',
                    data: [],
                    borderColor: '#f7931a',
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: '#f7931a',
                    tension: 0.3,
                    yAxisID: 'yUSD',
                    order: 1
                },
                {
                    type: 'line',
                    label: 'Miners Owned',
                    data: [],
                    borderColor: '#ffffff',
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: '#ffffff',
                    stepped: 'after',
                    fill: true,
                    yAxisID: 'yMachines',
                    order: 0,
                    hidden: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#e8e8e8', font: { size: 12 }, padding: 16, usePointStyle: true, pointStyleWidth: 16 }
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 10, 10, 0.92)',
                    borderColor: 'rgba(255, 255, 255, 0.10)',
                    borderWidth: 1,
                    titleColor: '#e8e8e8',
                    bodyColor: '#e8e8e8',
                    padding: 12,
                    bodySpacing: 6,
                    callbacks: {
                        title: function(items) { return 'Period ' + items[0].label; },
                        label: function(ctx) {
                            const ds = ctx.dataset;
                            if (ds.yAxisID === 'yMachines') return ds.label + ': ' + ctx.parsed.y;
                            else if (ds.yAxisID === 'yUSD') return ds.label + ': ' + fmtUSDFull(ctx.parsed.y);
                            else return ds.label + ': ' + fmtBTC(ctx.parsed.y, 8) + ' BTC';
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: muted, maxRotation: 0, autoSkipPadding: 8, font: { size: 11 } },
                    grid: { color: darkGrid }
                },
                yBTC: {
                    type: 'linear', position: 'left', beginAtZero: true,
                    title: { display: true, text: 'BTC (PnL, BTC HODL)', color: muted, font: { size: 12 } },
                    ticks: {
                        color: muted, font: { size: 11 },
                        callback: function(v) {
                            if (v >= 1) return v.toFixed(2);
                            if (v >= 0.01) return v.toFixed(3);
                            return v.toFixed(4);
                        }
                    },
                    grid: { color: darkGrid }
                },
                yUSD: {
                    type: 'linear', position: 'right', beginAtZero: true,
                    title: { display: true, text: 'Total Economic Value (USD)', color: muted, font: { size: 12 } },
                    ticks: {
                        color: '#f7931a', font: { size: 11 },
                        callback: function(v) {
                            if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
                            if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
                            return '$' + v.toFixed(0);
                        }
                    },
                    grid: { drawOnChartArea: false }
                },
                yMachines: {
                    type: 'linear', position: 'right', beginAtZero: true, display: false,
                    title: { display: true, text: 'Miners', color: '#ffffff', font: { size: 12 } },
                    ticks: {
                        color: '#ffffff', font: { size: 11 }, stepSize: 1,
                        callback: function(v) { return Number.isInteger(v) ? v : ''; }
                    },
                    grid: { drawOnChartArea: false }
                }
            }
        },
        plugins: [halvingPlugin, glossPlugin]
    });
}

// ===== MAIN CALCULATION =====
function recalculate() {
    const btcPrice0 = parseFloat(el.btcPrice.value) || 96000;
    const monthlyPriceChangePct = (parseFloat(el.priceChange.value) || 0) / 100;
    const difficultyT = parseFloat(el.difficulty.value) || 125.86;
    const difficulty0 = difficultyT * 1e12;
    const monthlyDiffChangePct = (parseFloat(el.diffChange.value) || 0) / 100;
    const numPeriods = Math.max(1, parseInt(el.investPeriod.value) || 24);
    const hashrateTH = parseFloat(el.hashrate.value) || 335;
    const powerKW = parseFloat(el.power.value) || 5.36;
    const capex = parseFloat(el.capex.value) || 0;
    const machineCount = Math.max(1, parseInt(el.machineCount.value) || 1);
    const elecCost = parseFloat(el.elecCost.value) || 0;
    const poolFeePct = (parseFloat(el.poolFee.value) || 0) / 100;
    const uptimePct = (parseFloat(el.uptime.value) || 100) / 100;
    const hodlPct = (parseFloat(el.hodlRatio.value) || 0) / 100;
    const savingsElec = savingsElecToggle.checked;
    const autoReplace = autoReplaceToggle.checked;
    const btcTreasury = parseFloat(el.btcTreasury.value) || 0;
    const lifespanMonths = Math.max(1, parseInt(el.minerLifespan.value) || 36);
    const salvagePct = (parseFloat(el.salvageValue.value) || 0) / 100;

    const pLen = periodLengthSel.value;
    const pCfg = PERIOD_CONFIG[pLen];
    const daysPerPeriod = pCfg.days;

    const priceChangePerPeriod = Math.pow(1 + monthlyPriceChangePct, daysPerPeriod / 30.44) - 1;
    const diffChangePerPeriod = Math.pow(1 + monthlyDiffChangePct, daysPerPeriod / 30.44) - 1;
    const lifespanPeriods = Math.max(1, Math.round(lifespanMonths * (30.44 / daysPerPeriod)));

    const monthlyMinerAdditions = Math.max(0, parseInt(el.minerAdditions.value) || 0);
    const deductAdditionCapex = additionCapexToggle.checked;
    const additionsPerPeriod = monthlyMinerAdditions * (daysPerPeriod / 30.44);
    additionCapexRow.style.display = monthlyMinerAdditions > 0 ? '' : 'none';

    const totalCapex = capex * machineCount;
    const reinvestMode = reinvestToggle.checked;

    const reinvestHint = document.getElementById('reinvestHint');
    if (reinvestMode && hodlPct >= 1) reinvestHint.textContent = 'HODL is 100% — no fiat to reinvest';
    else if (reinvestMode && capex <= 0) reinvestHint.textContent = 'Set Machine CAPEX > $0 for reinvest';
    else reinvestHint.textContent = '';

    document.getElementById('periodLabel').textContent = numPeriods + ' ' + pCfg.label;
    document.getElementById('periodSuffix').textContent = pCfg.label;
    document.getElementById('metBreakEvenUnit').textContent = pCfg.labelSingular;

    const startDate = new Date();

    halvingPeriodIdxs = [];
    for (let i = 0; i < numPeriods; i++) {
        const daysElapsed = i * daysPerPeriod;
        const pDate = new Date(startDate.getTime() + daysElapsed * 86400000);
        const prevDays = Math.max(0, (i - 1)) * daysPerPeriod;
        const prevDate = new Date(startDate.getTime() + prevDays * 86400000);
        const rewNow = getBlockReward(pDate);
        const rewPrev = i === 0 ? CURRENT_BLOCK_REWARD : getBlockReward(prevDate);
        if (rewNow < rewPrev) halvingPeriodIdxs.push({ idx: i, reward: rewNow });
    }

    let cumulBtcHeld = btcTreasury;
    let cumulBtcMined = 0;
    let cumulCashFlow = -totalCapex;
    let cumulElecCost = 0;
    let breakEvenPeriod = null;
    const minerBatches = [{ period: 0, count: machineCount }];
    let activeMachines = machineCount;
    let reinvestPool = 0;
    let totalMachinesBought = 0;
    let totalMinersRetired = 0;
    let cumulSalvageValue = 0;
    let additionAccum = 0;
    let totalScheduledAdded = 0;

    const labels = [];
    const pnlBtcData = [];
    const btcHodlData = [];
    const usdValueData = [];
    const machinesData = [];
    const tableRows = [];

    for (let i = 0; i < numPeriods; i++) {
        const daysElapsed = i * daysPerPeriod;
        const periodDate = new Date(startDate.getTime() + daysElapsed * 86400000);
        const btcPrice = btcPrice0 * Math.pow(1 + priceChangePerPeriod, i);
        const difficulty = difficulty0 * Math.pow(1 + diffChangePerPeriod, i);
        const blockReward = getBlockReward(periodDate);

        let retiredThisPeriod = 0;
        let salvageThisPeriod = 0;
        for (const batch of minerBatches) {
            if (batch.count > 0 && (i - batch.period) >= lifespanPeriods) {
                retiredThisPeriod += batch.count;
                salvageThisPeriod += batch.count * capex * salvagePct;
                activeMachines -= batch.count;
                batch.count = 0;
            }
        }
        totalMinersRetired += retiredThisPeriod;
        cumulSalvageValue += salvageThisPeriod;

        let replacedThisPeriod = 0;
        if (autoReplace && retiredThisPeriod > 0) {
            replacedThisPeriod = retiredThisPeriod;
            activeMachines += replacedThisPeriod;
            minerBatches.push({ period: i, count: replacedThisPeriod });
            const replacementCost = replacedThisPeriod * capex * (1 - salvagePct);
            cumulCashFlow -= replacementCost;
        }

        if (!autoReplace && salvageThisPeriod > 0) {
            if (reinvestMode) reinvestPool += salvageThisPeriod;
            else cumulCashFlow += salvageThisPeriod;
        }

        let scheduledThisPeriod = 0;
        if (monthlyMinerAdditions > 0 && i > 0) {
            additionAccum += additionsPerPeriod;
            scheduledThisPeriod = Math.floor(additionAccum);
            additionAccum -= scheduledThisPeriod;
            if (scheduledThisPeriod > 0) {
                activeMachines += scheduledThisPeriod;
                totalScheduledAdded += scheduledThisPeriod;
                minerBatches.push({ period: i, count: scheduledThisPeriod });
                if (deductAdditionCapex) cumulCashFlow -= scheduledThisPeriod * capex;
            }
        }

        const currentHashrateH = hashrateTH * activeMachines * 1e12;
        const currentPowerKW = powerKW * activeMachines;
        const dailyBTCGross = (currentHashrateH * SECONDS_PER_DAY * blockReward) / (difficulty * TWO_POW_32);
        const dailyBTCNet = dailyBTCGross * (1 - poolFeePct) * uptimePct;
        const periodBTCMined = dailyBTCNet * daysPerPeriod;
        const periodElecCost = currentPowerKW * 24 * daysPerPeriod * elecCost * uptimePct;

        let btcHeld, btcSold, cashFromSales, periodCashFlow;
        if (savingsElec) {
            btcHeld = periodBTCMined * hodlPct;
            btcSold = periodBTCMined * (1 - hodlPct);
            cashFromSales = btcSold * btcPrice;
            periodCashFlow = cashFromSales;
        } else {
            btcHeld = periodBTCMined * hodlPct;
            btcSold = periodBTCMined * (1 - hodlPct);
            cashFromSales = btcSold * btcPrice;
            periodCashFlow = cashFromSales - periodElecCost;
        }

        let machinesBoughtThisPeriod = 0;
        let reinvestSpent = 0;
        if (reinvestMode && capex > 0 && periodCashFlow > 0) {
            reinvestPool += periodCashFlow;
            while (reinvestPool >= capex) {
                reinvestPool -= capex;
                activeMachines++;
                totalMachinesBought++;
                machinesBoughtThisPeriod++;
                reinvestSpent += capex;
            }
            if (machinesBoughtThisPeriod > 0) minerBatches.push({ period: i, count: machinesBoughtThisPeriod });
        }

        cumulBtcMined += periodBTCMined;
        cumulBtcHeld += btcHeld;
        cumulElecCost += periodElecCost;
        if (reinvestMode && capex > 0 && periodCashFlow > 0) cumulCashFlow += periodCashFlow - reinvestSpent;
        else cumulCashFlow += periodCashFlow;

        const totalEconomicValue = cumulCashFlow + reinvestPool + (cumulBtcHeld * btcPrice);
        if (breakEvenPeriod === null && totalEconomicValue >= 0) breakEvenPeriod = i + 1;

        labels.push(String(i + 1));
        pnlBtcData.push(periodBTCMined);
        btcHodlData.push(cumulBtcHeld);
        usdValueData.push(totalEconomicValue);
        machinesData.push(activeMachines);

        tableRows.push({
            period: i + 1, btcPrice, diffT: difficulty / 1e12, blockReward, machines: activeMachines,
            machinesBought: machinesBoughtThisPeriod, scheduledAdded: scheduledThisPeriod,
            retiredThisPeriod, replacedThisPeriod, pnlBtc: periodBTCMined, btcHodlCumul: cumulBtcHeld,
            usdValue: cumulBtcHeld * btcPrice, elecCost: periodElecCost, netCashFlow: periodCashFlow,
            cumulPL: totalEconomicValue, isHalving: halvingPeriodIdxs.some(h => h.idx === i)
        });
    }

    const finalBtcPrice = btcPrice0 * Math.pow(1 + priceChangePerPeriod, numPeriods);
    const heldBtcValue = cumulBtcHeld * finalBtcPrice;
    const totalPL = cumulCashFlow + heldBtcValue;
    const roi = totalCapex > 0 ? ((totalPL / totalCapex) * 100) : 0;

    const initHashrateH = hashrateTH * machineCount * 1e12;
    const initPowerKW = powerKW * machineCount;
    const dailyBTCDay1 = (initHashrateH * SECONDS_PER_DAY * getBlockReward(startDate)) / (difficulty0 * TWO_POW_32);
    const dailyBTCDay1Net = dailyBTCDay1 * (1 - poolFeePct) * uptimePct;
    const dailyRevenueDay1 = dailyBTCDay1Net * btcPrice0;
    const dailyElecDay1 = initPowerKW * 24 * elecCost * uptimePct;
    const dailyProfitDay1 = dailyRevenueDay1 - dailyElecDay1;
    const costPerBTC = dailyBTCDay1Net > 0 ? (dailyElecDay1 / dailyBTCDay1Net) : Infinity;
    const efficiency = hashrateTH > 0 ? ((powerKW * 1000) / hashrateTH) : 0;

    // ===== UPDATE DOM =====
    document.getElementById('metDailyRev').textContent = fmtUSD(dailyRevenueDay1);
    document.getElementById('metDailyElec').textContent = fmtUSD(dailyElecDay1);

    const profitEl = document.getElementById('metDailyProfit');
    profitEl.textContent = fmtUSD(dailyProfitDay1);
    profitEl.className = 'value ' + (dailyProfitDay1 >= 0 ? 'positive' : 'negative');

    const costBTCEl = document.getElementById('metCostPerBTC');
    costBTCEl.textContent = fmtUSD(costPerBTC);
    costBTCEl.className = 'value ' + (costPerBTC <= btcPrice0 ? 'positive' : 'negative');

    document.getElementById('metEfficiency').textContent = efficiency.toFixed(1);
    document.getElementById('metTotalMined').textContent = fmtBTC(cumulBtcMined);
    document.getElementById('metTotalHeld').textContent = fmtBTC(cumulBtcHeld);

    const heldValEl = document.getElementById('metHeldValue');
    heldValEl.textContent = fmtUSD(heldBtcValue);
    heldValEl.className = 'value btc-orange';
    document.getElementById('metFinalPrice').textContent = 'at ' + fmtUSD(finalBtcPrice) + '/BTC';

    const plEl = document.getElementById('metTotalPL');
    plEl.textContent = fmtUSD(totalPL);
    plEl.className = 'value ' + (totalPL >= 0 ? 'positive' : 'negative');
    document.getElementById('metROI').textContent = totalCapex > 0 ? (roi >= 0 ? '+' : '') + roi.toFixed(1) + '% ROI' : '';

    const beEl = document.getElementById('metBreakEven');
    beEl.textContent = breakEvenPeriod !== null ? breakEvenPeriod : 'Never';
    beEl.className = 'value ' + (breakEvenPeriod !== null ? 'positive' : 'negative');

    const machinesCard = document.getElementById('metMachinesCard');
    const hasGrowth = totalMachinesBought > 0 || totalScheduledAdded > 0 || totalMinersRetired > 0;
    if (hasGrowth) {
        machinesCard.style.display = '';
        document.getElementById('metTotalMachines').textContent = activeMachines;
        const parts = [];
        if (totalMachinesBought > 0) parts.push('+' + totalMachinesBought + ' reinvest');
        if (totalScheduledAdded > 0) parts.push('+' + totalScheduledAdded + ' scheduled');
        if (totalMinersRetired > 0 && autoReplace) parts.push(totalMinersRetired + ' replaced');
        else if (totalMinersRetired > 0) parts.push('-' + totalMinersRetired + ' retired');
        document.getElementById('metMachinesSub').textContent = parts.join(', ');
    } else {
        machinesCard.style.display = 'none';
    }

    // ===== UPDATE CHART =====
    comboChart.data.labels = labels;
    comboChart.data.datasets[0].data = pnlBtcData;
    comboChart.data.datasets[1].data = btcHodlData;
    comboChart.data.datasets[2].data = usdValueData;
    comboChart.data.datasets[3].data = machinesData;

    const showMiners = hasGrowth;
    comboChart.data.datasets[3].hidden = !showMiners;
    comboChart.options.scales.yMachines.display = showMiners;
    comboChart.update();

    // ===== UPDATE TABLE =====
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';
    for (const r of tableRows) {
        const tr = document.createElement('tr');
        if (r.isHalving) tr.classList.add('halving-row');
        tr.innerHTML =
            '<td>' + r.period + (r.isHalving ? ' <span style="color:#f7931a">&#x26A0; Halving</span>' : '') + '</td>' +
            '<td>' + fmtUSDFull(r.btcPrice) + '</td>' +
            '<td>' + r.diffT.toFixed(2) + '</td>' +
            '<td>' + r.blockReward + ' BTC</td>' +
            '<td>' + r.machines + (r.retiredThisPeriod > 0 && r.replacedThisPeriod > 0 ? ' <span style="color:#fb923c">(' + r.retiredThisPeriod + ' replaced)</span>' : r.retiredThisPeriod > 0 ? ' <span style="color:#ef4444">(-' + r.retiredThisPeriod + ' retired)</span>' : '') + (r.machinesBought > 0 ? ' <span style="color:#4ade80">(+' + r.machinesBought + ')</span>' : '') + (r.scheduledAdded > 0 ? ' <span style="color:#f59e0b">(+' + r.scheduledAdded + ' sched)</span>' : '') + '</td>' +
            '<td>' + r.pnlBtc.toFixed(8) + '</td>' +
            '<td>' + r.btcHodlCumul.toFixed(6) + '</td>' +
            '<td>' + fmtUSDFull(r.usdValue) + '</td>' +
            '<td style="color:#ef4444">' + fmtUSDFull(r.elecCost) + '</td>' +
            '<td style="color:' + (r.netCashFlow >= 0 ? '#4ade80' : '#ef4444') + '">' + fmtUSDFull(r.netCashFlow) + '</td>' +
            '<td style="color:' + (r.cumulPL >= 0 ? '#4ade80' : '#ef4444') + '">' + fmtUSDFull(r.cumulPL) + '</td>';
        tbody.appendChild(tr);
    }

    // Persist (only if not using fleet data for locked fields)
    if (!useFleetToggle.checked) saveSettings();
}

// ===== EVENT LISTENERS =====
inputIds.forEach(id => { document.getElementById(id).addEventListener('input', recalculate); });
periodLengthSel.addEventListener('change', recalculate);

additionCapexToggle.addEventListener('change', () => {
    additionCapexRow.classList.toggle('active', additionCapexToggle.checked);
    recalculate();
});
reinvestToggle.addEventListener('change', () => {
    reinvestRow.classList.toggle('active', reinvestToggle.checked);
    recalculate();
});
savingsElecToggle.addEventListener('change', () => {
    savingsElecRow.classList.toggle('active', savingsElecToggle.checked);
    recalculate();
});
autoReplaceToggle.addEventListener('change', () => {
    autoReplaceRow.classList.toggle('active', autoReplaceToggle.checked);
    recalculate();
});
hodlSlider.addEventListener('input', () => {
    el.hodlRatio.value = hodlSlider.value;
    recalculate();
});
el.hodlRatio.addEventListener('input', () => { hodlSlider.value = el.hodlRatio.value; });

document.getElementById('toggleTable').addEventListener('click', function() {
    const tc = document.getElementById('tableContainer');
    const showing = tc.style.display !== 'none';
    tc.style.display = showing ? 'none' : 'block';
    this.textContent = showing ? 'Show Period Breakdown' : 'Hide Period Breakdown';
});

document.getElementById('resetDefaults').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
});

// ===== PWA SERVICE WORKER =====
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=45').catch(() => {});
}

// ===== INIT =====
initNav('calculator');
initChart();
loadSettings();

// Restore fleet toggle state
var ionSettings = FleetData.getSettings();
if (ionSettings.useFleetData) {
    useFleetToggle.checked = true;
    applyFleetData();
}

recalculate();
fetchLiveData().then(() => recalculate());
