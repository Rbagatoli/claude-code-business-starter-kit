// ===== ION MINING GROUP — Widget Settings =====
// Show/hide and drag-to-reorder dashboard sections.
// Storage: ionMiningWidgets in localStorage.

(function initWidgets() {
    var WIDGET_KEY = 'ionMiningWidgets';
    var DEFAULT_ORDER = ['fleet', 'profit', 'miners', 'pool', 'chart'];
    var WIDGET_LABELS = {
        fleet: 'Fleet Overview',
        profit: 'Profitability',
        miners: 'Miners',
        pool: 'F2Pool Earnings',
        chart: 'Earnings Chart'
    };

    // Only run on dashboard
    if (!document.getElementById('btnAddMiner')) return;

    function loadConfig() {
        try {
            var raw = localStorage.getItem(WIDGET_KEY);
            if (raw) {
                var cfg = JSON.parse(raw);
                if (cfg && cfg.order) return cfg;
            }
        } catch (e) {}
        return { order: DEFAULT_ORDER.slice(), hidden: [] };
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
            var key = w.dataset.widget;
            var idx = config.order.indexOf(key);
            w.style.order = idx >= 0 ? idx : 99;
            w.style.display = config.hidden.indexOf(key) >= 0 ? 'none' : '';
        }
    }

    // Add drag handles to each widget
    function addDragHandles() {
        var widgets = document.querySelectorAll('.widget-section');
        for (var i = 0; i < widgets.length; i++) {
            var w = widgets[i];
            var label = w.querySelector('.section-label');
            if (!label || label.querySelector('.widget-drag-handle')) continue;

            var handle = document.createElement('span');
            handle.className = 'widget-drag-handle';
            handle.innerHTML = '&#x2630;';
            handle.title = 'Drag to reorder';
            label.insertBefore(handle, label.firstChild);

            // Make widget draggable
            w.setAttribute('draggable', 'true');

            w.addEventListener('dragstart', function(e) {
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
                e.preventDefault();
                this.classList.add('widget-drag-over');
            });

            w.addEventListener('dragleave', function() {
                this.classList.remove('widget-drag-over');
            });

            w.addEventListener('drop', function(e) {
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
                var touchClone = null;

                widget.addEventListener('touchstart', function(e) {
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

    // Inject gear button + settings popover
    function injectSettingsUI() {
        var actions = document.querySelector('.dashboard-actions');
        if (!actions) return;

        var gear = document.createElement('button');
        gear.className = 'btn btn-secondary widget-gear-btn';
        gear.innerHTML = '&#x2699;';
        gear.title = 'Widget Settings';
        actions.appendChild(gear);

        var popover = document.createElement('div');
        popover.className = 'widget-popover';
        popover.id = 'widgetPopover';
        popover.style.display = 'none';

        var html = '<div class="widget-popover-title">Show / Hide Widgets</div>';
        for (var i = 0; i < DEFAULT_ORDER.length; i++) {
            var key = DEFAULT_ORDER[i];
            var checked = config.hidden.indexOf(key) < 0 ? ' checked' : '';
            html +=
                '<label class="widget-popover-row">' +
                    '<input type="checkbox" data-widget-toggle="' + key + '"' + checked + '>' +
                    '<span>' + WIDGET_LABELS[key] + '</span>' +
                '</label>';
        }
        html += '<button class="btn btn-secondary widget-reset-btn" id="widgetReset">Reset Layout</button>';
        popover.innerHTML = html;
        actions.appendChild(popover);

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
            config = { order: DEFAULT_ORDER.slice(), hidden: [] };
            saveConfig(config);
            applyLayout();
            var checks = popover.querySelectorAll('[data-widget-toggle]');
            for (var c = 0; c < checks.length; c++) checks[c].checked = true;
        });
    }

    // Init after short delay to let dashboard render
    setTimeout(function() {
        applyLayout();
        addDragHandles();
        injectSettingsUI();
    }, 100);
})();
