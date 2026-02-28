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

        signIn: function() {
            if (typeof firebase === 'undefined') return Promise.reject('Firebase not loaded');
            var provider = new firebase.auth.GoogleAuthProvider();
            return firebase.auth().signInWithPopup(provider);
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
