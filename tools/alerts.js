// ===== ION MINING GROUP — Alerts Module =====
// Slide-out sidebar with miner offline, hashrate drop, price, and difficulty alerts.
// Loaded on every page. Injects sidebar HTML, polls for changes, fires browser notifications.

// ===== CONSTANTS =====
var ALERTS_KEY = 'ionMiningAlerts';
var POLL_ACTIVE = 5 * 60 * 1000;   // 5 min when visible
var POLL_BG = 15 * 60 * 1000;      // 15 min when backgrounded
var MAX_ALERTS = 50;

// ===== STATE =====
var alertData = null;
var alertPoller = null;
var sidebarOpen = false;

// ===== LOAD / SAVE =====
function loadAlertData() {
    try {
        var raw = localStorage.getItem(ALERTS_KEY);
        if (raw) {
            alertData = JSON.parse(raw);
            if (!alertData.settings) alertData.settings = defaultSettings();
            if (!alertData.alerts) alertData.alerts = [];
            if (!alertData.previousState) alertData.previousState = {};
        }
    } catch (e) {}
    if (!alertData) {
        alertData = {
            _v: 1,
            settings: defaultSettings(),
            alerts: [],
            previousState: {},
            lastCheck: 0
        };
    }
}

function saveAlertData() {
    try {
        // Trim old alerts
        if (alertData.alerts.length > MAX_ALERTS) {
            alertData.alerts = alertData.alerts.slice(0, MAX_ALERTS);
        }
        localStorage.setItem(ALERTS_KEY, JSON.stringify(alertData));
    } catch (e) {}
}

function defaultSettings() {
    return {
        enabled: true,
        notificationsEnabled: false,
        minerOfflineEnabled: true,
        hashrateDropEnabled: true,
        hashrateDropThreshold: 15,
        priceAlertsEnabled: false,
        priceAlertHigh: 0,
        priceAlertLow: 0,
        difficultyAlertsEnabled: true,
        difficultyChangeThreshold: 3
    };
}

// ===== SIDEBAR HTML INJECTION =====
function injectAlertSidebar() {
    // Backdrop
    var backdrop = document.createElement('div');
    backdrop.id = 'alertBackdrop';
    backdrop.className = 'alert-backdrop';
    backdrop.addEventListener('click', closeAlertSidebar);
    document.body.appendChild(backdrop);

    // Sidebar
    var sidebar = document.createElement('div');
    sidebar.id = 'alertSidebar';
    sidebar.className = 'alert-sidebar';
    sidebar.innerHTML =
        '<div class="alert-sidebar-header">' +
            '<h3>Alerts</h3>' +
            '<div class="alert-sidebar-header-actions">' +
                '<button id="alertClearAll" class="alert-link-btn">Clear All</button>' +
                '<button id="alertClose" class="alert-close-btn">&times;</button>' +
            '</div>' +
        '</div>' +

        // Monitoring status
        '<div class="alert-monitor-bar" id="alertMonitorBar">' +
            '<div class="alert-pulse-dot"></div>' +
            '<span id="alertMonitorText">Monitoring active</span>' +
        '</div>' +

        // Active alerts container
        '<div id="alertList" class="alert-list"></div>' +

        // Settings (collapsible)
        '<div class="alert-settings-toggle">' +
            '<button id="alertSettingsBtn" class="alert-link-btn">Settings</button>' +
        '</div>' +
        '<div id="alertSettingsPanel" class="alert-settings-panel" style="display:none">' +
            // Miner Offline
            '<div class="alert-setting-row">' +
                '<label class="toggle-switch"><input type="checkbox" id="asMinorOffline"><span class="slider"></span></label>' +
                '<div class="alert-setting-info">' +
                    '<strong>Miner Offline</strong>' +
                    '<p>Alert when F2Pool worker goes offline</p>' +
                '</div>' +
            '</div>' +
            // Hashrate Drop
            '<div class="alert-setting-row">' +
                '<label class="toggle-switch"><input type="checkbox" id="asHashrateDrop"><span class="slider"></span></label>' +
                '<div class="alert-setting-info">' +
                    '<strong>Hashrate Drop</strong>' +
                    '<p>Alert when hashrate drops more than</p>' +
                    '<div class="alert-threshold-row">' +
                        '<input type="number" id="asHashrateThreshold" min="5" max="50" value="15" class="alert-threshold-input">' +
                        '<span>%</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            // Price Alert
            '<div class="alert-setting-row">' +
                '<label class="toggle-switch"><input type="checkbox" id="asPriceAlert"><span class="slider"></span></label>' +
                '<div class="alert-setting-info">' +
                    '<strong>Price Alert</strong>' +
                    '<p>Alert when BTC crosses thresholds</p>' +
                    '<div class="alert-threshold-row">' +
                        '<span>High $</span>' +
                        '<input type="number" id="asPriceHigh" min="0" step="1000" value="0" class="alert-threshold-input alert-threshold-wide">' +
                    '</div>' +
                    '<div class="alert-threshold-row">' +
                        '<span>Low $</span>' +
                        '<input type="number" id="asPriceLow" min="0" step="1000" value="0" class="alert-threshold-input alert-threshold-wide">' +
                    '</div>' +
                '</div>' +
            '</div>' +
            // Difficulty Change
            '<div class="alert-setting-row">' +
                '<label class="toggle-switch"><input type="checkbox" id="asDifficulty"><span class="slider"></span></label>' +
                '<div class="alert-setting-info">' +
                    '<strong>Difficulty Change</strong>' +
                    '<p>Alert when difficulty changes more than</p>' +
                    '<div class="alert-threshold-row">' +
                        '<input type="number" id="asDiffThreshold" min="1" max="20" value="3" class="alert-threshold-input">' +
                        '<span>%</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            // Browser Notifications
            '<div class="alert-setting-row">' +
                '<label class="toggle-switch"><input type="checkbox" id="asNotifications"><span class="slider"></span></label>' +
                '<div class="alert-setting-info">' +
                    '<strong>Browser Notifications</strong>' +
                    '<p>Show notifications when tab is in background</p>' +
                '</div>' +
            '</div>' +
        '</div>';

    document.body.appendChild(sidebar);

    // Event listeners
    document.getElementById('alertClose').addEventListener('click', closeAlertSidebar);
    document.getElementById('alertClearAll').addEventListener('click', clearAllAlerts);
    document.getElementById('alertSettingsBtn').addEventListener('click', function() {
        var panel = document.getElementById('alertSettingsPanel');
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });

    // Settings change listeners
    var settingInputs = ['asMinorOffline', 'asHashrateDrop', 'asPriceAlert', 'asDifficulty', 'asNotifications'];
    for (var i = 0; i < settingInputs.length; i++) {
        document.getElementById(settingInputs[i]).addEventListener('change', saveSettingsFromUI);
    }
    var thresholdInputs = ['asHashrateThreshold', 'asPriceHigh', 'asPriceLow', 'asDiffThreshold'];
    for (var j = 0; j < thresholdInputs.length; j++) {
        document.getElementById(thresholdInputs[j]).addEventListener('change', saveSettingsFromUI);
    }
}

// ===== SIDEBAR OPEN / CLOSE =====
function openAlertSidebar() {
    sidebarOpen = true;
    document.getElementById('alertSidebar').classList.add('open');
    document.getElementById('alertBackdrop').classList.add('open');
    document.body.style.overflow = 'hidden';
    markAllRead();
    renderAlertList();
    loadSettingsToUI();
}

function closeAlertSidebar() {
    sidebarOpen = false;
    document.getElementById('alertSidebar').classList.remove('open');
    document.getElementById('alertBackdrop').classList.remove('open');
    document.body.style.overflow = '';
}

// Expose globally for nav bell
window.toggleAlertSidebar = function() {
    if (sidebarOpen) closeAlertSidebar();
    else openAlertSidebar();
};

// ===== SETTINGS UI =====
function loadSettingsToUI() {
    var s = alertData.settings;
    document.getElementById('asMinorOffline').checked = s.minerOfflineEnabled;
    document.getElementById('asHashrateDrop').checked = s.hashrateDropEnabled;
    document.getElementById('asHashrateThreshold').value = s.hashrateDropThreshold;
    document.getElementById('asPriceAlert').checked = s.priceAlertsEnabled;
    document.getElementById('asPriceHigh').value = s.priceAlertHigh || '';
    document.getElementById('asPriceLow').value = s.priceAlertLow || '';
    document.getElementById('asDifficulty').checked = s.difficultyAlertsEnabled;
    document.getElementById('asDiffThreshold').value = s.difficultyChangeThreshold;
    document.getElementById('asNotifications').checked = s.notificationsEnabled;
}

function saveSettingsFromUI() {
    var s = alertData.settings;
    s.minerOfflineEnabled = document.getElementById('asMinorOffline').checked;
    s.hashrateDropEnabled = document.getElementById('asHashrateDrop').checked;
    s.hashrateDropThreshold = parseInt(document.getElementById('asHashrateThreshold').value) || 15;
    s.priceAlertsEnabled = document.getElementById('asPriceAlert').checked;
    s.priceAlertHigh = parseFloat(document.getElementById('asPriceHigh').value) || 0;
    s.priceAlertLow = parseFloat(document.getElementById('asPriceLow').value) || 0;
    s.difficultyAlertsEnabled = document.getElementById('asDifficulty').checked;
    s.difficultyChangeThreshold = parseInt(document.getElementById('asDiffThreshold').value) || 3;
    s.notificationsEnabled = document.getElementById('asNotifications').checked;

    // Request notification permission if enabling
    if (s.notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    saveAlertData();
}

// ===== RENDER ALERTS =====
function renderAlertList() {
    var container = document.getElementById('alertList');
    var active = [];
    for (var i = 0; i < alertData.alerts.length; i++) {
        if (!alertData.alerts[i].dismissed) active.push(alertData.alerts[i]);
    }

    if (active.length === 0) {
        container.innerHTML =
            '<div class="alert-empty">' +
                '<div class="alert-empty-icon">&#x2713;</div>' +
                '<p>All systems operational</p>' +
                '<div class="alert-empty-hint">Alerts will appear here when triggered</div>' +
            '</div>';
        return;
    }

    var html = '';
    for (var j = 0; j < active.length; j++) {
        var a = active[j];
        var icon = a.severity === 'high' ? '&#x26A0;' : a.severity === 'medium' ? '&#x26A1;' : '&#x2139;';
        var timeAgo = formatTimeAgo(a.timestamp);

        html +=
            '<div class="alert-card severity-' + a.severity + '">' +
                '<div class="alert-card-header">' +
                    '<span class="alert-card-icon">' + icon + '</span>' +
                    '<span class="alert-card-title">' + a.title + '</span>' +
                    '<span class="alert-card-time">' + timeAgo + '</span>' +
                    '<button class="alert-dismiss-btn" data-id="' + a.id + '">&times;</button>' +
                '</div>' +
                '<div class="alert-card-body">' + a.message + '</div>' +
            '</div>';
    }
    container.innerHTML = html;

    // Dismiss button listeners
    var dismissBtns = container.querySelectorAll('.alert-dismiss-btn');
    for (var k = 0; k < dismissBtns.length; k++) {
        dismissBtns[k].addEventListener('click', function() {
            dismissAlert(this.dataset.id);
        });
    }
}

function formatTimeAgo(ts) {
    var diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

// ===== ALERT MANAGEMENT =====
function createAlert(type, severity, title, message, details) {
    var alert = {
        id: 'alert_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: type,
        severity: severity,
        title: title,
        message: message,
        timestamp: Date.now(),
        dismissed: false,
        read: false,
        details: details || {}
    };

    // Don't duplicate recent alerts of same type+message (within 10 min)
    for (var i = 0; i < alertData.alerts.length; i++) {
        var existing = alertData.alerts[i];
        if (existing.type === type && existing.message === message && !existing.dismissed) {
            if (Date.now() - existing.timestamp < 10 * 60 * 1000) return;
        }
    }

    alertData.alerts.unshift(alert);
    saveAlertData();
    updateBadge();

    if (sidebarOpen) renderAlertList();

    // Browser notification
    sendBrowserNotification(alert);
}

function dismissAlert(id) {
    for (var i = 0; i < alertData.alerts.length; i++) {
        if (alertData.alerts[i].id === id) {
            alertData.alerts[i].dismissed = true;
            break;
        }
    }
    saveAlertData();
    updateBadge();
    if (sidebarOpen) renderAlertList();
}

function clearAllAlerts() {
    for (var i = 0; i < alertData.alerts.length; i++) {
        alertData.alerts[i].dismissed = true;
    }
    saveAlertData();
    updateBadge();
    if (sidebarOpen) renderAlertList();
}

function markAllRead() {
    for (var i = 0; i < alertData.alerts.length; i++) {
        alertData.alerts[i].read = true;
    }
    saveAlertData();
    updateBadge();
}

// ===== BADGE =====
function getUnreadCount() {
    var count = 0;
    for (var i = 0; i < alertData.alerts.length; i++) {
        if (!alertData.alerts[i].dismissed && !alertData.alerts[i].read) count++;
    }
    return count;
}

function updateBadge() {
    var badge = document.getElementById('alertBellBadge');
    if (!badge) return;
    var count = getUnreadCount();
    if (count > 0) {
        badge.textContent = count > 9 ? '9+' : count;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

// ===== BROWSER NOTIFICATIONS =====
function sendBrowserNotification(alert) {
    if (!alertData.settings.notificationsEnabled) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return; // Only notify when tab is backgrounded

    var n = new Notification(alert.title, {
        body: alert.message,
        tag: alert.type,
        requireInteraction: alert.severity === 'high'
    });

    n.onclick = function() {
        window.focus();
        openAlertSidebar();
        n.close();
    };
}

// ===== POLLING ENGINE =====
function startAlertPolling() {
    if (!alertData.settings.enabled) return;
    stopAlertPolling();

    var interval = document.hidden ? POLL_BG : POLL_ACTIVE;
    alertPoller = setInterval(runAlertChecks, interval);

    // Run first check after a short delay (let page finish loading)
    setTimeout(runAlertChecks, 5000);
}

function stopAlertPolling() {
    if (alertPoller) {
        clearInterval(alertPoller);
        alertPoller = null;
    }
}

// Adjust polling interval on visibility change
document.addEventListener('visibilitychange', function() {
    if (alertData && alertData.settings.enabled) {
        startAlertPolling();
    }
});

// ===== ALERT CHECKS =====
async function runAlertChecks() {
    var s = alertData.settings;

    // Check miners (offline + hashrate drop)
    if (s.minerOfflineEnabled || s.hashrateDropEnabled) {
        await checkMinerAlerts();
    }

    // Check price
    if (s.priceAlertsEnabled && (s.priceAlertHigh > 0 || s.priceAlertLow > 0)) {
        await checkPriceAlert();
    }

    // Check difficulty
    if (s.difficultyAlertsEnabled) {
        await checkDifficultyAlert();
    }

    alertData.lastCheck = Date.now();
    saveAlertData();
    updateMonitorStatus();
}

// --- Miner offline + hashrate drop ---
async function checkMinerAlerts() {
    var settings;
    try {
        settings = FleetData.getSettings();
    } catch (e) {
        return; // FleetData not loaded on this page
    }

    if (!settings.f2pool || !settings.f2pool.enabled) return;

    var url = settings.f2pool.workerUrl;
    var user = settings.f2pool.username;

    try {
        var res = await fetch(url + '/workers?user=' + encodeURIComponent(user));
        if (!res.ok) return;
        var data = await res.json();
        var workers = data.workers || data.data || [];
        var prev = alertData.previousState.workers || {};
        var current = {};

        for (var i = 0; i < workers.length; i++) {
            var w = workers[i];
            var name = w.worker_name || 'Worker ' + (i + 1);
            var status = (w.status === 'Online' || w.status === 'online') ? 'online' : 'offline';
            var hashrate = (w.hashrate || w.hashrate_current || 0) / 1e12;

            current[name] = { status: status, hashrate: hashrate };

            // Miner offline detection
            if (alertData.settings.minerOfflineEnabled && prev[name]) {
                if (prev[name].status === 'online' && status === 'offline') {
                    createAlert(
                        'miner_offline', 'high',
                        'Miner Offline',
                        name + ' went offline',
                        { worker: name }
                    );
                }
            }

            // Hashrate drop detection
            if (alertData.settings.hashrateDropEnabled && prev[name] && prev[name].hashrate > 0 && hashrate > 0) {
                var dropPct = ((prev[name].hashrate - hashrate) / prev[name].hashrate) * 100;
                if (dropPct >= alertData.settings.hashrateDropThreshold) {
                    createAlert(
                        'hashrate_drop', 'medium',
                        'Hashrate Drop',
                        name + ' dropped ' + dropPct.toFixed(0) + '% (' + prev[name].hashrate.toFixed(1) + ' → ' + hashrate.toFixed(1) + ' TH/s)',
                        { worker: name, from: prev[name].hashrate, to: hashrate }
                    );
                }
            }
        }

        alertData.previousState.workers = current;
    } catch (e) {}
}

// --- Price alert ---
async function checkPriceAlert() {
    try {
        var res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        if (!res.ok) return;
        var data = await res.json();
        var price = data.bitcoin && data.bitcoin.usd;
        if (!price || price <= 0) return;

        var prev = alertData.previousState.price || 0;
        var s = alertData.settings;

        // High threshold
        if (s.priceAlertHigh > 0 && price >= s.priceAlertHigh && prev < s.priceAlertHigh) {
            createAlert(
                'price_high', 'medium',
                'Price Alert — High',
                'BTC crossed above $' + s.priceAlertHigh.toLocaleString() + ' (now $' + price.toLocaleString() + ')',
                { price: price, threshold: s.priceAlertHigh }
            );
        }

        // Low threshold
        if (s.priceAlertLow > 0 && price <= s.priceAlertLow && prev > s.priceAlertLow) {
            createAlert(
                'price_low', 'medium',
                'Price Alert — Low',
                'BTC dropped below $' + s.priceAlertLow.toLocaleString() + ' (now $' + price.toLocaleString() + ')',
                { price: price, threshold: s.priceAlertLow }
            );
        }

        alertData.previousState.price = price;
    } catch (e) {}
}

// --- Difficulty change ---
async function checkDifficultyAlert() {
    try {
        var res = await fetch('https://mempool.space/api/v1/mining/hashrate/1d');
        if (!res.ok) return;
        var data = await res.json();
        var diffs = data.difficulty;
        if (!diffs || diffs.length === 0) return;
        var currentDiff = diffs[diffs.length - 1].difficulty / 1e12;

        var prev = alertData.previousState.difficulty || 0;
        if (prev > 0 && currentDiff > 0) {
            var changePct = Math.abs(((currentDiff - prev) / prev) * 100);
            if (changePct >= alertData.settings.difficultyChangeThreshold) {
                var direction = currentDiff > prev ? 'increased' : 'decreased';
                createAlert(
                    'difficulty_change', 'low',
                    'Difficulty Adjustment',
                    'Network difficulty ' + direction + ' by ' + changePct.toFixed(1) + '% (' + prev.toFixed(1) + 'T → ' + currentDiff.toFixed(1) + 'T)',
                    { from: prev, to: currentDiff }
                );
            }
        }

        alertData.previousState.difficulty = currentDiff;
    } catch (e) {}
}

// ===== MONITORING STATUS =====
function updateMonitorStatus() {
    var text = document.getElementById('alertMonitorText');
    if (!text) return;
    if (alertData.lastCheck) {
        text.textContent = 'Last check ' + formatTimeAgo(alertData.lastCheck);
    } else {
        text.textContent = 'Monitoring active';
    }
}

// ===== INIT =====
(function initAlerts() {
    loadAlertData();
    injectAlertSidebar();
    updateBadge();
    updateMonitorStatus();
    startAlertPolling();
})();
