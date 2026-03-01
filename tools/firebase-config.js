// ===== ION MINING GROUP — Firebase Configuration =====

(function() {
    // Initialize Firebase
    var firebaseConfig = {
        apiKey: "AIzaSyDxwKSrj5-1GnL1kX-mhRrDwISx71A006w",
        authDomain: "ion-mining.firebaseapp.com",
        projectId: "ion-mining",
        storageBucket: "ion-mining.firebasestorage.app",
        messagingSenderId: "957627726487",
        appId: "1:957627726487:web:64f6db35c3ba413281c7d2"
    };

    if (typeof firebase !== 'undefined' && !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    // Auth helper
    window.IonAuth = {
        _listeners: [],

        getUser: function() {
            if (typeof firebase === 'undefined') return null;
            return firebase.auth().currentUser;
        },

        isSignedIn: function() {
            return !!this.getUser();
        },

        // Google sign-in (original method)
        signIn: function() {
            return this.signInWithGoogle();
        },

        signInWithGoogle: function() {
            if (typeof firebase === 'undefined') return Promise.reject('Firebase not loaded');
            var provider = new firebase.auth.GoogleAuthProvider();
            return firebase.auth().signInWithPopup(provider);
        },

        // Email/password sign-up
        signUpWithEmail: function(email, password, displayName) {
            if (typeof firebase === 'undefined') return Promise.reject('Firebase not loaded');
            return firebase.auth().createUserWithEmailAndPassword(email, password)
                .then(function(credential) {
                    var promises = [];
                    if (displayName) {
                        promises.push(credential.user.updateProfile({ displayName: displayName }));
                    }
                    promises.push(credential.user.sendEmailVerification());
                    return Promise.all(promises).then(function() { return credential; });
                });
        },

        // Email/password sign-in
        signInWithEmail: function(email, password) {
            if (typeof firebase === 'undefined') return Promise.reject('Firebase not loaded');
            return firebase.auth().signInWithEmailAndPassword(email, password);
        },

        // Password reset
        sendPasswordReset: function(email) {
            if (typeof firebase === 'undefined') return Promise.reject('Firebase not loaded');
            return firebase.auth().sendPasswordResetEmail(email);
        },

        // Update display name
        updateDisplayName: function(name) {
            var user = this.getUser();
            if (!user) return Promise.reject('Not signed in');
            return user.updateProfile({ displayName: name });
        },

        // Resend verification email
        resendVerification: function() {
            var user = this.getUser();
            if (!user) return Promise.reject('Not signed in');
            return user.sendEmailVerification();
        },

        // Delete account
        deleteAccount: function() {
            var user = this.getUser();
            if (!user) return Promise.reject('Not signed in');
            return user.delete();
        },

        signOut: function() {
            if (typeof firebase === 'undefined') return Promise.reject('Firebase not loaded');
            return firebase.auth().signOut();
        },

        onAuthChange: function(callback) {
            if (typeof firebase === 'undefined') return;
            firebase.auth().onAuthStateChanged(callback);
            this._listeners.push(callback);
        }
    };
})();
