// ===== ION MINING GROUP — Cross-Device Sync Engine =====

var SyncEngine = (function() {

    var _debounceTimers = {};
    var _listeners = {};
    var _syncing = false;

    // Firestore collection/doc mapping
    // Each key maps to: users/{uid}/data/{key}
    var SYNC_KEYS = {
        fleet:       { lsKey: 'ionMiningFleet' },
        wallet:      { lsKey: 'ionMiningWallet' },
        payouts:     { lsKey: 'ionMiningPayouts' },
        electricity: { lsKey: 'ionMiningElectricity' },
        calculator:  { lsKey: 'btcMinerCalcSettings' },
        settings:    { lsKey: 'ionMiningSettings' },
        alerts:      { lsKey: 'ionMiningAlerts' },
        currency:    { lsKey: 'ionMiningCurrency' }
    };

    function getDb() {
        if (typeof firebase === 'undefined') return null;
        return firebase.firestore();
    }

    function getUserDocRef(key) {
        var db = getDb();
        if (!db) return null;
        var user = IonAuth.getUser();
        if (!user) return null;
        return db.collection('users').doc(user.uid).collection('data').doc(key);
    }

    // Save data to Firestore (debounced)
    function save(key, data) {
        if (!IonAuth.isSignedIn()) return;
        if (!SYNC_KEYS[key]) return;

        // Debounce: wait 500ms after last call before writing
        if (_debounceTimers[key]) clearTimeout(_debounceTimers[key]);
        _debounceTimers[key] = setTimeout(function() {
            var ref = getUserDocRef(key);
            if (!ref) return;

            var payload = {
                data: JSON.parse(JSON.stringify(data)),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            ref.set(payload, { merge: true }).catch(function(err) {
                console.warn('[Sync] Write failed for ' + key + ':', err.message);
            });
        }, 500);
    }

    // Listen for remote changes on a key
    function listen(key, callback) {
        if (!IonAuth.isSignedIn()) return;
        if (!SYNC_KEYS[key]) return;

        // Unsubscribe previous listener if any
        if (_listeners[key]) {
            _listeners[key]();
        }

        var ref = getUserDocRef(key);
        if (!ref) return;

        var isFirst = true;
        _listeners[key] = ref.onSnapshot(function(doc) {
            // Skip the initial snapshot (fires immediately with current data)
            if (isFirst) { isFirst = false; return; }

            // Skip local writes — only react to server-confirmed remote changes
            if (doc.metadata.hasPendingWrites) return;

            // Skip if this change came from our own save (avoid loops)
            if (_syncing) return;

            if (doc.exists) {
                var remote = doc.data();
                if (remote && remote.data) {
                    // Compare with current localStorage — skip if identical
                    var lsKey = SYNC_KEYS[key].lsKey;
                    var current = localStorage.getItem(lsKey);
                    var remoteStr = (key === 'currency') ? remote.data : JSON.stringify(remote.data);
                    if (current === remoteStr) return;

                    _syncing = true;

                    // Update localStorage
                    if (key === 'currency') {
                        localStorage.setItem(lsKey, remote.data);
                    } else {
                        localStorage.setItem(lsKey, JSON.stringify(remote.data));
                    }

                    // Call the page callback to re-render
                    if (typeof callback === 'function') {
                        try { callback(remote.data); } catch(e) {}
                    }

                    setTimeout(function() { _syncing = false; }, 100);
                }
            }
        }, function(err) {
            console.warn('[Sync] Listen failed for ' + key + ':', err.message);
        });
    }

    // Stop all listeners
    function stopAll() {
        Object.keys(_listeners).forEach(function(key) {
            if (_listeners[key]) {
                _listeners[key]();
                delete _listeners[key];
            }
        });
    }

    // Pull all data from Firestore on sign-in
    function pullAll(callback) {
        if (!IonAuth.isSignedIn()) return;
        var db = getDb();
        if (!db) return;
        var user = IonAuth.getUser();
        if (!user) return;

        var ref = db.collection('users').doc(user.uid).collection('data');
        ref.get().then(function(snapshot) {
            _syncing = true;
            var pulled = 0;

            snapshot.forEach(function(doc) {
                var key = doc.id;
                if (SYNC_KEYS[key] && doc.data() && doc.data().data) {
                    var lsKey = SYNC_KEYS[key].lsKey;
                    var remoteData = doc.data().data;

                    if (key === 'currency') {
                        localStorage.setItem(lsKey, remoteData);
                    } else {
                        localStorage.setItem(lsKey, JSON.stringify(remoteData));
                    }
                    pulled++;
                }
            });

            setTimeout(function() { _syncing = false; }, 100);

            if (typeof callback === 'function') callback(pulled);
        }).catch(function(err) {
            console.warn('[Sync] Pull all failed:', err.message);
            if (typeof callback === 'function') callback(0);
        });
    }

    // Push all local data to Firestore (on first sign-in when cloud is empty)
    function pushAll() {
        if (!IonAuth.isSignedIn()) return;

        Object.keys(SYNC_KEYS).forEach(function(key) {
            var lsKey = SYNC_KEYS[key].lsKey;
            var raw = localStorage.getItem(lsKey);
            if (!raw) return;

            var data;
            if (key === 'currency') {
                data = raw;
            } else {
                try { data = JSON.parse(raw); } catch(e) { return; }
            }

            save(key, data);
        });
    }

    return {
        save: save,
        listen: listen,
        stopAll: stopAll,
        pullAll: pullAll,
        pushAll: pushAll,
        SYNC_KEYS: SYNC_KEYS,
        isSyncing: function() { return _syncing; }
    };

})();
