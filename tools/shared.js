// ===== ION MINING GROUP — Shared Module =====

// --- Embed Mode Detection (for Workstation multi-pane) ---
window.ION_EMBED = (new URLSearchParams(window.location.search)).get('embed') === '1';
if (window.ION_EMBED) {
    document.documentElement.setAttribute('data-embed', '');
}

// --- Aggressive SW auto-update: check for new SW on every page load ---
(function() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then(function(reg) {
        // Force check for updated SW on every visit
        reg.update();
    });
    // When a new SW takes over, reload to get fresh assets
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (refreshing) return;
        refreshing = true;
        location.reload();
    });
})();

// --- Currency System ---
var CURRENCY_CONFIG = {
    usd: { symbol: '$', name: 'USD', decimals: 2 },
    eur: { symbol: '\u20ac', name: 'EUR', decimals: 2 },
    gbp: { symbol: '\u00a3', name: 'GBP', decimals: 2 },
    cad: { symbol: 'C$', name: 'CAD', decimals: 2 },
    aud: { symbol: 'A$', name: 'AUD', decimals: 2 },
    jpy: { symbol: '\u00a5', name: 'JPY', decimals: 0 }
};
window.selectedCurrency = localStorage.getItem('ionMiningCurrency') || 'usd';
window.liveBtcPrices = {};
window.onCurrencyChange = null;

// --- Nav Sparkline State ---
window.ionNavPriceHistory = [];
var NAV_SPARKLINE_MAX_POINTS = 24;
var NAV_SPARKLINE_POLL_MS = 45000;
var _navSparklineInterval = null;

function getCurrencySymbol() {
    var c = CURRENCY_CONFIG[window.selectedCurrency];
    return c ? c.symbol : '$';
}
function getCurrencyDecimals() {
    var c = CURRENCY_CONFIG[window.selectedCurrency];
    return (c && c.decimals !== undefined) ? c.decimals : 2;
}
function getCurrencyMultiplier() {
    if (window.selectedCurrency === 'usd' || !window.liveBtcPrices || !window.liveBtcPrices.usd) return 1;
    var target = window.liveBtcPrices[window.selectedCurrency];
    return target ? target / window.liveBtcPrices.usd : 1;
}
function switchCurrency(code) {
    if (!CURRENCY_CONFIG[code]) return;
    window.selectedCurrency = code;
    localStorage.setItem('ionMiningCurrency', code);
    if (typeof SyncEngine !== 'undefined') SyncEngine.save('currency', code);
    if (window.liveBtcPrices[code]) {
        window.liveBtcPrice = window.liveBtcPrices[code];
    }
    // Re-seed sparkline with 24h history for new currency
    window.ionNavPriceHistory = [];
    if (typeof seedNavSparkline === 'function') seedNavSparkline();
    if (typeof window.onCurrencyChange === 'function') window.onCurrencyChange();
}

// --- Nav Renderer ---
function initNav(activePage) {
    const nav = document.getElementById('ion-nav');
    if (!nav) return;
    if (window.ION_EMBED) { nav.style.display = 'none'; return; }
    nav.className = 'ion-nav';
    var mobile = window.innerWidth < 600;
    var labels = mobile ? ['Data', 'Calc', 'Bank', 'Home', 'Map'] : ['Data', 'Calculator', 'Banking', 'Dashboard', 'Map'];
    nav.innerHTML =
        '<a class="ion-nav-brand" href="./index.html">' +
            '<span class="icon"><svg width="24" height="24" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="8" fill="#f7931a"/><ellipse cx="50" cy="50" rx="38" ry="14" stroke="#f7931a" stroke-width="3"/><ellipse cx="50" cy="50" rx="38" ry="14" stroke="#f7931a" stroke-width="3" transform="rotate(60 50 50)"/><ellipse cx="50" cy="50" rx="38" ry="14" stroke="#f7931a" stroke-width="3" transform="rotate(120 50 50)"/></svg></span>' +
            '<span class="name">Ion Mining Group</span>' +
        '</a>' +
        '<div class="ion-nav-tabs">' +
            '<a href="./charts.html" class="' + (activePage === 'charts' ? 'active' : '') + '">' + labels[0] + '</a>' +
            '<a href="./calculator.html" class="' + (activePage === 'calculator' ? 'active' : '') + '">' + labels[1] + '</a>' +
            '<a href="./banking.html" class="' + (activePage === 'banking' ? 'active' : '') + '">' + labels[2] + '</a>' +
            '<a href="./index.html" class="' + (activePage === 'dashboard' ? 'active' : '') + '">' + labels[3] + '</a>' +
            '<a href="./map.html" class="' + (activePage === 'map' ? 'active' : '') + '">' + labels[4] + '</a>' +
        '</div>' +
        '<div class="ion-nav-actions">' +
            '<a href="./charts.html" class="ion-nav-sparkline" id="navSparkline"><canvas id="navSparklineCanvas" width="70" height="24"></canvas><span class="ion-nav-sparkline-price" id="navSparklinePrice">--</span></a>' +
            (!mobile ? '<a href="./workstation.html" class="ion-nav-ws-link" title="Workstation (multi-pane view)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="3" x2="8" y2="17"/><line x1="16" y1="3" x2="16" y2="17"/><line x1="2" y1="21" x2="22" y2="21"/></svg></a>' : '') +
            '<select class="ion-currency-select" id="currencySelect">' +
                (function() {
                    var opts = '';
                    for (var k in CURRENCY_CONFIG) {
                        opts += '<option value="' + k + '"' + (k === window.selectedCurrency ? ' selected' : '') + '>' + CURRENCY_CONFIG[k].name + '</option>';
                    }
                    return opts;
                })() +
            '</select>' +
            '<button class="ion-theme-toggle" id="themeToggle" title="Toggle light/dark theme">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' +
            '</button>' +
            '<button class="ion-nav-bell" onclick="window.toggleAlertSidebar && window.toggleAlertSidebar()">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
                '<span class="ion-nav-bell-badge" id="alertBellBadge" style="display:none">0</span>' +
            '</button>' +
            '<button class="ion-nav-sync-btn" id="syncBtn" title="Sign in to sync across devices">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
            '</button>' +
        '</div>';
    var sel = document.getElementById('currencySelect');
    if (sel) sel.addEventListener('change', function() { switchCurrency(this.value); });

    // --- Theme Toggle ---
    var THEME_KEY = 'ionMiningTheme';
    var sunSVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    var moonSVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        var btn = document.getElementById('themeToggle');
        if (btn) btn.innerHTML = (theme === 'light') ? moonSVG : sunSVG;
    }

    var savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(savedTheme);

    var themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', function() {
            var current = document.documentElement.dataset.theme || 'dark';
            var next = (current === 'dark') ? 'light' : 'dark';
            applyTheme(next);
            localStorage.setItem(THEME_KEY, next);
            if (typeof SyncEngine !== 'undefined') SyncEngine.save('theme', next);
        });
    }

    // Auth button handler
    var syncBtn = document.getElementById('syncBtn');
    var _wasSignedIn = false;
    if (syncBtn && typeof IonAuth !== 'undefined') {
        IonAuth.onAuthChange(function(user) {
            if (user) {
                _wasSignedIn = true;
                var initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();
                syncBtn.innerHTML = '<span class="ion-nav-avatar">' + initial + '</span>';
                syncBtn.title = 'Signed in as ' + (user.displayName || user.email) + ' — click to sign out';
                syncBtn.className = 'ion-nav-sync-btn signed-in';
                // Start listening for remote changes
                Object.keys(SyncEngine.SYNC_KEYS).forEach(function(key) {
                    SyncEngine.listen(key, function() {
                        // Call page-specific refresh handler if registered
                        if (key === 'wallet' && typeof window.ionWalletSyncRefresh === 'function') {
                            window.ionWalletSyncRefresh();
                            return;
                        }
                        // Show a subtle sync toast — no auto-reload
                        var existing = document.getElementById('syncToast');
                        if (existing) return; // already showing
                        var toast = document.createElement('div');
                        toast.id = 'syncToast';
                        toast.className = 'sync-toast';
                        toast.innerHTML = 'Data synced from another device <button onclick="location.reload()">Refresh</button>';
                        document.body.appendChild(toast);
                        setTimeout(function() { toast.classList.add('show'); }, 10);
                        setTimeout(function() {
                            toast.classList.remove('show');
                            setTimeout(function() { toast.remove(); }, 300);
                        }, 8000);
                    });
                });
            } else {
                syncBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
                syncBtn.title = 'Sign in to sync across devices';
                syncBtn.className = 'ion-nav-sync-btn';
                SyncEngine.stopAll();
                if (_wasSignedIn) {
                    _wasSignedIn = false;
                    var preserve = ['sw_clean_v134', 'ionMiningOnboarded', 'ionMiningStep'];
                    var saved = {};
                    for (var i = 0; i < preserve.length; i++) {
                        var val = localStorage.getItem(preserve[i]);
                        if (val !== null) saved[preserve[i]] = val;
                    }
                    localStorage.clear();
                    for (var key in saved) {
                        localStorage.setItem(key, saved[key]);
                    }
                    location.reload();
                }
            }
        });

        // Post-auth handler — called after sign-in from any method
        window.handlePostAuth = function() {
            SyncEngine.pullAll(function(pulled) {
                if (pulled > 0) {
                    location.reload();
                } else {
                    SyncEngine.pushAll();
                }
            });
        };

        syncBtn.addEventListener('click', function() {
            if (IonAuth.isSignedIn()) {
                if (typeof IonProfile !== 'undefined') {
                    IonProfile.show();
                } else {
                    if (confirm('Sign out of sync? Your data stays on this device.')) {
                        SyncEngine.stopAll();
                        IonAuth.signOut();
                    }
                }
            } else {
                if (typeof IonAuthUI !== 'undefined') {
                    IonAuthUI.show('signin');
                } else {
                    IonAuth.signIn().then(function() {
                        window.handlePostAuth();
                    }).catch(function(err) {
                        if (err.code !== 'auth/popup-closed-by-user') {
                            console.warn('[Auth] Sign-in failed:', err.message);
                        }
                    });
                }
            }
        });
    }

    // Start live sparkline in nav (desktop only)
    startNavSparkline();
}

// --- Nav Sparkline Functions ---
function renderNavSparkline() {
    var canvas = document.getElementById('navSparklineCanvas');
    var priceEl = document.getElementById('navSparklinePrice');
    if (!canvas || !priceEl) return;

    var history = window.ionNavPriceHistory;
    if (!history || history.length === 0) return;

    var last = history[history.length - 1].price;

    // Update price text
    priceEl.textContent = getCurrencySymbol() + Math.round(last).toLocaleString();

    if (history.length < 2) {
        priceEl.style.color = '#f7931a';
        return;
    }

    var first = history[0].price;
    var isUp = last >= first;
    var lineColor = isUp ? '#4ade80' : '#ef4444';
    priceEl.style.color = lineColor;

    // HiDPI scaling
    var dpr = window.devicePixelRatio || 1;
    var w = 70, h = 24;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    var prices = history.map(function(p) { return p.price; });
    var min = Math.min.apply(null, prices);
    var max = Math.max.apply(null, prices);
    var range = max - min || 1;
    var pad = 2;

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (var i = 0; i < prices.length; i++) {
        var x = pad + (i / (prices.length - 1)) * (w - pad * 2);
        var y = h - pad - ((prices[i] - min) / range) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under line
    ctx.lineTo(pad + (w - pad * 2), h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    var fillTop = isUp ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)';
    var fillBot = isUp ? 'rgba(74,222,128,0)' : 'rgba(239,68,68,0)';
    grad.addColorStop(0, fillTop);
    grad.addColorStop(1, fillBot);
    ctx.fillStyle = grad;
    ctx.fill();
}

function updateNavSparklinePrice() {
    var currencies = Object.keys(CURRENCY_CONFIG).join(',');
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=' + currencies)
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!data || !data.bitcoin) return;
            var btc = data.bitcoin;
            for (var cur in CURRENCY_CONFIG) {
                if (btc[cur] && btc[cur] > 0) window.liveBtcPrices[cur] = Math.round(btc[cur]);
            }
            window.liveBtcPrice = window.liveBtcPrices[window.selectedCurrency];
            var price = window.liveBtcPrice;
            if (!price) return;

            window.ionNavPriceHistory.push({ time: Date.now(), price: price });
            while (window.ionNavPriceHistory.length > NAV_SPARKLINE_MAX_POINTS) {
                window.ionNavPriceHistory.shift();
            }
            renderNavSparkline();
        })
        .catch(function() {});
}

function seedNavSparkline() {
    var cur = window.selectedCurrency || 'usd';
    fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=' + cur + '&days=1')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!data || !data.prices || data.prices.length === 0) return;
            var prices = data.prices;
            // Sample evenly to get NAV_SPARKLINE_MAX_POINTS
            var step = Math.max(1, Math.floor(prices.length / NAV_SPARKLINE_MAX_POINTS));
            window.ionNavPriceHistory = [];
            for (var i = 0; i < prices.length; i += step) {
                window.ionNavPriceHistory.push({ time: prices[i][0], price: Math.round(prices[i][1]) });
            }
            // Ensure last point is the most recent
            var last = prices[prices.length - 1];
            var lastEntry = window.ionNavPriceHistory[window.ionNavPriceHistory.length - 1];
            if (lastEntry.time !== last[0]) {
                window.ionNavPriceHistory.push({ time: last[0], price: Math.round(last[1]) });
            }
            while (window.ionNavPriceHistory.length > NAV_SPARKLINE_MAX_POINTS) {
                window.ionNavPriceHistory.shift();
            }
            // Update global price
            window.liveBtcPrice = Math.round(last[1]);
            window.liveBtcPrices[cur] = window.liveBtcPrice;
            renderNavSparkline();
        })
        .catch(function() {
            // Fallback: just fetch current price
            updateNavSparklinePrice();
        });
}

function startNavSparkline() {
    if (window.ION_EMBED) return;
    // Mobile sparkline is now enabled — no width check needed

    // Seed with 24h history for immediate chart
    seedNavSparkline();

    if (_navSparklineInterval) clearInterval(_navSparklineInterval);
    _navSparklineInterval = setInterval(updateNavSparklinePrice, NAV_SPARKLINE_POLL_MS);
}

// --- Swipe / Slide Page Navigation ---
(function() {
    if (window.ION_EMBED) return;
    var pages = ['charts.html', 'calculator.html', 'banking.html', 'index.html', 'map.html'];
    var current = pages.indexOf(location.pathname.split('/').pop());
    if (current === -1) current = 0;

    var startX = 0, startY = 0;
    var THRESHOLD = 30;
    var ignore = 'INPUT,BUTTON,CANVAS,SELECT,TEXTAREA,A';

    function shouldIgnore(el) {
        while (el && el !== document.body) {
            if (ignore.indexOf(el.tagName) !== -1) return true;
            if (el.id === 'fleetMap') return true;
            if (el.classList && el.classList.contains('earnings-chart-container')) return true;
            if (el.classList && el.classList.contains('combo-chart-container')) return true;
            if (el.classList && el.classList.contains('metric-card')) return true;
            if (el.classList && el.classList.contains('miner-card')) return true;
            if (el.classList && el.classList.contains('card')) return true;
            if (el.classList && el.classList.contains('slide-panel')) return true;
            if (el.classList && el.classList.contains('table-scroll')) return true;
            if (el.classList && el.classList.contains('time-range-selector')) return true;
            if (el.classList && el.classList.contains('delete-dialog-overlay')) return true;
            if (el.classList && el.classList.contains('fleet-toggle-row')) return true;
            if (el.classList && el.classList.contains('reinvest-row')) return true;
            if (el.classList && el.classList.contains('hodl-row')) return true;
            if (el.classList && el.classList.contains('inputs-grid')) return true;
            if (el.classList && el.classList.contains('mock-banner')) return true;
            if (el.classList && el.classList.contains('halving-progress-bar')) return true;
            if (el.type === 'range') return true;
            el = el.parentElement;
        }
        return false;
    }

    function navigate(dx, dy) {
        if (Math.abs(dx) < THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;
        if (dx > 0 && current < pages.length - 1) location.href = './' + pages[current + 1];
        if (dx < 0 && current > 0) location.href = './' + pages[current - 1];
    }

    // Touch only (mobile) — skip charts and interactive elements
    document.addEventListener('touchstart', function(e) {
        if (shouldIgnore(e.target)) { startX = 0; return; }
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
        if (!startX) return;
        var endX = e.changedTouches[0].clientX;
        var endY = e.changedTouches[0].clientY;
        navigate(startX - endX, startY - endY);
        startX = 0;
    }, { passive: true });
})();

// --- Format Helpers (currency-aware) ---
function fmtUSD(v) {
    if (!isFinite(v)) return 'N/A';
    var sym = getCurrencySymbol();
    var dec = getCurrencyDecimals();
    var neg = v < 0;
    var abs = Math.abs(v);
    var str;
    if (abs >= 1e6) str = sym + (abs / 1e6).toFixed(dec > 0 ? 2 : 0) + 'M';
    else if (abs >= 1e4 || dec === 0) str = sym + abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    else str = sym + abs.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return neg ? '-' + str : str;
}

function fmtBTC(v, decimals) {
    if (!isFinite(v)) return 'N/A';
    var d = decimals !== undefined ? decimals : 6;
    return v.toFixed(d);
}

function fmtUSDFull(v) {
    if (!isFinite(v)) return 'N/A';
    var sym = getCurrencySymbol();
    var dec = getCurrencyDecimals();
    var neg = v < 0;
    var str = sym + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return neg ? '-' + str : str;
}

// --- Live Market Data (multi-currency) ---
async function fetchLiveMarketData() {
    var result = { price: null, prices: {}, difficulty: null };

    // Fetch BTC prices in all supported currencies
    try {
        var priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur,gbp,cad,aud,jpy');
        if (priceRes.ok) {
            var priceData = await priceRes.json();
            var btc = priceData && priceData.bitcoin;
            if (btc) {
                for (var cur in CURRENCY_CONFIG) {
                    if (btc[cur] && btc[cur] > 0) result.prices[cur] = Math.round(btc[cur]);
                }
                result.price = result.prices[window.selectedCurrency] || result.prices.usd || null;
            }
        }
    } catch (e) {}

    // Fallback: CryptoCompare (USD only)
    if (!result.price) {
        try {
            var fallbackRes = await fetch('https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD');
            if (fallbackRes.ok) {
                var fallbackData = await fallbackRes.json();
                if (fallbackData && fallbackData.USD > 0) {
                    result.prices.usd = Math.round(fallbackData.USD);
                    result.price = result.prices.usd;
                }
            }
        } catch (e) {}
    }

    window.liveBtcPrices = result.prices;

    // Fetch network difficulty
    try {
        var diffRes = await fetch('https://mempool.space/api/v1/mining/hashrate/1d');
        if (diffRes.ok) {
            var diffData = await diffRes.json();
            var diffs = diffData?.difficulty;
            if (diffs && diffs.length > 0) {
                var latestDiff = diffs[diffs.length - 1].difficulty;
                if (latestDiff > 0) result.difficulty = parseFloat((latestDiff / 1e12).toFixed(2));
            }
        }
    } catch (e) {}

    return result;
}

// ===== TECH LINES BACKGROUND =====
(function() {
    var canvas = document.getElementById('techLinesCanvas');
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var ctx = canvas.getContext('2d');
    var lines = [];
    var nodes = [];
    var pulses = [];
    var hexSheets = [];
    var animId = null;
    var lastFrame = 0;
    var isMobile = Math.min(window.innerWidth, window.innerHeight) < 768;
    var FRAME_INTERVAL = isMobile ? 40 : 25;
    var LINE_COUNT = isMobile ? 25 : 45;
    var NODE_COUNT = isMobile ? 15 : 30;
    var PULSE_COUNT = isMobile ? 6 : 12;
    var HEX_FONT_SIZE = isMobile ? 10 : 11;
    var HEX_LINE_HEIGHT = isMobile ? 14 : 15;
    var HEX_CHAR_WIDTH = isMobile ? 6.6 : 7.3;
    var HEX_SHEET_COUNT = 3;

    // Actual Bitcoin genesis block raw hex (block header + coinbase tx) — repeated for density
    var GENESIS_HEX = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a0100000043410467e6e18906b18c1a10c82c3017656397f490eee7abcb2e24079cd82afa96d38';

    function resize() {
        var dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        generate();
    }

    function generate() {
        lines = [];
        nodes = [];
        pulses = [];
        var w = window.innerWidth;
        var h = window.innerHeight;

        // Generate full-screen hex sheets — dense scrolling block data
        hexSheets = [];
        var charsPerRow = Math.ceil(w / HEX_CHAR_WIDTH) + 4;
        var rowsNeeded = Math.ceil(h / HEX_LINE_HEIGHT) + 4;
        var totalRows = rowsNeeded * 2; // double height for seamless scrolling

        for (var s = 0; s < HEX_SHEET_COUNT; s++) {
            var rows = [];
            var hexPos = Math.floor(Math.random() * GENESIS_HEX.length);
            for (var r = 0; r < totalRows; r++) {
                var row = '';
                for (var ch = 0; ch < charsPerRow; ch++) {
                    row += GENESIS_HEX[hexPos % GENESIS_HEX.length];
                    hexPos++;
                    // Add space every 2 chars for hex-dump look
                    if ((ch + 1) % 2 === 0 && ch < charsPerRow - 1) row += ' ';
                }
                rows.push(row);
            }
            hexSheets.push({
                rows: rows,
                totalRows: totalRows,
                visibleRows: rowsNeeded,
                scrollY: Math.random() * totalRows * HEX_LINE_HEIGHT,
                speed: 8 + s * 12,
                opacity: 0.01 + s * 0.006
            });
        }

        // Generate grid lines — horizontal and vertical
        for (var i = 0; i < LINE_COUNT; i++) {
            var isHorizontal = Math.random() > 0.45;
            var pos = Math.random() * (isHorizontal ? h : w);
            var startPct = Math.random() * 0.2;
            var endPct = 0.4 + Math.random() * 0.6;
            lines.push({
                horizontal: isHorizontal,
                pos: pos,
                start: startPct,
                end: endPct,
                phase: Math.random() * Math.PI * 2,
                speed: 0.2 + Math.random() * 0.6,
                maxOpacity: 0.04 + Math.random() * 0.06,
                width: Math.random() > 0.7 ? 2 : 1,
                glow: Math.random() > 0.6
            });
        }

        // Generate connection nodes at random positions
        for (var n = 0; n < NODE_COUNT; n++) {
            nodes.push({
                x: Math.random() * w,
                y: Math.random() * h,
                radius: 1.5 + Math.random() * 2.5,
                phase: Math.random() * Math.PI * 2,
                speed: 0.3 + Math.random() * 0.8,
                maxOpacity: 0.05 + Math.random() * 0.1,
                ring: Math.random() > 0.5
            });
        }

        // Generate traveling pulses along some lines
        for (var p = 0; p < PULSE_COUNT; p++) {
            var lineIdx = Math.floor(Math.random() * lines.length);
            pulses.push({
                lineIdx: lineIdx,
                progress: Math.random(),
                speed: 0.08 + Math.random() * 0.15,
                size: 3 + Math.random() * 4,
                maxOpacity: 0.15 + Math.random() * 0.2
            });
        }
    }

    function draw(timestamp) {
        animId = requestAnimationFrame(draw);
        if (timestamp - lastFrame < FRAME_INTERVAL) return;
        lastFrame = timestamp;
        if (document.hidden) return;

        var w = window.innerWidth;
        var h = window.innerHeight;
        var t = timestamp / 1000;
        var dt = FRAME_INTERVAL / 1000;

        ctx.clearRect(0, 0, w, h);

        // Draw dense genesis block hex sheets (behind everything)
        ctx.font = HEX_FONT_SIZE + 'px monospace';
        ctx.textAlign = 'left';
        for (var s = 0; s < hexSheets.length; s++) {
            var S = hexSheets[s];
            S.scrollY -= S.speed * dt;
            var sheetHeight = S.totalRows * HEX_LINE_HEIGHT;
            if (S.scrollY < 0) S.scrollY += sheetHeight / 2;

            ctx.fillStyle = 'rgba(247, 147, 26, ' + S.opacity.toFixed(4) + ')';
            var startRow = Math.floor(S.scrollY / HEX_LINE_HEIGHT);
            var offsetY = -(S.scrollY % HEX_LINE_HEIGHT);

            for (var r = 0; r <= S.visibleRows; r++) {
                var rowIdx = (startRow + r) % S.totalRows;
                var y = offsetY + r * HEX_LINE_HEIGHT;
                if (y < -HEX_LINE_HEIGHT || y > h + HEX_LINE_HEIGHT) continue;
                ctx.fillText(S.rows[rowIdx], 0, y);
            }
        }

        // Draw lines with glow
        for (var i = 0; i < lines.length; i++) {
            var L = lines[i];
            var opacity = L.maxOpacity * (0.3 + 0.7 * Math.sin(t * L.speed + L.phase));
            if (opacity < 0.01) continue;

            // Glow pass
            if (L.glow && opacity > 0.04) {
                ctx.strokeStyle = 'rgba(247, 147, 26, ' + (opacity * 0.3).toFixed(4) + ')';
                ctx.lineWidth = L.width + 4;
                ctx.beginPath();
                if (L.horizontal) {
                    ctx.moveTo(L.start * w, L.pos);
                    ctx.lineTo(L.end * w, L.pos);
                } else {
                    ctx.moveTo(L.pos, L.start * h);
                    ctx.lineTo(L.pos, L.end * h);
                }
                ctx.stroke();
            }

            // Main line
            ctx.strokeStyle = 'rgba(247, 147, 26, ' + opacity.toFixed(4) + ')';
            ctx.lineWidth = L.width;
            ctx.beginPath();
            if (L.horizontal) {
                ctx.moveTo(L.start * w, L.pos);
                ctx.lineTo(L.end * w, L.pos);
            } else {
                ctx.moveTo(L.pos, L.start * h);
                ctx.lineTo(L.pos, L.end * h);
            }
            ctx.stroke();
        }

        // Draw nodes (connection dots)
        for (var n = 0; n < nodes.length; n++) {
            var N = nodes[n];
            var nOpacity = N.maxOpacity * (0.3 + 0.7 * Math.sin(t * N.speed + N.phase));
            if (nOpacity < 0.02) continue;

            // Outer ring
            if (N.ring) {
                ctx.strokeStyle = 'rgba(247, 147, 26, ' + (nOpacity * 0.4).toFixed(4) + ')';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(N.x, N.y, N.radius + 3, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Filled dot
            ctx.fillStyle = 'rgba(247, 147, 26, ' + nOpacity.toFixed(4) + ')';
            ctx.beginPath();
            ctx.arc(N.x, N.y, N.radius, 0, Math.PI * 2);
            ctx.fill();

            // Glow
            if (nOpacity > 0.1) {
                ctx.fillStyle = 'rgba(247, 147, 26, ' + (nOpacity * 0.15).toFixed(4) + ')';
                ctx.beginPath();
                ctx.arc(N.x, N.y, N.radius + 6, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Draw traveling pulses
        for (var p = 0; p < pulses.length; p++) {
            var P = pulses[p];
            P.progress += P.speed * dt;
            if (P.progress > 1) P.progress -= 1;

            var line = lines[P.lineIdx];
            if (!line) continue;

            var px, py;
            if (line.horizontal) {
                px = (line.start + (line.end - line.start) * P.progress) * w;
                py = line.pos;
            } else {
                px = line.pos;
                py = (line.start + (line.end - line.start) * P.progress) * h;
            }

            // Bright pulse dot
            ctx.fillStyle = 'rgba(247, 147, 26, ' + P.maxOpacity.toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(px, py, P.size * 0.4, 0, Math.PI * 2);
            ctx.fill();

            // Pulse glow
            ctx.fillStyle = 'rgba(247, 147, 26, ' + (P.maxOpacity * 0.2).toFixed(4) + ')';
            ctx.beginPath();
            ctx.arc(px, py, P.size, 0, Math.PI * 2);
            ctx.fill();

            // Large soft glow
            ctx.fillStyle = 'rgba(247, 147, 26, ' + (P.maxOpacity * 0.06).toFixed(4) + ')';
            ctx.beginPath();
            ctx.arc(px, py, P.size * 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    var resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            isMobile = Math.min(window.innerWidth, window.innerHeight) < 768;
            FRAME_INTERVAL = isMobile ? 40 : 25;
            LINE_COUNT = isMobile ? 25 : 45;
            NODE_COUNT = isMobile ? 15 : 30;
            PULSE_COUNT = isMobile ? 6 : 12;
            HEX_FONT_SIZE = isMobile ? 10 : 11;
            HEX_LINE_HEIGHT = isMobile ? 14 : 15;
            HEX_CHAR_WIDTH = isMobile ? 6.6 : 7.3;
            HEX_SHEET_COUNT = 3;
            resize();
        }, 200);
    });

    document.addEventListener('visibilitychange', function() {
        if (!document.hidden && !animId) {
            animId = requestAnimationFrame(draw);
        }
    });

    resize();
    animId = requestAnimationFrame(draw);
})();

// ===== WORKSTATION EMBED: postMessage listener for theme/currency sync =====
if (window.ION_EMBED) {
    window.addEventListener('message', function(e) {
        if (!e.data || !e.data.ionMining) return;
        if (e.data.type === 'themeChange') {
            document.documentElement.dataset.theme = e.data.value || 'dark';
            localStorage.setItem('ionMiningTheme', e.data.value);
        }
        if (e.data.type === 'currencyChange' && typeof switchCurrency === 'function') {
            switchCurrency(e.data.value);
        }
    });
}
