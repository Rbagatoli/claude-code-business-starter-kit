// ===== ION MINING GROUP — Shared Module =====

// --- One-time SW cleanup (removes old cached service workers) ---
(function() {
    if (localStorage.getItem('sw_clean_v45')) return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistrations().then(function(regs) {
        var promises = regs.map(function(r) { return r.unregister(); });
        promises.push(caches.keys().then(function(keys) {
            return Promise.all(keys.map(function(k) { return caches.delete(k); }));
        }));
        Promise.all(promises).then(function() {
            localStorage.setItem('sw_clean_v45', '1');
            location.reload();
        });
    });
})();

// --- Nav Renderer ---
function initNav(activePage) {
    const nav = document.getElementById('ion-nav');
    if (!nav) return;
    nav.className = 'ion-nav';
    var mobile = window.innerWidth < 600;
    var labels = mobile ? ['Calc', 'Home', 'Data', 'Pay', 'Wallet'] : ['Calculator', 'Dashboard', 'Data', 'Payouts', 'Wallet'];
    nav.innerHTML =
        '<a class="ion-nav-brand" href="./index.html">' +
            '<span class="icon"><svg width="24" height="24" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="8" fill="#f7931a"/><ellipse cx="50" cy="50" rx="38" ry="14" stroke="#f7931a" stroke-width="3"/><ellipse cx="50" cy="50" rx="38" ry="14" stroke="#f7931a" stroke-width="3" transform="rotate(60 50 50)"/><ellipse cx="50" cy="50" rx="38" ry="14" stroke="#f7931a" stroke-width="3" transform="rotate(120 50 50)"/></svg></span>' +
            '<span class="name">Ion Mining Group</span>' +
        '</a>' +
        '<div class="ion-nav-tabs">' +
            '<a href="./calculator.html" class="' + (activePage === 'calculator' ? 'active' : '') + '">' + labels[0] + '</a>' +
            '<a href="./index.html" class="' + (activePage === 'dashboard' ? 'active' : '') + '">' + labels[1] + '</a>' +
            '<a href="./charts.html" class="' + (activePage === 'charts' ? 'active' : '') + '">' + labels[2] + '</a>' +
            '<a href="./payouts.html" class="' + (activePage === 'payouts' ? 'active' : '') + '">' + labels[3] + '</a>' +
            '<a href="./wallet.html" class="' + (activePage === 'wallet' ? 'active' : '') + '">' + labels[4] + '</a>' +
        '</div>' +
        '<button class="ion-nav-bell" onclick="window.toggleAlertSidebar && window.toggleAlertSidebar()">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
            '<span class="ion-nav-bell-badge" id="alertBellBadge" style="display:none">0</span>' +
        '</button>';
}

// --- Swipe / Slide Page Navigation ---
(function() {
    var pages = ['calculator.html', 'index.html', 'charts.html', 'payouts.html', 'wallet.html'];
    var current = pages.indexOf(location.pathname.split('/').pop());
    if (current === -1) current = 0;

    var startX = 0, startY = 0;
    var THRESHOLD = 30;
    var ignore = 'INPUT,BUTTON,CANVAS,SELECT,TEXTAREA,A';

    function shouldIgnore(el) {
        while (el && el !== document.body) {
            if (ignore.indexOf(el.tagName) !== -1) return true;
            if (el.classList && el.classList.contains('earnings-chart-container')) return true;
            if (el.classList && el.classList.contains('metric-card')) return true;
            if (el.classList && el.classList.contains('miner-card')) return true;
            if (el.classList && el.classList.contains('slide-panel')) return true;
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

// --- Format Helpers ---
function fmtUSD(v) {
    if (!isFinite(v)) return 'N/A';
    var neg = v < 0;
    var abs = Math.abs(v);
    var str;
    if (abs >= 1e6) str = '$' + (abs / 1e6).toFixed(2) + 'M';
    else if (abs >= 1e4) str = '$' + abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    else str = '$' + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return neg ? '-' + str : str;
}

function fmtBTC(v, decimals) {
    if (!isFinite(v)) return 'N/A';
    var d = decimals !== undefined ? decimals : 6;
    return v.toFixed(d);
}

function fmtUSDFull(v) {
    if (!isFinite(v)) return 'N/A';
    var neg = v < 0;
    var str = '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return neg ? '-' + str : str;
}

// --- Live Market Data ---
async function fetchLiveMarketData() {
    var result = { price: null, difficulty: null };

    // Fetch BTC price — try CoinGecko first, fall back to CryptoCompare
    try {
        var priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        if (priceRes.ok) {
            var priceData = await priceRes.json();
            var price = priceData?.bitcoin?.usd;
            if (price && price > 0) result.price = Math.round(price);
        }
    } catch (e) {}

    if (!result.price) {
        try {
            var fallbackRes = await fetch('https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD');
            if (fallbackRes.ok) {
                var fallbackData = await fallbackRes.json();
                if (fallbackData?.USD > 0) result.price = Math.round(fallbackData.USD);
            }
        } catch (e) {}
    }

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
                opacity: 0.02 + s * 0.012
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
                maxOpacity: 0.08 + Math.random() * 0.12,
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
                maxOpacity: 0.1 + Math.random() * 0.2,
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
                maxOpacity: 0.3 + Math.random() * 0.4
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
