// ===== ION MINING GROUP — Auth UI Module =====
// Modal overlay with Sign In / Sign Up / Reset Password views.
// Loaded on every page. Injects modal HTML, handles Firebase auth flows.

(function() {
    var modalOpen = false;

    // Firebase error code → user-friendly message
    var ERROR_MAP = {
        'auth/email-already-in-use': 'An account with this email already exists.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/too-many-requests': 'Too many attempts. Please try again later.',
        'auth/invalid-credential': 'Invalid email or password.',
        'auth/network-request-failed': 'Network error. Check your connection.',
        'auth/popup-closed-by-user': ''
    };

    function friendlyError(err) {
        if (!err) return 'An error occurred.';
        var msg = ERROR_MAP[err.code];
        if (msg !== undefined) return msg;
        return err.message || 'An error occurred.';
    }

    // ===== INJECT MODAL HTML =====
    function injectAuthModal() {
        var backdrop = document.createElement('div');
        backdrop.id = 'authBackdrop';
        backdrop.className = 'auth-backdrop';
        backdrop.addEventListener('click', hideModal);
        document.body.appendChild(backdrop);

        var modal = document.createElement('div');
        modal.id = 'authModal';
        modal.className = 'auth-modal';
        modal.innerHTML =
            '<div class="auth-modal-header">' +
                '<h3 id="authTitle">Sign In</h3>' +
                '<button class="auth-close-btn" id="authCloseBtn">&times;</button>' +
            '</div>' +
            '<div class="auth-message auth-error" id="authError" style="display:none"></div>' +
            '<div class="auth-message auth-success" id="authSuccess" style="display:none"></div>' +

            // Sign In view
            '<div class="auth-view" id="authViewSignin">' +
                '<div class="auth-field">' +
                    '<label>Email</label>' +
                    '<input type="email" id="authEmail" placeholder="you@example.com" autocomplete="email">' +
                '</div>' +
                '<div class="auth-field">' +
                    '<label>Password</label>' +
                    '<input type="password" id="authPassword" placeholder="Your password" autocomplete="current-password">' +
                '</div>' +
                '<button class="auth-btn auth-btn-primary" id="authSignInBtn">Sign In</button>' +
                '<div class="auth-link-row">' +
                    '<a href="#" id="authForgotLink">Forgot password?</a>' +
                '</div>' +
                '<div class="auth-divider"><span>or</span></div>' +
                '<button class="auth-btn auth-btn-google" id="authGoogleBtn">' +
                    '<svg width="18" height="18" viewBox="0 0 18 18">' +
                        '<path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.1-.84 2.03-1.79 2.65v2.2h2.9c1.7-1.56 2.68-3.86 2.68-6.49z" fill="#4285F4"/>' +
                        '<path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.2c-.81.54-1.84.86-3.06.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.27C2.44 15.98 5.48 18 9 18z" fill="#34A853"/>' +
                        '<path d="M3.96 10.77c-.18-.54-.28-1.12-.28-1.77s.1-1.23.28-1.77V4.96H.96C.35 6.18 0 7.55 0 9s.35 2.82.96 4.04l3-2.27z" fill="#FBBC05"/>' +
                        '<path d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3 2.27c.71-2.13 2.7-3.65 5.04-3.65z" fill="#EA4335"/>' +
                    '</svg>' +
                    'Continue with Google' +
                '</button>' +
                '<div class="auth-footer-link">' +
                    'Don\'t have an account? <a href="#" id="authCreateLink">Create one</a>' +
                '</div>' +
            '</div>' +

            // Sign Up view
            '<div class="auth-view" id="authViewSignup" style="display:none">' +
                '<div class="auth-field">' +
                    '<label>Display Name</label>' +
                    '<input type="text" id="authSignupName" placeholder="Your name" autocomplete="name">' +
                '</div>' +
                '<div class="auth-field">' +
                    '<label>Email</label>' +
                    '<input type="email" id="authSignupEmail" placeholder="you@example.com" autocomplete="email">' +
                '</div>' +
                '<div class="auth-field">' +
                    '<label>Password</label>' +
                    '<input type="password" id="authSignupPassword" placeholder="At least 6 characters" autocomplete="new-password">' +
                '</div>' +
                '<div class="auth-field">' +
                    '<label>Confirm Password</label>' +
                    '<input type="password" id="authSignupConfirm" placeholder="Re-enter password" autocomplete="new-password">' +
                '</div>' +
                '<button class="auth-btn auth-btn-primary" id="authSignUpBtn">Create Account</button>' +
                '<div class="auth-divider"><span>or</span></div>' +
                '<button class="auth-btn auth-btn-google" id="authGoogleBtn2">' +
                    '<svg width="18" height="18" viewBox="0 0 18 18">' +
                        '<path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.1-.84 2.03-1.79 2.65v2.2h2.9c1.7-1.56 2.68-3.86 2.68-6.49z" fill="#4285F4"/>' +
                        '<path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.2c-.81.54-1.84.86-3.06.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.27C2.44 15.98 5.48 18 9 18z" fill="#34A853"/>' +
                        '<path d="M3.96 10.77c-.18-.54-.28-1.12-.28-1.77s.1-1.23.28-1.77V4.96H.96C.35 6.18 0 7.55 0 9s.35 2.82.96 4.04l3-2.27z" fill="#FBBC05"/>' +
                        '<path d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3 2.27c.71-2.13 2.7-3.65 5.04-3.65z" fill="#EA4335"/>' +
                    '</svg>' +
                    'Continue with Google' +
                '</button>' +
                '<div class="auth-footer-link">' +
                    'Already have an account? <a href="#" id="authBackToSignin">Sign in</a>' +
                '</div>' +
            '</div>' +

            // Reset Password view
            '<div class="auth-view" id="authViewReset" style="display:none">' +
                '<p class="auth-reset-text">Enter your email and we\'ll send you a link to reset your password.</p>' +
                '<div class="auth-field">' +
                    '<label>Email</label>' +
                    '<input type="email" id="authResetEmail" placeholder="you@example.com" autocomplete="email">' +
                '</div>' +
                '<button class="auth-btn auth-btn-primary" id="authResetBtn">Send Reset Link</button>' +
                '<div class="auth-footer-link">' +
                    '<a href="#" id="authBackToSignin2">Back to sign in</a>' +
                '</div>' +
            '</div>';

        document.body.appendChild(modal);

        // Close
        document.getElementById('authCloseBtn').addEventListener('click', hideModal);

        // View switching
        document.getElementById('authCreateLink').addEventListener('click', function(e) { e.preventDefault(); showView('signup'); });
        document.getElementById('authBackToSignin').addEventListener('click', function(e) { e.preventDefault(); showView('signin'); });
        document.getElementById('authForgotLink').addEventListener('click', function(e) { e.preventDefault(); showView('reset'); });
        document.getElementById('authBackToSignin2').addEventListener('click', function(e) { e.preventDefault(); showView('signin'); });

        // Auth actions
        document.getElementById('authSignInBtn').addEventListener('click', handleEmailSignIn);
        document.getElementById('authSignUpBtn').addEventListener('click', handleEmailSignUp);
        document.getElementById('authResetBtn').addEventListener('click', handlePasswordReset);
        document.getElementById('authGoogleBtn').addEventListener('click', handleGoogleSignIn);
        document.getElementById('authGoogleBtn2').addEventListener('click', handleGoogleSignIn);

        // Enter key support
        document.getElementById('authPassword').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') handleEmailSignIn();
        });
        document.getElementById('authSignupConfirm').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') handleEmailSignUp();
        });
        document.getElementById('authResetEmail').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') handlePasswordReset();
        });

        // Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && modalOpen) hideModal();
        });
    }

    // ===== VIEW SWITCHING =====
    function showView(view) {
        clearMessages();
        var views = { signin: 'authViewSignin', signup: 'authViewSignup', reset: 'authViewReset' };
        var titles = { signin: 'Sign In', signup: 'Create Account', reset: 'Reset Password' };

        for (var k in views) {
            document.getElementById(views[k]).style.display = k === view ? '' : 'none';
        }
        document.getElementById('authTitle').textContent = titles[view] || 'Sign In';

        // Focus first input in the active view
        setTimeout(function() {
            var input = document.getElementById(views[view]).querySelector('input');
            if (input) input.focus();
        }, 50);
    }

    // ===== SHOW / HIDE =====
    function showModal(view) {
        modalOpen = true;
        showView(view || 'signin');
        document.getElementById('authBackdrop').classList.add('open');
        document.getElementById('authModal').classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function hideModal() {
        modalOpen = false;
        document.getElementById('authBackdrop').classList.remove('open');
        document.getElementById('authModal').classList.remove('open');
        document.body.style.overflow = '';
        clearMessages();
    }

    function clearMessages() {
        var err = document.getElementById('authError');
        var suc = document.getElementById('authSuccess');
        if (err) { err.style.display = 'none'; err.textContent = ''; }
        if (suc) { suc.style.display = 'none'; suc.textContent = ''; }
    }

    function showError(msg) {
        if (!msg) return;
        var el = document.getElementById('authError');
        el.textContent = msg;
        el.style.display = '';
        document.getElementById('authSuccess').style.display = 'none';
    }

    function showSuccess(msg) {
        var el = document.getElementById('authSuccess');
        el.textContent = msg;
        el.style.display = '';
        document.getElementById('authError').style.display = 'none';
    }

    function setLoading(btnId, loading) {
        var btn = document.getElementById(btnId);
        if (!btn) return;
        btn.disabled = loading;
        if (loading) {
            btn.dataset.originalText = btn.textContent;
            btn.textContent = 'Please wait\u2026';
        } else {
            btn.textContent = btn.dataset.originalText || btn.textContent;
        }
    }

    // ===== AUTH HANDLERS =====
    function handleEmailSignIn() {
        clearMessages();
        var email = document.getElementById('authEmail').value.trim();
        var password = document.getElementById('authPassword').value;

        if (!email || !password) {
            showError('Please enter your email and password.');
            return;
        }

        setLoading('authSignInBtn', true);
        IonAuth.signInWithEmail(email, password).then(function() {
            hideModal();
            if (typeof window.handlePostAuth === 'function') window.handlePostAuth();
        }).catch(function(err) {
            setLoading('authSignInBtn', false);
            var msg = friendlyError(err);
            if (msg) showError(msg);
        });
    }

    function handleEmailSignUp() {
        clearMessages();
        var name = document.getElementById('authSignupName').value.trim();
        var email = document.getElementById('authSignupEmail').value.trim();
        var password = document.getElementById('authSignupPassword').value;
        var confirm = document.getElementById('authSignupConfirm').value;

        if (!email || !password) {
            showError('Please fill in all required fields.');
            return;
        }
        if (password !== confirm) {
            showError('Passwords do not match.');
            return;
        }
        if (password.length < 6) {
            showError('Password must be at least 6 characters.');
            return;
        }

        setLoading('authSignUpBtn', true);
        IonAuth.signUpWithEmail(email, password, name).then(function() {
            hideModal();
            if (typeof window.handlePostAuth === 'function') window.handlePostAuth();
        }).catch(function(err) {
            setLoading('authSignUpBtn', false);
            var msg = friendlyError(err);
            if (msg) showError(msg);
        });
    }

    function handlePasswordReset() {
        clearMessages();
        var email = document.getElementById('authResetEmail').value.trim();

        if (!email) {
            showError('Please enter your email.');
            return;
        }

        setLoading('authResetBtn', true);
        IonAuth.sendPasswordReset(email).then(function() {
            setLoading('authResetBtn', false);
            showSuccess('Reset link sent! Check your inbox.');
        }).catch(function(err) {
            setLoading('authResetBtn', false);
            var msg = friendlyError(err);
            if (msg) showError(msg);
        });
    }

    function handleGoogleSignIn() {
        clearMessages();
        IonAuth.signInWithGoogle().then(function() {
            hideModal();
            if (typeof window.handlePostAuth === 'function') window.handlePostAuth();
        }).catch(function(err) {
            var msg = friendlyError(err);
            if (msg) showError(msg);
        });
    }

    // ===== INIT =====
    injectAuthModal();

    // ===== PUBLIC API =====
    window.IonAuthUI = {
        show: showModal,
        hide: hideModal,
        showError: showError,
        showSuccess: showSuccess
    };
})();
