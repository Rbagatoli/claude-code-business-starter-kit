// ===== ION MINING GROUP — Onboarding Wizard =====
// 3-step first-time user overlay. Shows once per device.
// Stored as ionMiningOnboarded in localStorage (not synced).

(function initOnboarding() {
    var ONBOARDED_KEY = 'ionMiningOnboarded';

    // Only run on dashboard page
    if (!document.getElementById('btnAddMiner')) return;

    // Already onboarded
    if (localStorage.getItem(ONBOARDED_KEY)) return;

    var currentStep = 0;
    var steps = [
        {
            title: 'Welcome to Ion Mining',
            body: 'Your all-in-one BTC mining dashboard. Track your fleet, monitor earnings, manage wallets, and analyze profitability — all in one place.',
            target: null
        },
        {
            title: 'Add Your First Miner',
            body: 'Start by adding your ASIC miners. Enter the model, hashrate, and power draw to see fleet-wide stats and estimated daily earnings.',
            target: 'btnAddMiner'
        },
        {
            title: 'Connect Your Pool',
            body: 'Link your F2Pool account to pull live hashrate, worker status, and earnings data directly into the dashboard.',
            target: 'btnConnectAPI'
        }
    ];

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
                currentStep++;
                renderStep();
            }
        });

        // Spotlight target
        if (step.target) {
            var el = document.getElementById(step.target);
            if (el) {
                var rect = el.getBoundingClientRect();
                spotlight.style.display = '';
                spotlight.style.top = (rect.top + window.scrollY - 8) + 'px';
                spotlight.style.left = (rect.left - 8) + 'px';
                spotlight.style.width = (rect.width + 16) + 'px';
                spotlight.style.height = (rect.height + 16) + 'px';
                // Scroll target into view
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } else {
            spotlight.style.display = 'none';
        }
    }

    function finish() {
        localStorage.setItem(ONBOARDED_KEY, '1');
        overlay.classList.add('fade-out');
        setTimeout(function() {
            overlay.remove();
        }, 300);
    }

    // Small delay to let page render
    setTimeout(function() {
        overlay.classList.add('visible');
        renderStep();
    }, 500);
})();
