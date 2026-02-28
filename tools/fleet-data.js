// ===== ION MINING GROUP — Fleet Data Module =====

var FleetData = (function() {
    var FLEET_KEY = 'ionMiningFleet';
    var SETTINGS_KEY = 'ionMiningSettings';

    function generateId() {
        return 'miner_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // --- Fleet CRUD ---
    function getFleet() {
        try {
            var raw = localStorage.getItem(FLEET_KEY);
            if (!raw) return defaultFleet();
            var data = JSON.parse(raw);
            if (!data || !data.miners) return defaultFleet();
            return data;
        } catch(e) { return defaultFleet(); }
    }

    function defaultFleet() {
        return {
            _v: 1,
            miners: [],
            defaults: { elecCost: 0.07, poolFee: 2, uptime: 100 }
        };
    }

    function saveFleet(fleet) {
        try { localStorage.setItem(FLEET_KEY, JSON.stringify(fleet)); } catch(e) {}
        if (typeof SyncEngine !== 'undefined') SyncEngine.save('fleet', fleet);
    }

    function addMiner(miner) {
        var fleet = getFleet();
        var entry = {
            id: generateId(),
            model: miner.model || 'Unknown Miner',
            hashrate: parseFloat(miner.hashrate) || 0,
            power: parseFloat(miner.power) || 0,
            cost: parseFloat(miner.cost) || 0,
            quantity: parseInt(miner.quantity) || 1,
            status: miner.status || 'online',
            dateAdded: new Date().toISOString()
        };
        fleet.miners.push(entry);
        saveFleet(fleet);
        return entry;
    }

    function updateMiner(id, updates) {
        var fleet = getFleet();
        for (var i = 0; i < fleet.miners.length; i++) {
            if (fleet.miners[i].id === id) {
                if (updates.model !== undefined) fleet.miners[i].model = updates.model;
                if (updates.hashrate !== undefined) fleet.miners[i].hashrate = parseFloat(updates.hashrate);
                if (updates.power !== undefined) fleet.miners[i].power = parseFloat(updates.power);
                if (updates.cost !== undefined) fleet.miners[i].cost = parseFloat(updates.cost);
                if (updates.quantity !== undefined) fleet.miners[i].quantity = parseInt(updates.quantity);
                if (updates.status !== undefined) fleet.miners[i].status = updates.status;
                break;
            }
        }
        saveFleet(fleet);
    }

    function removeMiner(id) {
        var fleet = getFleet();
        fleet.miners = fleet.miners.filter(function(m) { return m.id !== id; });
        saveFleet(fleet);
    }

    function reduceQuantity(id) {
        var fleet = getFleet();
        for (var i = 0; i < fleet.miners.length; i++) {
            if (fleet.miners[i].id === id) {
                fleet.miners[i].quantity -= 1;
                if (fleet.miners[i].quantity <= 0) {
                    fleet.miners.splice(i, 1);
                }
                break;
            }
        }
        saveFleet(fleet);
    }

    // --- Fleet Summary ---
    function getFleetSummary() {
        var fleet = getFleet();
        var totalHashrate = 0;
        var totalPower = 0;
        var onlineCount = 0;
        var offlineCount = 0;
        var totalMachines = 0;

        for (var i = 0; i < fleet.miners.length; i++) {
            var m = fleet.miners[i];
            totalMachines += m.quantity;
            if (m.status === 'online') {
                onlineCount += m.quantity;
                totalHashrate += m.hashrate * m.quantity;
                totalPower += m.power * m.quantity;
            } else {
                offlineCount += m.quantity;
            }
        }

        var efficiency = totalHashrate > 0 ? (totalPower * 1000) / totalHashrate : 0;

        return {
            totalHashrate: totalHashrate,
            totalPower: totalPower,
            onlineCount: onlineCount,
            offlineCount: offlineCount,
            totalMachines: totalMachines,
            efficiency: efficiency,
            defaults: fleet.defaults
        };
    }

    // --- Settings ---
    function getSettings() {
        try {
            var raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return defaultSettings();
            return JSON.parse(raw);
        } catch(e) { return defaultSettings(); }
    }

    function defaultSettings() {
        return {
            _v: 1,
            f2pool: { enabled: false, workerUrl: '', username: '' },
            useFleetData: false
        };
    }

    function saveSettings(settings) {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch(e) {}
        if (typeof SyncEngine !== 'undefined') SyncEngine.save('settings', settings);
    }

    // --- Mock Data ---
    function getMockMiners() {
        return [
            { id: 'mock_1', model: 'Antminer S21 XP Hyd.', hashrate: 335, power: 5.36, cost: 15000, quantity: 3, status: 'online', dateAdded: new Date().toISOString() },
            { id: 'mock_2', model: 'Antminer S21', hashrate: 200, power: 3.55, cost: 8000, quantity: 2, status: 'online', dateAdded: new Date().toISOString() },
            { id: 'mock_3', model: 'WhatsMiner M60S', hashrate: 186, power: 3.44, cost: 6000, quantity: 1, status: 'offline', dateAdded: new Date().toISOString() }
        ];
    }

    function hasMockData() {
        var fleet = getFleet();
        return fleet.miners.length === 0;
    }

    return {
        getFleet: getFleet,
        saveFleet: saveFleet,
        addMiner: addMiner,
        updateMiner: updateMiner,
        removeMiner: removeMiner,
        reduceQuantity: reduceQuantity,
        getFleetSummary: getFleetSummary,
        getSettings: getSettings,
        saveSettings: saveSettings,
        getMockMiners: getMockMiners,
        hasMockData: hasMockData
    };
})();
