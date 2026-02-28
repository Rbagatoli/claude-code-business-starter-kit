// ===== ION MINING GROUP — Charts Page =====

initNav('charts');

var statusEl = document.getElementById('chartsStatus');
var priceChartInstance = null;
var diffChartInstance = null;
var hashChartInstance = null;
var hashPriceChartInstance = null;
var poolChartInstance = null;

// Live value display elements
var priceValueEl = document.getElementById('priceValue');
var diffValueEl = document.getElementById('diffValue');
var hashValueEl = document.getElementById('hashValue');
var hashPriceValueEl = document.getElementById('hashPriceValue');
var poolValueEl = document.getElementById('poolValue');

// Cached raw data — fetched once, filtered client-side
var allPriceData = null;
var allMiningData = null;

// Track latest values for reset on mouse leave
var latestPrice = null;
var latestDiff = null;
var latestHash = null;
var latestHashPrice = null;

var chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
        legend: { display: false },
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
            ticks: { color: '#888', font: { size: 11 }, maxTicksLimit: 12 },
            grid: { color: 'rgba(255, 255, 255, 0.06)' }
        },
        y: {
            ticks: { color: '#888', font: { size: 11 } },
            grid: { color: 'rgba(255, 255, 255, 0.06)' }
        }
    }
};

// ===== Date formatters =====

function formatDate(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
}

function formatMonthYear(ts) {
    var d = new Date(ts * 1000);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getFullYear().toString().slice(2);
}

function formatFullDate(ts) {
    var d = new Date(ts);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

// ===== Value formatters =====

function formatPriceValue(v) {
    return '$' + Math.round(v).toLocaleString();
}
function formatDiffValue(v) {
    return v.toFixed(2) + ' T';
}
function formatHashValue(v) {
    return v.toFixed(1) + ' EH/s';
}
function formatHashPriceValue(v) {
    return '$' + v.toFixed(4) + '/TH';
}

// ===== Label maps =====

var priceDaysLabels = { '7': '7 Days', '30': '30 Days', '90': '90 Days', '180': '6 Months', '365': '1 Year', 'max': 'All Time' };
var miningTfLabels = { '3m': '3 Months', '6m': '6 Months', '1y': '1 Year', '3y': '3 Years', 'all': 'All Time' };
var miningTfDays = { '3m': 90, '6m': 180, '1y': 365, '3y': 1095, 'all': Infinity };
var poolTfLabels = { '24h': '24 Hours', '3d': '3 Days', '1w': '1 Week', '1m': '1 Month', '3m': '3 Months', '6m': '6 Months', '1y': '1 Year', 'all': 'All Time' };

// ===== Button helpers =====

function setActiveButton(container, btn) {
    var btns = container.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
    btn.classList.add('active');
}

// ===== Filter price data by days =====

function filterPriceData(prices, days) {
    if (days === 'max') return prices;
    var cutoff = (Date.now() / 1000) - (days * 24 * 60 * 60);
    return prices.filter(function(p) { return p.time >= cutoff; });
}

// ===== Filter mining data by timeframe =====

function filterMiningArray(arr, timeKey, tfDays) {
    if (tfDays === Infinity) return arr;
    var cutoff = (Date.now() / 1000) - (tfDays * 24 * 60 * 60);
    return arr.filter(function(item) { return item[timeKey] >= cutoff; });
}

// ===== Render BTC Price Chart =====

function renderPriceChart(days) {
    if (!allPriceData) return;

    var filtered = filterPriceData(allPriceData, days);
    var priceLabels = [];
    var priceValues = [];

    var maxPoints = 120;
    var step = Math.max(1, Math.floor(filtered.length / maxPoints));
    for (var i = 0; i < filtered.length; i += step) {
        var tsMs = filtered[i].time * 1000;
        if (days === 'max' || days >= 365) {
            priceLabels.push(formatFullDate(tsMs));
        } else {
            priceLabels.push(formatDate(tsMs));
        }
        priceValues.push(Math.round(filtered[i].close));
    }

    // Set latest value
    latestPrice = priceValues[priceValues.length - 1];
    if (priceValueEl) priceValueEl.textContent = formatPriceValue(latestPrice);

    if (priceChartInstance) priceChartInstance.destroy();

    priceChartInstance = new Chart(document.getElementById('priceChart'), {
        type: 'line',
        data: {
            labels: priceLabels,
            datasets: [{
                label: 'BTC Price (USD)',
                data: priceValues,
                borderColor: '#f7931a',
                backgroundColor: 'rgba(247, 147, 26, 0.10)',
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.3
            }]
        },
        options: Object.assign({}, chartOptions, {
            scales: Object.assign({}, chartOptions.scales, {
                y: {
                    ticks: {
                        color: '#f7931a',
                        font: { size: 11 },
                        callback: function(v) {
                            if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
                            if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'k';
                            return '$' + v;
                        }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                }
            }),
            plugins: Object.assign({}, chartOptions.plugins, {
                tooltip: Object.assign({}, chartOptions.plugins.tooltip, {
                    callbacks: {
                        label: function(ctx) { return '$' + ctx.parsed.y.toLocaleString(); }
                    },
                    external: function(context) {
                        var tooltip = context.tooltip;
                        if (tooltip.opacity === 0) {
                            if (priceValueEl && latestPrice != null) priceValueEl.textContent = formatPriceValue(latestPrice);
                            return;
                        }
                        if (tooltip.dataPoints && tooltip.dataPoints.length > 0) {
                            if (priceValueEl) priceValueEl.textContent = formatPriceValue(tooltip.dataPoints[0].parsed.y);
                        }
                    }
                })
            })
        }),
        plugins: [{
            id: 'priceMouseLeave',
            beforeEvent: function(chart, args) {
                if (args.event.type === 'mouseout' && priceValueEl && latestPrice != null) {
                    priceValueEl.textContent = formatPriceValue(latestPrice);
                }
            }
        }]
    });

    document.getElementById('priceTitle').textContent = 'BTC Price (' + priceDaysLabels[days] + ')';
}

// ===== Render Difficulty Chart =====

function renderDifficultyChart(timeframe) {
    if (!allMiningData) return;

    var tfDays = miningTfDays[timeframe];
    var diffs = filterMiningArray(allMiningData.difficulty || [], 'time', tfDays);
    var diffLabels = [];
    var diffValues = [];
    for (var d = 0; d < diffs.length; d++) {
        diffLabels.push(formatMonthYear(diffs[d].time));
        diffValues.push(parseFloat((diffs[d].difficulty / 1e12).toFixed(2)));
    }

    // Set latest value
    latestDiff = diffValues[diffValues.length - 1];
    if (diffValueEl) diffValueEl.textContent = formatDiffValue(latestDiff);

    if (diffChartInstance) diffChartInstance.destroy();

    diffChartInstance = new Chart(document.getElementById('difficultyChart'), {
        type: 'line',
        data: {
            labels: diffLabels,
            datasets: [{
                label: 'Difficulty (T)',
                data: diffValues,
                borderColor: '#4ade80',
                backgroundColor: 'rgba(74, 222, 128, 0.10)',
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                stepped: 'after',
                tension: 0
            }]
        },
        options: Object.assign({}, chartOptions, {
            scales: Object.assign({}, chartOptions.scales, {
                y: {
                    ticks: {
                        color: '#4ade80',
                        font: { size: 11 },
                        callback: function(v) { return v.toFixed(0) + ' T'; }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                }
            }),
            plugins: Object.assign({}, chartOptions.plugins, {
                tooltip: Object.assign({}, chartOptions.plugins.tooltip, {
                    callbacks: {
                        label: function(ctx) { return ctx.parsed.y.toFixed(2) + ' T'; }
                    },
                    external: function(context) {
                        var tooltip = context.tooltip;
                        if (tooltip.opacity === 0) {
                            if (diffValueEl && latestDiff != null) diffValueEl.textContent = formatDiffValue(latestDiff);
                            return;
                        }
                        if (tooltip.dataPoints && tooltip.dataPoints.length > 0) {
                            if (diffValueEl) diffValueEl.textContent = formatDiffValue(tooltip.dataPoints[0].parsed.y);
                        }
                    }
                })
            })
        }),
        plugins: [{
            id: 'diffMouseLeave',
            beforeEvent: function(chart, args) {
                if (args.event.type === 'mouseout' && diffValueEl && latestDiff != null) {
                    diffValueEl.textContent = formatDiffValue(latestDiff);
                }
            }
        }]
    });

    document.getElementById('diffTitle').textContent = 'Network Difficulty (' + miningTfLabels[timeframe] + ')';
}

// ===== Render Hashrate Chart =====

function renderHashrateChart(timeframe) {
    if (!allMiningData) return;

    var tfDays = miningTfDays[timeframe];
    var hashes = filterMiningArray(allMiningData.hashrates || [], 'timestamp', tfDays);
    var hashLabels = [];
    var hashValues = [];
    for (var h = 0; h < hashes.length; h++) {
        hashLabels.push(formatMonthYear(hashes[h].timestamp));
        hashValues.push(parseFloat((hashes[h].avgHashrate / 1e18).toFixed(1)));
    }

    // Set latest value
    latestHash = hashValues[hashValues.length - 1];
    if (hashValueEl) hashValueEl.textContent = formatHashValue(latestHash);

    if (hashChartInstance) hashChartInstance.destroy();

    hashChartInstance = new Chart(document.getElementById('hashrateChart'), {
        type: 'line',
        data: {
            labels: hashLabels,
            datasets: [{
                label: 'Hashrate (EH/s)',
                data: hashValues,
                borderColor: '#60a5fa',
                backgroundColor: 'rgba(96, 165, 250, 0.10)',
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.3
            }]
        },
        options: Object.assign({}, chartOptions, {
            scales: Object.assign({}, chartOptions.scales, {
                y: {
                    ticks: {
                        color: '#60a5fa',
                        font: { size: 11 },
                        callback: function(v) { return v.toFixed(0) + ' EH/s'; }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                }
            }),
            plugins: Object.assign({}, chartOptions.plugins, {
                tooltip: Object.assign({}, chartOptions.plugins.tooltip, {
                    callbacks: {
                        label: function(ctx) { return ctx.parsed.y.toFixed(1) + ' EH/s'; }
                    },
                    external: function(context) {
                        var tooltip = context.tooltip;
                        if (tooltip.opacity === 0) {
                            if (hashValueEl && latestHash != null) hashValueEl.textContent = formatHashValue(latestHash);
                            return;
                        }
                        if (tooltip.dataPoints && tooltip.dataPoints.length > 0) {
                            if (hashValueEl) hashValueEl.textContent = formatHashValue(tooltip.dataPoints[0].parsed.y);
                        }
                    }
                })
            })
        }),
        plugins: [{
            id: 'hashMouseLeave',
            beforeEvent: function(chart, args) {
                if (args.event.type === 'mouseout' && hashValueEl && latestHash != null) {
                    hashValueEl.textContent = formatHashValue(latestHash);
                }
            }
        }]
    });

    document.getElementById('hashTitle').textContent = 'Network Hashrate (' + miningTfLabels[timeframe] + ')';
}

// ===== Reset values when pointer leaves chart containers =====

var chartContainers = document.querySelectorAll('.earnings-chart-container');
chartContainers.forEach(function(container) {
    container.addEventListener('pointerleave', function() {
        if (priceValueEl && latestPrice != null) priceValueEl.textContent = formatPriceValue(latestPrice);
        if (diffValueEl && latestDiff != null) diffValueEl.textContent = formatDiffValue(latestDiff);
        if (hashValueEl && latestHash != null) hashValueEl.textContent = formatHashValue(latestHash);
        if (hashPriceValueEl && latestHashPrice != null) hashPriceValueEl.textContent = formatHashPriceValue(latestHashPrice);
    });
});

// ===== Button click handlers =====

document.getElementById('priceRange').addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    setActiveButton(this, btn);
    var days = btn.dataset.days === 'max' ? 'max' : parseInt(btn.dataset.days);
    renderPriceChart(days);
});

document.getElementById('hashPriceRange').addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    setActiveButton(this, btn);
    var days = btn.dataset.days === 'max' ? 'max' : parseInt(btn.dataset.days);
    renderHashPriceChart(days);
});

document.getElementById('miningRange').addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    setActiveButton(this, btn);
    renderDifficultyChart(btn.dataset.tf);
});

document.getElementById('hashRange').addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    setActiveButton(this, btn);
    renderHashrateChart(btn.dataset.tf);
});

document.getElementById('poolRange').addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    setActiveButton(this, btn);
    loadPoolDominance(btn.getAttribute('data-tf'));
});

// ===== Initial data load — fetch once, render from cache =====

(async function() {
    statusEl.textContent = 'Loading chart data...';

    var priceOk = false;
    var miningOk = false;

    // Fetch price data (CryptoCompare — free, full history)
    try {
        var priceRes = await fetch('https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&allData=true');
        if (priceRes.ok) {
            var priceJson = await priceRes.json();
            allPriceData = (priceJson.Data && priceJson.Data.Data) || [];
            if (allPriceData.length > 0) {
                renderPriceChart(90);
                priceOk = true;
            }
        } else {
            statusEl.textContent = 'Price API error ' + priceRes.status;
            statusEl.style.color = '#f55';
        }
    } catch (e) {
        statusEl.textContent = 'Price load failed: ' + e.message;
        statusEl.style.color = '#f55';
    }

    // Fetch mining data
    try {
        var miningRes = await fetch('https://mempool.space/api/v1/mining/hashrate/all');
        if (miningRes.ok) {
            allMiningData = await miningRes.json();
            renderDifficultyChart('1y');
            renderHashrateChart('1y');
            miningOk = true;
        } else {
            statusEl.textContent = 'Mining API error ' + miningRes.status;
            statusEl.style.color = '#f55';
        }
    } catch (e) {
        statusEl.textContent = 'Mining load failed: ' + e.message;
        statusEl.style.color = '#f55';
    }

    if (priceOk && miningOk) {
        statusEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
        statusEl.style.color = '#4ade80';
        renderHashPriceChart(90);
    }

    // Load network stats (non-blocking)
    loadNetworkStats();
    loadDifficultyAdjustment();
    loadPoolDominance('1w');
})();

// ===== NETWORK STATS =====

async function loadNetworkStats() {
    var results = { height: null, mempool: null, fees: null, blocks: null };

    try {
        var responses = await Promise.all([
            fetch('https://mempool.space/api/blocks/tip/height'),
            fetch('https://mempool.space/api/mempool'),
            fetch('https://mempool.space/api/v1/fees/recommended'),
            fetch('https://mempool.space/api/v1/blocks')
        ]);

        if (responses[0].ok) results.height = await responses[0].json();
        if (responses[1].ok) results.mempool = await responses[1].json();
        if (responses[2].ok) results.fees = await responses[2].json();
        if (responses[3].ok) results.blocks = await responses[3].json();
    } catch (e) {
        // Partial failure is OK — individual cards show "--"
    }

    // Block Height
    if (results.height != null) {
        document.getElementById('nsBlockHeight').textContent = results.height.toLocaleString();
        document.getElementById('nsBlockHeightSub').textContent = 'epoch ' + Math.floor(results.height / 210000);
    } else {
        document.getElementById('nsBlockHeightSub').textContent = 'offline';
    }

    // Mempool
    if (results.mempool) {
        document.getElementById('nsMempoolCount').textContent = results.mempool.count.toLocaleString();
        var vsizeMB = (results.mempool.vsize / 1e6).toFixed(1);
        document.getElementById('nsMempoolSize').textContent = vsizeMB + ' MvB';
    }

    // Fee Rates
    if (results.fees) {
        document.getElementById('nsFastFee').textContent = results.fees.fastestFee;
        document.getElementById('nsMedFee').textContent = results.fees.halfHourFee;
        document.getElementById('nsEcoFee').textContent = results.fees.economyFee || results.fees.hourFee || '--';
        // Log fee snapshot for chart
        logFeeSnapshot(results.fees);
    }

    // Mempool Weight
    if (results.mempool) {
        var maxBlockWeight = 4000000;
        var weightPct = (results.mempool.vsize / maxBlockWeight * 100).toFixed(1);
        document.getElementById('nsMempoolWeight').textContent = weightPct + '%';
        document.getElementById('nsMempoolWeightSub').textContent = (results.mempool.vsize / 1e6).toFixed(1) + ' MvB capacity';
    }

    // Avg block time since last difficulty adjustment (every 2016 blocks)
    // Uses allMiningData.difficulty (already fetched for charts) to get adjustment timestamp
    var avgBlockDone = false;
    var hasMining = !!(allMiningData && allMiningData.difficulty && allMiningData.difficulty.length > 0);
    if (results.height != null && results.blocks && results.blocks.length >= 1 && hasMining) {
        var lastAdjBlock = Math.floor(results.height / 2016) * 2016;
        var blocksSinceAdj = results.height - lastAdjBlock;
        var diffArr = allMiningData.difficulty;
        var adjTimestamp = diffArr[diffArr.length - 1].time;
        var latestTs = results.blocks[0].timestamp;
        if (blocksSinceAdj > 0 && latestTs > adjTimestamp) {
            var avgSeconds = (latestTs - adjTimestamp) / blocksSinceAdj;
            var avgMinutes = (avgSeconds / 60).toFixed(1);
            document.getElementById('nsAvgBlockTime').textContent = avgMinutes;
            document.getElementById('nsAvgBlockTimeSub').textContent =
                blocksSinceAdj.toLocaleString() + ' blocks since adj.';
            avgBlockDone = true;
        }
    }

    // Fallback: use last ~6 blocks if difficulty data unavailable
    if (!avgBlockDone && results.blocks && results.blocks.length >= 2) {
        var blockCount = Math.min(results.blocks.length, 6);
        var newest = results.blocks[0].timestamp;
        var oldest = results.blocks[blockCount - 1].timestamp;
        var avgSeconds = (newest - oldest) / (blockCount - 1);
        var avgMinutes = (avgSeconds / 60).toFixed(1);
        document.getElementById('nsAvgBlockTime').textContent = avgMinutes;
        document.getElementById('nsAvgBlockTimeSub').textContent = 'last ' + (blockCount - 1) + ' blocks';
    }

    // Store block height for halving countdown + supply tracker
    window.currentBlockHeight = results.height;
    renderHalvingCountdown();
    renderSupplyTracker();

    // Render block explorer from already-fetched blocks
    if (results.blocks) {
        renderBlockExplorer(results.blocks);
    }
    if (!blockRefreshTimer) {
        blockRefreshTimer = setInterval(refreshBlockExplorer, 60000);
    }
}

// ===== DIFFICULTY ADJUSTMENT COUNTDOWN =====

async function loadDifficultyAdjustment() {
    try {
        var resp = await fetch('https://mempool.space/api/v1/difficulty-adjustment');
        if (!resp.ok) return;
        var d = await resp.json();

        // Blocks remaining
        document.getElementById('diffBlocks').textContent = (d.remainingBlocks || 0).toLocaleString();
        document.getElementById('diffProgress').textContent = (d.progressPercent || 0).toFixed(1) + '% complete';

        // Time remaining
        var ms = d.remainingTime || 0;
        var days = Math.floor(ms / 86400000);
        var hrs = Math.floor((ms % 86400000) / 3600000);
        document.getElementById('diffTime').textContent = days + 'd ' + hrs + 'h';

        // Retarget date
        if (d.estimatedRetargetDate) {
            var dt = new Date(d.estimatedRetargetDate);
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            document.getElementById('diffDate').textContent = months[dt.getMonth()] + ' ' + dt.getDate();
        }

        // Difficulty change %
        var change = d.difficultyChange || 0;
        var changeEl = document.getElementById('diffChange');
        var sign = change >= 0 ? '+' : '';
        changeEl.textContent = sign + change.toFixed(2) + '%';
        changeEl.className = 'value ' + (change >= 0 ? 'negative' : 'positive');

        // Current difficulty (from mining data if available)
        if (allMiningData && allMiningData.currentDifficulty) {
            document.getElementById('diffCurrent').textContent = (allMiningData.currentDifficulty / 1e12).toFixed(2) + 'T';
        } else if (d.previousRetarget) {
            document.getElementById('diffCurrent').textContent = (d.previousRetarget / 1e12).toFixed(2) + 'T';
        }

        // Progress bar
        document.getElementById('diffProgressBar').style.width = (d.progressPercent || 0).toFixed(1) + '%';
    } catch (e) { /* silent fail — cards stay at "--" */ }
}

// ===== HALVING COUNTDOWN =====

var HALVING_INTERVAL = 210000;

function renderHalvingCountdown() {
    var card = document.getElementById('halvingCard');
    var height = window.currentBlockHeight;

    if (!height) {
        card.style.display = 'none';
        return;
    }

    card.style.display = '';

    var epoch = Math.floor(height / HALVING_INTERVAL);
    var nextHalvingBlock = (epoch + 1) * HALVING_INTERVAL;
    var blocksRemaining = nextHalvingBlock - height;
    var blocksIntoEpoch = height % HALVING_INTERVAL;
    var progressPct = ((blocksIntoEpoch / HALVING_INTERVAL) * 100).toFixed(2);

    // Time estimate: average 10 minutes per block
    var secondsRemaining = blocksRemaining * 10 * 60;
    var daysRemaining = Math.floor(secondsRemaining / 86400);
    var estDate = new Date(Date.now() + secondsRemaining * 1000);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var estDateStr = months[estDate.getMonth()] + ' ' + estDate.getDate() + ', ' + estDate.getFullYear();

    // Current block reward (halves each epoch: 50, 25, 12.5, 6.25, 3.125, ...)
    var reward = 50 / Math.pow(2, epoch);

    // Render values
    document.getElementById('halvingBlocksLeft').textContent = blocksRemaining.toLocaleString() + ' blocks';
    document.getElementById('halvingRemaining').textContent = blocksRemaining.toLocaleString();
    document.getElementById('halvingTarget').textContent = 'block ' + nextHalvingBlock.toLocaleString();
    document.getElementById('halvingEstDate').textContent = estDateStr;
    document.getElementById('halvingEstTime').textContent = '~' + daysRemaining + ' days';
    document.getElementById('halvingEpoch').textContent = epoch;
    document.getElementById('halvingReward').textContent = reward + ' BTC/block';
    document.getElementById('halvingProgress').textContent = progressPct + '%';
    document.getElementById('halvingProgressSub').textContent = blocksIntoEpoch.toLocaleString() + ' / ' + HALVING_INTERVAL.toLocaleString();
    document.getElementById('halvingDays').textContent = daysRemaining;
    document.getElementById('halvingProgressBar').style.width = progressPct + '%';
}

// ===== BLOCK EXPLORER =====

var blockRefreshTimer = null;

function formatTimeAgo(timestamp) {
    var diff = Math.floor(Date.now() / 1000) - timestamp;
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

function renderBlockExplorer(blocks) {
    if (!blocks || blocks.length === 0) return;

    var heightEl = document.getElementById('blockExplorerHeight');
    if (heightEl) heightEl.textContent = '#' + blocks[0].height.toLocaleString();

    var tbody = document.getElementById('blockExplorerBody');
    if (!tbody) return;

    var html = '';
    for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        var ago = formatTimeAgo(b.timestamp);
        var sizeMB = (b.size / 1e6).toFixed(2);
        var feesBTC = ((b.extras && b.extras.totalFees != null) ? b.extras.totalFees : 0) / 1e8;
        var poolName = 'Unknown';
        if (b.extras && b.extras.pool && b.extras.pool.name) poolName = b.extras.pool.name;

        html += '<tr>' +
            '<td><span class="btc-orange" style="font-weight:600;">' + b.height.toLocaleString() + '</span></td>' +
            '<td><span class="block-time-ago">' + ago + '</span></td>' +
            '<td><span class="block-pool-badge">' + poolName + '</span></td>' +
            '<td>' + b.tx_count.toLocaleString() + '</td>' +
            '<td>' + sizeMB + ' MB</td>' +
            '<td>' + feesBTC.toFixed(4) + ' BTC</td>' +
            '</tr>';
    }
    tbody.innerHTML = html;
}

async function refreshBlockExplorer() {
    try {
        var res = await fetch('https://mempool.space/api/v1/blocks');
        if (res.ok) {
            var blocks = await res.json();
            renderBlockExplorer(blocks);
        }
    } catch (e) { /* silent */ }
}

// ===== BITCOIN SUPPLY TRACKER =====

var MAX_SUPPLY = 21000000;

function calculateSupply(blockHeight) {
    var supply = 0;
    var reward = 50;
    var blocksProcessed = 0;

    while (blocksProcessed < blockHeight && reward >= 0.00000001) {
        var epochEnd = (Math.floor(blocksProcessed / HALVING_INTERVAL) + 1) * HALVING_INTERVAL;
        var blocksInThisEpoch = Math.min(blockHeight - blocksProcessed, epochEnd - blocksProcessed);
        supply += blocksInThisEpoch * reward;
        blocksProcessed += blocksInThisEpoch;
        if (blocksProcessed % HALVING_INTERVAL === 0) {
            reward /= 2;
        }
    }
    return supply;
}

function renderSupplyTracker() {
    var card = document.getElementById('supplyCard');
    var height = window.currentBlockHeight;

    if (!height) {
        card.style.display = 'none';
        return;
    }

    card.style.display = '';

    var supply = calculateSupply(height);
    var pctMined = (supply / MAX_SUPPLY) * 100;
    var remaining = MAX_SUPPLY - supply;

    var epoch = Math.floor(height / HALVING_INTERVAL);
    var currentReward = 50 / Math.pow(2, epoch);

    var blocksPerYear = 365.25 * 144;
    var annualNewBTC = blocksPerYear * currentReward;
    var inflationRate = (annualNewBTC / supply) * 100;
    var s2f = supply / annualNewBTC;

    document.getElementById('supplyMined').textContent = Math.floor(supply).toLocaleString() + ' BTC';
    document.getElementById('supplyTotal').textContent = Math.floor(supply).toLocaleString();
    document.getElementById('supplyTotalSub').textContent = 'of ' + MAX_SUPPLY.toLocaleString() + ' BTC';
    document.getElementById('supplyPercent').textContent = pctMined.toFixed(2) + '%';
    document.getElementById('supplyPercentSub').textContent = 'mined';
    document.getElementById('supplyInflation').textContent = inflationRate.toFixed(2) + '%';
    document.getElementById('supplyS2F').textContent = s2f.toFixed(1);
    document.getElementById('supplyS2FSub').textContent = 'years of production';
    document.getElementById('supplyRemaining').textContent = Math.floor(remaining).toLocaleString();
    document.getElementById('supplyProgressBar').style.width = pctMined.toFixed(2) + '%';
}

// ===== HASH PRICE ($/TH/day) =====

var GENESIS_TS = 1231006505;

function getBlockReward(ts) {
    var daysSinceGenesis = (ts - GENESIS_TS) / 86400;
    var approxHeight = daysSinceGenesis * 144;
    var epoch = Math.floor(approxHeight / 210000);
    return 50 / Math.pow(2, epoch);
}

function computeHashPriceData() {
    if (!allPriceData || !allMiningData || !allMiningData.hashrates) return null;

    var hashrates = allMiningData.hashrates;

    // Build sorted hashrate lookup (day -> TH/s)
    var hashByDay = {};
    for (var h = 0; h < hashrates.length; h++) {
        var dayKey = Math.floor(hashrates[h].timestamp / 86400) * 86400;
        hashByDay[dayKey] = hashrates[h].avgHashrate / 1e12;
    }
    var hashDays = Object.keys(hashByDay).map(Number).sort(function(a, b) { return a - b; });

    function getHashrateForDay(dayTs) {
        var result = null;
        for (var i = 0; i < hashDays.length; i++) {
            if (hashDays[i] <= dayTs) result = hashByDay[hashDays[i]];
            else break;
        }
        return result;
    }

    var result = [];
    for (var p = 0; p < allPriceData.length; p++) {
        var dayTs = Math.floor(allPriceData[p].time / 86400) * 86400;
        var hr = getHashrateForDay(dayTs);
        if (hr === null || hr <= 0) continue;

        var reward = getBlockReward(allPriceData[p].time);
        var hashPrice = (144 * reward * allPriceData[p].close) / hr;

        result.push({ time: allPriceData[p].time, hashPrice: hashPrice });
    }
    return result;
}

function renderHashPriceChart(days) {
    var allData = computeHashPriceData();
    if (!allData || allData.length === 0) return;

    var filtered = (days === 'max') ? allData : allData.filter(function(d) {
        return d.time >= (Date.now() / 1000) - (days * 86400);
    });

    var labels = [];
    var values = [];
    var maxPoints = 120;
    var step = Math.max(1, Math.floor(filtered.length / maxPoints));

    for (var i = 0; i < filtered.length; i += step) {
        var tsMs = filtered[i].time * 1000;
        if (days === 'max' || days >= 365) {
            labels.push(formatFullDate(tsMs));
        } else {
            labels.push(formatDate(tsMs));
        }
        values.push(parseFloat(filtered[i].hashPrice.toFixed(4)));
    }

    latestHashPrice = values[values.length - 1];
    if (hashPriceValueEl) hashPriceValueEl.textContent = formatHashPriceValue(latestHashPrice);

    if (hashPriceChartInstance) hashPriceChartInstance.destroy();

    var hpOptions = JSON.parse(JSON.stringify(chartOptions));
    hpOptions.scales.y.ticks = { color: '#a78bfa', font: { size: 11 }, callback: function(v) { return '$' + v.toFixed(2); } };

    hashPriceChartInstance = new Chart(document.getElementById('hashPriceChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Hash Price ($/TH/day)',
                data: values,
                borderColor: '#a78bfa',
                backgroundColor: 'rgba(167, 139, 250, 0.10)',
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.3
            }]
        },
        options: hpOptions,
        plugins: [{
            id: 'hashPriceMouseLeave',
            beforeEvent: function(chart, args) {
                if (args.event.type === 'mouseout' && hashPriceValueEl && latestHashPrice != null) {
                    hashPriceValueEl.textContent = formatHashPriceValue(latestHashPrice);
                }
            }
        }]
    });

    document.getElementById('hashPriceTitle').textContent = 'Hash Price (' + priceDaysLabels[days] + ')';
}

// ===== MINING POOL DOMINANCE =====

var poolDataCache = {};
var poolColors = [
    '#f7931a', '#60a5fa', '#4ade80', '#ef4444',
    '#fbbf24', '#a78bfa', '#f472b6', '#34d399', '#9ca3af'
];

async function loadPoolDominance(timeframe) {
    if (poolDataCache[timeframe]) {
        renderPoolChart(timeframe, poolDataCache[timeframe]);
        return;
    }
    try {
        var res = await fetch('https://mempool.space/api/v1/mining/pools/' + timeframe);
        if (!res.ok) return;
        var data = await res.json();
        poolDataCache[timeframe] = data;
        renderPoolChart(timeframe, data);
    } catch (e) {
        if (poolValueEl) poolValueEl.textContent = 'Error';
    }
}

function renderPoolChart(timeframe, data) {
    if (!data || !data.pools || data.pools.length === 0) return;

    var pools = data.pools.slice();
    var totalBlocks = data.blockCount || 0;

    pools.sort(function(a, b) { return b.blockCount - a.blockCount; });

    var topPools = pools.slice(0, 8);
    var otherBlocks = 0;
    for (var i = 8; i < pools.length; i++) {
        otherBlocks += pools[i].blockCount;
    }

    var labels = [];
    var values = [];
    var colors = [];
    for (var j = 0; j < topPools.length; j++) {
        var pct = totalBlocks > 0 ? ((topPools[j].blockCount / totalBlocks) * 100).toFixed(1) : '0';
        labels.push(topPools[j].name + ' (' + pct + '%)');
        values.push(topPools[j].blockCount);
        colors.push(poolColors[j]);
    }
    if (otherBlocks > 0) {
        var otherPct = totalBlocks > 0 ? ((otherBlocks / totalBlocks) * 100).toFixed(1) : '0';
        labels.push('Other (' + otherPct + '%)');
        values.push(otherBlocks);
        colors.push(poolColors[8]);
    }

    if (poolValueEl && topPools.length > 0) {
        var topPct = totalBlocks > 0 ? ((topPools[0].blockCount / totalBlocks) * 100).toFixed(1) : '0';
        poolValueEl.textContent = topPools[0].name + ' ' + topPct + '%';
    }

    document.getElementById('poolTitle').textContent = 'Mining Pool Dominance (' + (poolTfLabels[timeframe] || timeframe) + ')';

    if (poolChartInstance) poolChartInstance.destroy();

    var legendPos = window.innerWidth < 600 ? 'bottom' : 'right';

    poolChartInstance = new Chart(document.getElementById('poolChart'), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderColor: 'rgba(6, 6, 6, 0.8)',
                borderWidth: 2,
                hoverBorderColor: '#e8e8e8',
                hoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: {
                    display: true,
                    position: legendPos,
                    labels: {
                        color: '#e8e8e8',
                        font: { size: 11 },
                        padding: 12,
                        usePointStyle: true,
                        pointStyleWidth: 10
                    }
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
                            var pctVal = totalBlocks > 0 ? ((ctx.parsed / totalBlocks) * 100).toFixed(1) : '0';
                            return ctx.label.split(' (')[0] + ': ' + ctx.parsed.toLocaleString() + ' blocks (' + pctVal + '%)';
                        }
                    }
                }
            }
        }
    });
}

// ===== FEE RATE CHART =====
var feeChartInstance = null;
var feeTfLabels = { '24h': '24 Hours', '3d': '3 Days', '1w': '1 Week', '1m': '1 Month', '3m': '3 Months', '6m': '6 Months', '1y': '1 Year' };

// Fetch historical fee rates from mempool.space API
async function loadFeeRateHistory(timeframe) {
    try {
        var res = await fetch('https://mempool.space/api/v1/mining/blocks/fee-rates/' + timeframe);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        if (!data || data.length === 0) throw new Error('empty');
        renderFeeChart(timeframe, data);
    } catch(e) {
        // Fallback to localStorage data
        renderFeeChart(timeframe, null);
    }
}

// Keep local snapshots as supplementary data / offline fallback
function loadFeeHistory() {
    try {
        var raw = localStorage.getItem('ionMiningFeeHistory');
        if (!raw) return [];
        return JSON.parse(raw);
    } catch(e) { return []; }
}

function saveFeeHistory(data) {
    try {
        var cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
        var filtered = [];
        for (var i = 0; i < data.length; i++) {
            if (data[i].timestamp > cutoff) filtered.push(data[i]);
        }
        localStorage.setItem('ionMiningFeeHistory', JSON.stringify(filtered));
    } catch(e) {}
}

function logFeeSnapshot(fees) {
    var history = loadFeeHistory();
    var now = Date.now();
    if (history.length === 0 || now - history[history.length - 1].timestamp >= 3600000) {
        history.push({
            timestamp: now,
            fastest: fees.fastestFee,
            halfHour: fees.halfHourFee,
            economy: fees.economyFee || fees.hourFee || 1
        });
        saveFeeHistory(history);
    }
    // Load chart from API on page load
    loadFeeRateHistory('24h');
}

function renderFeeChart(timeframe, apiData) {
    var labels = [];
    var fastestData = [];
    var halfHourData = [];
    var economyData = [];

    if (apiData && apiData.length > 0) {
        // Use API data — downsample if too many points
        var maxPoints = 150;
        var step = Math.max(1, Math.floor(apiData.length / maxPoints));
        for (var i = 0; i < apiData.length; i += step) {
            var entry = apiData[i];
            var d = new Date(entry.timestamp * 1000);
            // Format label based on timeframe
            if (timeframe === '24h' || timeframe === '3d') {
                labels.push((d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':00');
            } else if (timeframe === '1w' || timeframe === '1m') {
                labels.push((d.getMonth() + 1) + '/' + d.getDate());
            } else {
                labels.push(formatMonthYear(entry.timestamp));
            }
            fastestData.push(entry.avgFee_90);
            halfHourData.push(entry.avgFee_50);
            economyData.push(entry.avgFee_10);
        }
    } else {
        // Fallback to localStorage
        var history = loadFeeHistory();
        if (history.length === 0) {
            if (document.getElementById('feeValue')) {
                document.getElementById('feeValue').textContent = '--';
            }
            return;
        }
        var tfHours = { '24h': 24, '3d': 72, '1w': 168, '1m': 720, '3m': 2160, '6m': 4320, '1y': 8760 };
        var cutoff = Date.now() - ((tfHours[timeframe] || 168) * 60 * 60 * 1000);
        var filtered = [];
        for (var f = 0; f < history.length; f++) {
            if (history[f].timestamp >= cutoff) filtered.push(history[f]);
        }
        if (filtered.length === 0) filtered = history.slice(-10);
        for (var j = 0; j < filtered.length; j++) {
            var fd = new Date(filtered[j].timestamp);
            labels.push((fd.getMonth() + 1) + '/' + fd.getDate() + ' ' + fd.getHours() + ':00');
            fastestData.push(filtered[j].fastest);
            halfHourData.push(filtered[j].halfHour);
            economyData.push(filtered[j].economy);
        }
    }

    if (fastestData.length === 0) return;

    // Update live value
    if (document.getElementById('feeValue')) {
        document.getElementById('feeValue').textContent = fastestData[fastestData.length - 1] + ' sat/vB';
    }
    document.getElementById('feeTitle').textContent = 'Fee Rate History (' + (feeTfLabels[timeframe] || timeframe.toUpperCase()) + ')';

    if (feeChartInstance) feeChartInstance.destroy();

    feeChartInstance = new Chart(document.getElementById('feeChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'High Priority (p90)',
                    data: fastestData,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    fill: '+1',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.2
                },
                {
                    label: 'Medium (p50)',
                    data: halfHourData,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    fill: '+1',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.2
                },
                {
                    label: 'Low Priority (p10)',
                    data: economyData,
                    borderColor: '#4ade80',
                    backgroundColor: 'rgba(74, 222, 128, 0.15)',
                    fill: 'origin',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.2
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
                        label: function(ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y + ' sat/vB'; }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#888', font: { size: 11 }, maxTicksLimit: 12, maxRotation: 45 },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#888',
                        font: { size: 11 },
                        callback: function(v) { return v + ' sat/vB'; }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.06)' }
                }
            }
        }
    });
}

document.getElementById('feeRange').addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var buttons = this.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.remove('active');
    btn.classList.add('active');
    loadFeeRateHistory(btn.getAttribute('data-tf'));
});

// PWA Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=41').catch(function() {});
}
