// ===== ION MINING GROUP — Miner Hardware Database =====

var MinerDB = (function() {

    // ===== DATABASE =====
    // Specs: hashrate (TH/s), power (kW), cost (USD approx.), efficiency (J/TH)
    var database = [
        // --- Bitmain Antminer S21 Series ---
        { model: 'Antminer S21 XP Hyd.',  hashrate: 473, power: 5.676, cost: 13500, efficiency: 12.0 },
        { model: 'Antminer S21+ Hyd.',    hashrate: 395, power: 5.925, cost: 2649,  efficiency: 15.0 },
        { model: 'Antminer S21 Hyd.',     hashrate: 335, power: 5.360, cost: 9000,  efficiency: 16.0 },
        { model: 'Antminer S21e Hyd.',    hashrate: 332, power: 5.644, cost: 2070,  efficiency: 17.0 },
        { model: 'Antminer S21 XP',       hashrate: 270, power: 3.645, cost: 3010,  efficiency: 13.5 },
        { model: 'Antminer S21 Pro',      hashrate: 234, power: 3.510, cost: 4260,  efficiency: 15.0 },
        { model: 'Antminer S21+',         hashrate: 216, power: 3.564, cost: 2204,  efficiency: 16.5 },
        { model: 'Antminer S21',          hashrate: 200, power: 3.500, cost: 3200,  efficiency: 17.5 },

        // --- Bitmain Antminer T21 Series ---
        { model: 'Antminer T21',          hashrate: 190, power: 3.610, cost: 2394,  efficiency: 19.0 },

        // --- Bitmain Antminer S19 Series ---
        { model: 'Antminer S19 XP Hyd.',  hashrate: 257, power: 5.345, cost: 6000,  efficiency: 20.8 },
        { model: 'Antminer S19 XP',       hashrate: 140, power: 3.010, cost: 2500,  efficiency: 21.5 },
        { model: 'Antminer S19k Pro',     hashrate: 120, power: 2.760, cost: 3000,  efficiency: 23.0 },
        { model: 'Antminer S19j Pro+',    hashrate: 120, power: 3.300, cost: 2400,  efficiency: 27.5 },
        { model: 'Antminer S19 Pro',      hashrate: 110, power: 3.250, cost: 2200,  efficiency: 29.5 },

        // --- MicroBT Whatsminer M60/M66 Series ---
        { model: 'Whatsminer M66S++',     hashrate: 348, power: 5.394, cost: 12500, efficiency: 15.5 },
        { model: 'Whatsminer M66S+',      hashrate: 318, power: 5.406, cost: 11500, efficiency: 17.0 },
        { model: 'Whatsminer M66S',       hashrate: 298, power: 5.513, cost: 10500, efficiency: 18.5 },
        { model: 'Whatsminer M60S++',     hashrate: 220, power: 3.410, cost: 6500,  efficiency: 15.5 },
        { model: 'Whatsminer M60S',       hashrate: 186, power: 3.441, cost: 5250,  efficiency: 18.5 },
        { model: 'Whatsminer M60',        hashrate: 172, power: 3.422, cost: 4650,  efficiency: 19.9 },

        // --- MicroBT Whatsminer M50 Series ---
        { model: 'Whatsminer M56S++',     hashrate: 254, power: 5.588, cost: 8000,  efficiency: 22.0 },
        { model: 'Whatsminer M50S++',     hashrate: 160, power: 3.520, cost: 4000,  efficiency: 22.0 },
        { model: 'Whatsminer M50S',       hashrate: 128, power: 3.328, cost: 3150,  efficiency: 26.0 },

        // --- Canaan Avalon Series ---
        { model: 'Avalon A1566I',         hashrate: 261, power: 4.500, cost: 4385,  efficiency: 17.2 },
        { model: 'Avalon A15 Pro',        hashrate: 221, power: 3.662, cost: 3403,  efficiency: 16.6 },
        { model: 'Avalon A1566',          hashrate: 185, power: 3.420, cost: 2276,  efficiency: 18.5 },
        { model: 'Avalon A1466',          hashrate: 150, power: 3.230, cost: 2750,  efficiency: 21.5 },
        { model: 'Avalon A1446',          hashrate: 135, power: 3.310, cost: 2450,  efficiency: 24.5 }
    ];

    function search(query) {
        if (!query || query.length < 1) return [];
        var q = query.toLowerCase();
        return database.filter(function(m) {
            return m.model.toLowerCase().indexOf(q) !== -1;
        });
    }

    function getAll() {
        return database.slice();
    }

    function findByModel(modelName) {
        for (var i = 0; i < database.length; i++) {
            if (database[i].model === modelName) return database[i];
        }
        return null;
    }

    return {
        search: search,
        getAll: getAll,
        findByModel: findByModel
    };
})();
