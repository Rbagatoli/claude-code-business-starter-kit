// ===== ION MINING GROUP — Widget Settings =====
// Show/hide and drag-to-reorder page sections (all pages).
// Storage: ionMiningWidgets_<page> in localStorage (per-page).

(function initWidgets() {

    // Detect page from filename
    var path = window.location.pathname.split('/').pop() || 'index.html';
    var page = path.replace('.html', '') || 'index';
    var WIDGET_KEY = 'ionMiningWidgets_' + page;

    // Migrate old dashboard key (one-time backward compat)
    if (page === 'index') {
        var old = localStorage.getItem('ionMiningWidgets');
        if (old && !localStorage.getItem(WIDGET_KEY)) {
            localStorage.setItem(WIDGET_KEY, old);
            localStorage.removeItem('ionMiningWidgets');
        }
    }

    // Build DEFAULT_ORDER and WIDGET_LABELS dynamically from the page's DOM
    var sections = document.querySelectorAll('.widget-section[data-widget]');
    if (sections.length === 0) return; // No widgets on this page

    var DEFAULT_ORDER = [];
    var WIDGET_LABELS = {};
    for (var s = 0; s < sections.length; s++) {
        var key = sections[s].dataset.widget;
        DEFAULT_ORDER.push(key);
        var lbl = sections[s].querySelector('.section-label');
        var h3 = sections[s].querySelector('h3');
        WIDGET_LABELS[key] = lbl ? lbl.textContent.trim() : (h3 ? h3.textContent.trim() : key);
    }

    // SVG icons for lock/unlock
    var lockSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    var unlockSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';

    function loadConfig() {
        try {
            var raw = localStorage.getItem(WIDGET_KEY);
            if (raw) {
                var cfg = JSON.parse(raw);
                if (cfg && cfg.order) {
                    // Add any new widgets not in saved order
                    for (var i = 0; i < DEFAULT_ORDER.length; i++) {
                        if (cfg.order.indexOf(DEFAULT_ORDER[i]) < 0) {
                            cfg.order.push(DEFAULT_ORDER[i]);
                        }
                    }
                    // Remove stale widgets no longer on the page
                    cfg.order = cfg.order.filter(function(k) {
                        return DEFAULT_ORDER.indexOf(k) >= 0;
                    });
                    cfg.hidden = (cfg.hidden || []).filter(function(k) {
                        return DEFAULT_ORDER.indexOf(k) >= 0;
                    });
                    if (cfg.locked === undefined) cfg.locked = true;
                    return cfg;
                }
            }
        } catch (e) {}
        return { order: DEFAULT_ORDER.slice(), hidden: [], locked: true };
    }

    function saveConfig(cfg) {
        try { localStorage.setItem(WIDGET_KEY, JSON.stringify(cfg)); } catch (e) {}
    }

    var config = loadConfig();

    // Apply order + visibility
    function applyLayout() {
        var widgets = document.querySelectorAll('.widget-section');
        for (var i = 0; i < widgets.length; i++) {
            var w = widgets[i];
            var wKey = w.dataset.widget;
            var idx = config.order.indexOf(wKey);
            w.style.order = idx >= 0 ? idx : 99;
            w.style.display = config.hidden.indexOf(wKey) >= 0 ? 'none' : '';
        }
    }

    // Apply lock/unlock state to all widgets
    function applyLock() {
        var widgets = document.querySelectorAll('.widget-section');
        var handles = document.querySelectorAll('.widget-drag-handle');
        for (var i = 0; i < widgets.length; i++) {
            widgets[i].setAttribute('draggable', config.locked ? 'false' : 'true');
        }
        for (var j = 0; j < handles.length; j++) {
            handles[j].style.display = config.locked ? 'none' : '';
        }
    }

    // Add drag handles to each widget
    function addDragHandles() {
        var widgets = document.querySelectorAll('.widget-section');
        for (var i = 0; i < widgets.length; i++) {
            var w = widgets[i];
            var label = w.querySelector('.section-label') || w.querySelector('h3');
            if (!label || label.querySelector('.widget-drag-handle')) continue;

            var handle = document.createElement('span');
            handle.className = 'widget-drag-handle';
            handle.innerHTML = '&#x2630;';
            handle.title = 'Drag to reorder';
            label.insertBefore(handle, label.firstChild);

            // Make widget draggable
            w.setAttribute('draggable', 'true');

            w.addEventListener('dragstart', function(e) {
                if (config.locked) { e.preventDefault(); return; }
                e.dataTransfer.setData('text/plain', this.dataset.widget);
                this.classList.add('widget-dragging');
            });

            w.addEventListener('dragend', function() {
                this.classList.remove('widget-dragging');
                var all = document.querySelectorAll('.widget-section');
                for (var j = 0; j < all.length; j++) {
                    all[j].classList.remove('widget-drag-over');
                }
            });

            w.addEventListener('dragover', function(e) {
                if (config.locked) return;
                e.preventDefault();
                this.classList.add('widget-drag-over');
            });

            w.addEventListener('dragleave', function() {
                this.classList.remove('widget-drag-over');
            });

            w.addEventListener('drop', function(e) {
                if (config.locked) return;
                e.preventDefault();
                this.classList.remove('widget-drag-over');
                var fromKey = e.dataTransfer.getData('text/plain');
                var toKey = this.dataset.widget;
                if (fromKey === toKey) return;

                var fromIdx = config.order.indexOf(fromKey);
                var toIdx = config.order.indexOf(toKey);
                if (fromIdx < 0 || toIdx < 0) return;

                config.order.splice(fromIdx, 1);
                config.order.splice(toIdx, 0, fromKey);
                saveConfig(config);
                applyLayout();
            });

            // Touch support
            (function(widget) {
                var touchStartY = 0;

                widget.addEventListener('touchstart', function(e) {
                    if (config.locked) return;
                    if (!e.target.classList.contains('widget-drag-handle')) return;
                    touchStartY = e.touches[0].clientY;
                    widget.classList.add('widget-dragging');
                }, { passive: true });

                widget.addEventListener('touchmove', function(e) {
                    if (!widget.classList.contains('widget-dragging')) return;
                    e.preventDefault();
                    var touchY = e.touches[0].clientY;
                    var all = document.querySelectorAll('.widget-section');
                    for (var k = 0; k < all.length; k++) {
                        var rect = all[k].getBoundingClientRect();
                        if (touchY > rect.top && touchY < rect.bottom && all[k] !== widget) {
                            all[k].classList.add('widget-drag-over');
                        } else {
                            all[k].classList.remove('widget-drag-over');
                        }
                    }
                }, { passive: false });

                widget.addEventListener('touchend', function(e) {
                    if (!widget.classList.contains('widget-dragging')) return;
                    widget.classList.remove('widget-dragging');
                    var touchY = e.changedTouches[0].clientY;
                    var all = document.querySelectorAll('.widget-section');
                    var target = null;
                    for (var k = 0; k < all.length; k++) {
                        all[k].classList.remove('widget-drag-over');
                        var rect = all[k].getBoundingClientRect();
                        if (touchY > rect.top && touchY < rect.bottom && all[k] !== widget) {
                            target = all[k];
                        }
                    }
                    if (target) {
                        var fromKey = widget.dataset.widget;
                        var toKey = target.dataset.widget;
                        var fromIdx = config.order.indexOf(fromKey);
                        var toIdx = config.order.indexOf(toKey);
                        if (fromIdx >= 0 && toIdx >= 0) {
                            config.order.splice(fromIdx, 1);
                            config.order.splice(toIdx, 0, fromKey);
                            saveConfig(config);
                            applyLayout();
                        }
                    }
                });
            })(w);
        }
    }

    // Inject gear button + lock button + settings popover (fixed top-right of main)
    function injectSettingsUI() {
        var main = document.querySelector('main');
        if (!main) return;

        var wrapper = document.createElement('div');
        wrapper.className = 'widget-gear-wrapper';

        // Lock/unlock button
        var lockBtn = document.createElement('button');
        lockBtn.className = 'btn btn-secondary widget-lock-btn';
        lockBtn.title = config.locked ? 'Unlock widgets to reorder' : 'Lock widgets in place';
        lockBtn.innerHTML = config.locked ? lockSVG : unlockSVG;
        wrapper.appendChild(lockBtn);

        lockBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            config.locked = !config.locked;
            saveConfig(config);
            applyLock();
            lockBtn.innerHTML = config.locked ? lockSVG : unlockSVG;
            lockBtn.title = config.locked ? 'Unlock widgets to reorder' : 'Lock widgets in place';
        });

        // Gear button
        var gear = document.createElement('button');
        gear.className = 'btn btn-secondary widget-gear-btn';
        gear.innerHTML = '&#x2699;';
        gear.title = 'Widget Settings';
        wrapper.appendChild(gear);

        var popover = document.createElement('div');
        popover.className = 'widget-popover';
        popover.id = 'widgetPopover';
        popover.style.display = 'none';

        var html = '<div class="widget-popover-title">Show / Hide Widgets</div>';
        for (var i = 0; i < DEFAULT_ORDER.length; i++) {
            var pKey = DEFAULT_ORDER[i];
            var checked = config.hidden.indexOf(pKey) < 0 ? ' checked' : '';
            html +=
                '<label class="widget-popover-row">' +
                    '<input type="checkbox" data-widget-toggle="' + pKey + '"' + checked + '>' +
                    '<span>' + WIDGET_LABELS[pKey] + '</span>' +
                '</label>';
        }
        html += '<button class="btn btn-secondary widget-reset-btn" id="widgetReset">Reset Layout</button>';
        popover.innerHTML = html;
        wrapper.appendChild(popover);
        main.insertBefore(wrapper, main.firstChild);

        gear.addEventListener('click', function(e) {
            e.stopPropagation();
            popover.style.display = popover.style.display === 'none' ? '' : 'none';
        });

        document.addEventListener('click', function(e) {
            if (!popover.contains(e.target) && e.target !== gear) {
                popover.style.display = 'none';
            }
        });

        var toggles = popover.querySelectorAll('[data-widget-toggle]');
        for (var j = 0; j < toggles.length; j++) {
            toggles[j].addEventListener('change', function() {
                var wKey = this.dataset.widgetToggle;
                if (this.checked) {
                    config.hidden = config.hidden.filter(function(h) { return h !== wKey; });
                } else {
                    if (config.hidden.indexOf(wKey) < 0) config.hidden.push(wKey);
                }
                saveConfig(config);
                applyLayout();
            });
        }

        document.getElementById('widgetReset').addEventListener('click', function() {
            config = { order: DEFAULT_ORDER.slice(), hidden: [], locked: config.locked };
            saveConfig(config);
            applyLayout();
            var checks = popover.querySelectorAll('[data-widget-toggle]');
            for (var c = 0; c < checks.length; c++) checks[c].checked = true;
        });
    }

    // Init after short delay to let page-specific JS render
    setTimeout(function() {
        applyLayout();
        addDragHandles();
        applyLock();
        injectSettingsUI();
    }, 100);
})();
