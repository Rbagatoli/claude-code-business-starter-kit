// ===== ION MINING GROUP — Profile Panel =====
// Slide-out panel with account info, data export, sign out, and account management.

(function() {
    var panelOpen = false;

    function injectProfilePanel() {
        var backdrop = document.createElement('div');
        backdrop.id = 'profileBackdrop';
        backdrop.className = 'profile-backdrop';
        backdrop.addEventListener('click', hidePanel);
        document.body.appendChild(backdrop);

        var panel = document.createElement('div');
        panel.id = 'profilePanel';
        panel.className = 'profile-panel';
        panel.innerHTML =
            '<div class="profile-header">' +
                '<h3>Account</h3>' +
                '<button class="profile-close-btn" id="profileCloseBtn">&times;</button>' +
            '</div>' +
            '<div class="profile-body">' +
                '<div class="profile-user-info" id="profileUserInfo"></div>' +
                '<div class="profile-actions">' +
                    '<button class="profile-action-btn" id="profileExportBtn">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                        'Export All Data' +
                    '</button>' +
                    '<button class="profile-action-btn" id="profileDeleteDataBtn">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
                        'Delete Cloud Data' +
                    '</button>' +
                    '<button class="profile-action-btn profile-signout-btn" id="profileSignOutBtn">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
                        'Sign Out' +
                    '</button>' +
                    '<button class="profile-action-btn profile-danger-btn" id="profileDeleteAccountBtn">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
                        'Delete Account' +
                    '</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(panel);

        document.getElementById('profileCloseBtn').addEventListener('click', hidePanel);
        document.getElementById('profileExportBtn').addEventListener('click', exportAllData);
        document.getElementById('profileDeleteDataBtn').addEventListener('click', deleteCloudData);
        document.getElementById('profileSignOutBtn').addEventListener('click', handleSignOut);
        document.getElementById('profileDeleteAccountBtn').addEventListener('click', handleDeleteAccount);

        // Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && panelOpen) hidePanel();
        });
    }

    function showPanel() {
        panelOpen = true;
        renderUserInfo();
        document.getElementById('profilePanel').classList.add('open');
        document.getElementById('profileBackdrop').classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function hidePanel() {
        panelOpen = false;
        document.getElementById('profilePanel').classList.remove('open');
        document.getElementById('profileBackdrop').classList.remove('open');
        document.body.style.overflow = '';
    }

    function renderUserInfo() {
        var user = IonAuth.getUser();
        if (!user) return;

        var initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();
        var name = user.displayName || 'No name set';
        var email = user.email || '';

        var provider = 'Email';
        if (user.providerData && user.providerData.length > 0) {
            var pid = user.providerData[0].providerId;
            if (pid === 'google.com') provider = 'Google';
        }

        var verifiedHtml = '';
        if (provider === 'Email') {
            if (user.emailVerified) {
                verifiedHtml =
                    '<div class="profile-verified">' +
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2">' +
                            '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>' +
                            '<polyline points="22 4 12 14.01 9 11.01"/>' +
                        '</svg> Email verified' +
                    '</div>';
            } else {
                verifiedHtml =
                    '<div class="profile-unverified">' +
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2">' +
                            '<circle cx="12" cy="12" r="10"/>' +
                            '<line x1="12" y1="8" x2="12" y2="12"/>' +
                            '<line x1="12" y1="16" x2="12.01" y2="16"/>' +
                        '</svg> Email not verified ' +
                        '<a href="#" id="profileResendVerify">Resend</a>' +
                    '</div>';
            }
        }

        var container = document.getElementById('profileUserInfo');
        container.innerHTML =
            '<div class="profile-avatar">' + initial + '</div>' +
            '<div class="profile-name">' + escapeHtml(name) + '</div>' +
            '<div class="profile-email">' + escapeHtml(email) + '</div>' +
            '<div class="profile-provider-badge">' + provider + '</div>' +
            verifiedHtml;

        var resendLink = document.getElementById('profileResendVerify');
        if (resendLink) {
            resendLink.addEventListener('click', function(e) {
                e.preventDefault();
                resendLink.textContent = 'Sending...';
                resendLink.style.pointerEvents = 'none';
                IonAuth.resendVerification().then(function() {
                    resendLink.textContent = 'Sent! Check inbox & spam.';
                    resendLink.style.color = '#4ade80';
                }).catch(function(err) {
                    console.error('Resend verification failed:', err.code, err.message);
                    var msg = 'Failed';
                    if (err.code === 'auth/too-many-requests') msg = 'Too many attempts — try later';
                    else if (err.message) msg = err.message;
                    resendLink.textContent = msg;
                    resendLink.style.color = '#ef4444';
                    setTimeout(function() {
                        resendLink.textContent = 'Resend';
                        resendLink.style.color = '';
                        resendLink.style.pointerEvents = '';
                    }, 5000);
                });
            });
        }
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function exportAllData() {
        var data = {};
        var keys = typeof SyncEngine !== 'undefined' ? SyncEngine.SYNC_KEYS : {};
        for (var key in keys) {
            var raw = localStorage.getItem(keys[key].lsKey);
            if (raw) {
                try { data[key] = JSON.parse(raw); } catch(e) { data[key] = raw; }
            }
        }

        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'ion-mining-data-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function deleteCloudData() {
        if (!confirm('Delete all your cloud data? Your local data will be kept.')) return;

        var user = IonAuth.getUser();
        if (!user || typeof firebase === 'undefined') return;

        var db = firebase.firestore();
        var ref = db.collection('users').doc(user.uid).collection('data');
        ref.get().then(function(snapshot) {
            var batch = db.batch();
            snapshot.forEach(function(doc) { batch.delete(doc.ref); });
            return batch.commit();
        }).then(function() {
            SyncEngine.stopAll();
            alert('Cloud data deleted.');
        }).catch(function(err) {
            alert('Failed to delete cloud data: ' + err.message);
        });
    }

    function handleSignOut() {
        SyncEngine.stopAll();
        IonAuth.signOut();
        hidePanel();
    }

    function handleDeleteAccount() {
        if (!confirm('Permanently delete your account and all cloud data? This cannot be undone.')) return;
        if (!confirm('Are you sure? This action is permanent.')) return;

        var user = IonAuth.getUser();
        if (!user || typeof firebase === 'undefined') return;

        var db = firebase.firestore();
        var ref = db.collection('users').doc(user.uid).collection('data');
        ref.get().then(function(snapshot) {
            var batch = db.batch();
            snapshot.forEach(function(doc) { batch.delete(doc.ref); });
            return batch.commit();
        }).then(function() {
            SyncEngine.stopAll();
            return IonAuth.deleteAccount();
        }).then(function() {
            hidePanel();
            alert('Account deleted.');
            location.reload();
        }).catch(function(err) {
            if (err.code === 'auth/requires-recent-login') {
                alert('For security, please sign out and sign back in, then try again.');
            } else {
                alert('Failed to delete account: ' + err.message);
            }
        });
    }

    // ===== INIT =====
    injectProfilePanel();

    // ===== PUBLIC API =====
    window.IonProfile = {
        show: showPanel,
        hide: hidePanel
    };
})();
