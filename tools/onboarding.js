// ===== ION MINING GROUP — Onboarding Wizard =====
// 9-step guided tour across all pages. Shows once per device.
// Progress stored in localStorage so it survives page navigation.

(function initOnboarding() {
    var ONBOARDED_KEY = 'ionMiningOnboarded';
    var STEP_KEY = 'ionMiningStep';

    // Already completed onboarding
    if (localStorage.getItem(ONBOARDED_KEY)) return;

    var steps = [
        {
            title: 'Welcome to Ion Mining',
            body: 'Your all-in-one BTC mining dashboard. Track your fleet, monitor earnings, manage wallets, and analyze profitability \u2014 all in one place.',
            target: null,
            page: 'index.html'
        },
        {
            title: 'Add Your First Miner',
            body: 'Start by adding your ASIC miners. Enter the model, hashrate, and power draw to see fleet-wide stats and estimated daily earnings.',
            target: 'btnAddMiner',
            page: 'index.html'
        },
        {
            title: 'Connect Your Pool',
            body: 'Link your Mining Pool account to pull live hashrate, worker status, and earnings data directly into the dashboard.',
            target: 'btnConnectAPI',
            page: 'index.html'
        },
        {
            title: 'Calculator',
            body: 'Project your mining profitability over time with adjustable difficulty, price, and halving parameters. Compare miners side-by-side.',
            target: null,
            page: 'calculator.html'
        },
        {
            title: 'Map',
            body: 'Visualize your fleet\'s geographic distribution on an interactive map and 3D globe. Click any location for details.',
            target: null,
            page: 'map.html'
        },
        {
            title: 'Banking',
            body: 'Your unified financial hub. Wallet, mining income tracking, and accounting — all in one place with tabbed navigation.',
            target: null,
            page: 'banking.html'
        },
        {
            title: 'Network Data',
            body: 'Live Bitcoin price, network difficulty, and hashrate charts. Stay on top of the metrics that affect your mining profitability.',
            target: null,
            page: 'charts.html'
        }
    ];

    // Detect current page from URL
    var path = location.pathname;
    var currentPage = path.substring(path.lastIndexOf('/') + 1) || 'index.html';

    // Read stored step (or start at 0 if on dashboard for first time)
    var storedStep = localStorage.getItem(STEP_KEY);
    var currentStep = storedStep !== null ? parseInt(storedStep, 10) : 0;

    // Validate step range
    if (currentStep < 0 || currentStep >= steps.length) {
        localStorage.removeItem(STEP_KEY);
        return;
    }

    // Only show wizard if we're on the correct page for the current step
    if (steps[currentStep].page !== currentPage) {
        // First visit with no stored step — only start on dashboard
        if (storedStep === null && currentPage !== 'index.html') return;
        // Stored step exists but we're on wrong page — user navigated away, don't show
        if (storedStep !== null) return;
        return;
    }

    // Inject overlay
    var overlay = document.createElement('div');
    overlay.className = 'onboard-overlay';
    overlay.id = 'onboardOverlay';

    var card = document.createElement('div');
    card.className = 'onboard-card';
    card.id = 'onboardCard';

    var spotlight = document.createElement('div');
    spotlight.className = 'onboard-spotlight';
    spotlight.id = 'onboardSpotlight';
    spotlight.style.display = 'none';

    overlay.appendChild(spotlight);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function highlightNavTab(page) {
        // Remove previous highlights
        var tabs = document.querySelectorAll('.ion-nav-tabs a');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.remove('onboard-highlight');
        }
        // Find and highlight the matching tab
        var href = './' + page;
        for (var j = 0; j < tabs.length; j++) {
            if (tabs[j].getAttribute('href') === href) {
                tabs[j].classList.add('onboard-highlight');
                break;
            }
        }
    }

    function renderStep() {
        var step = steps[currentStep];
        var isLast = currentStep === steps.length - 1;
        var dots = '';
        for (var i = 0; i < steps.length; i++) {
            dots += '<span class="onboard-dot' + (i === currentStep ? ' active' : '') + '"></span>';
        }

        card.innerHTML =
            '<div class="onboard-step-count">Step ' + (currentStep + 1) + ' of ' + steps.length + '</div>' +
            '<h3 class="onboard-title">' + step.title + '</h3>' +
            '<p class="onboard-body">' + step.body + '</p>' +
            '<div class="onboard-dots">' + dots + '</div>' +
            '<div class="onboard-actions">' +
                '<button class="btn btn-secondary onboard-skip" id="onboardSkip">Skip</button>' +
                '<button class="btn btn-primary onboard-next" id="onboardNext">' + (isLast ? 'Get Started' : 'Next') + '</button>' +
            '</div>';

        document.getElementById('onboardSkip').addEventListener('click', finish);
        document.getElementById('onboardNext').addEventListener('click', function() {
            if (isLast) {
                finish();
            } else {
                var nextStep = currentStep + 1;
                var nextPage = steps[nextStep].page;
                if (nextPage !== currentPage) {
                    // Navigate to the next page — wizard continues there
                    localStorage.setItem(STEP_KEY, String(nextStep));
                    window.location.href = './' + nextPage;
                } else {
                    currentStep = nextStep;
                    localStorage.setItem(STEP_KEY, String(currentStep));
                    renderStep();
                }
            }
        });

        // Highlight nav tab for current step's page
        highlightNavTab(step.page);

        // Spotlight target (only for elements on this page)
        if (step.target) {
            var el = document.getElementById(step.target);
            if (el) {
                var rect = el.getBoundingClientRect();
                spotlight.style.display = '';
                spotlight.style.top = (rect.top + window.scrollY - 8) + 'px';
                spotlight.style.left = (rect.left - 8) + 'px';
                spotlight.style.width = (rect.width + 16) + 'px';
                spotlight.style.height = (rect.height + 16) + 'px';
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } else {
            spotlight.style.display = 'none';
        }
    }

    function finish() {
        localStorage.setItem(ONBOARDED_KEY, '1');
        localStorage.removeItem(STEP_KEY);
        // Remove nav highlight
        var tabs = document.querySelectorAll('.ion-nav-tabs a');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.remove('onboard-highlight');
        }
        overlay.classList.add('fade-out');
        setTimeout(function() {
            overlay.remove();
            // If not on dashboard, go back
            if (currentPage !== 'index.html') {
                window.location.href = './index.html';
            }
        }, 300);
    }

    // Small delay to let page render
    setTimeout(function() {
        overlay.classList.add('visible');
        renderStep();
    }, 500);
})();
