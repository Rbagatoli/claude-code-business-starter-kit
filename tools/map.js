// ===== ION MINING GROUP — Fleet Map =====
initNav('map');

(function() {
    var fleet = FleetData.getFleet();
    var miners = fleet.miners || [];

    // Group miners by location (country + state)
    var locations = {};
    var unmappedCount = 0;

    for (var i = 0; i < miners.length; i++) {
        var m = miners[i];
        if (!m.country) { unmappedCount++; continue; }

        var key = m.country + '|' + (m.state || '');
        if (!locations[key]) {
            locations[key] = {
                country: m.country,
                state: m.state || '',
                miners: [],
                totalHashrate: 0,
                totalPower: 0,
                onlineCount: 0,
                offlineCount: 0,
                models: {}
            };
        }
        var loc = locations[key];
        var qty = parseInt(m.quantity) || 1;
        var hr = (parseFloat(m.hashrate) || 0) * qty;
        var pw = (parseFloat(m.power) || 0) * qty;

        loc.miners.push(m);
        loc.totalHashrate += hr;
        loc.totalPower += pw;
        if (m.status === 'online') loc.onlineCount += qty;
        else loc.offlineCount += qty;

        var modelName = m.model || 'Unknown';
        if (!loc.models[modelName]) loc.models[modelName] = 0;
        loc.models[modelName] += qty;
    }

    var locKeys = Object.keys(locations);

    // Sort by hashrate descending
    locKeys.sort(function(a, b) {
        return locations[b].totalHashrate - locations[a].totalHashrate;
    });

    // Init Leaflet map
    var map = L.map('fleetMap', {
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        maxZoom: 10,
        zoomControl: false,
        attributionControl: false
    });

    // CartoDB Dark Matter tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Custom attribution
    L.control.attribution({ position: 'bottomright', prefix: false })
        .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a> &copy; <a href="https://carto.com/" target="_blank">CARTO</a>')
        .addTo(map);

    // Zoom control on the right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Find max hashrate for scaling
    var maxHashrate = 0;
    for (var k = 0; k < locKeys.length; k++) {
        if (locations[locKeys[k]].totalHashrate > maxHashrate) {
            maxHashrate = locations[locKeys[k]].totalHashrate;
        }
    }

    // Place markers
    var markers = [];
    for (var j = 0; j < locKeys.length; j++) {
        var loc = locations[locKeys[j]];
        var centroid = GEO_DATA.getCentroid(loc.country, loc.state);
        if (!centroid) continue;

        // Scale radius by hashrate (min 8, max 40)
        var ratio = maxHashrate > 0 ? loc.totalHashrate / maxHashrate : 0.5;
        var radius = 8 + ratio * 32;

        var totalMiners = loc.onlineCount + loc.offlineCount;
        var efficiency = loc.totalHashrate > 0 ? (loc.totalPower / loc.totalHashrate).toFixed(1) : '--';
        var countryName = GEO_DATA.getCountryName(loc.country) || loc.country;
        var locationName = loc.state ? (loc.state + ', ' + countryName) : countryName;

        // Model breakdown HTML
        var modelHtml = '';
        var modelKeys = Object.keys(loc.models);
        modelKeys.sort(function(a, b) { return loc.models[b] - loc.models[a]; });
        for (var mk = 0; mk < modelKeys.length; mk++) {
            modelHtml += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;padding:2px 0;">' +
                '<span>' + modelKeys[mk] + '</span><span style="color:#e8e8e8;">' + loc.models[modelKeys[mk]] + '</span></div>';
        }

        var popupContent =
            '<div class="map-popup-container">' +
                '<div class="map-popup-title">' + locationName + '</div>' +
                '<div class="map-popup-stats">' +
                    '<div class="map-popup-stat"><span class="map-popup-label">Miners</span><span class="map-popup-value">' + totalMiners + '</span></div>' +
                    '<div class="map-popup-stat"><span class="map-popup-label">Hashrate</span><span class="map-popup-value">' + loc.totalHashrate.toLocaleString() + ' TH/s</span></div>' +
                    '<div class="map-popup-stat"><span class="map-popup-label">Power</span><span class="map-popup-value">' + loc.totalPower.toLocaleString() + ' W</span></div>' +
                    '<div class="map-popup-stat"><span class="map-popup-label">Efficiency</span><span class="map-popup-value">' + efficiency + ' J/TH</span></div>' +
                    '<div class="map-popup-stat"><span class="map-popup-label">Online</span><span class="map-popup-value" style="color:#4ade80;">' + loc.onlineCount + '</span></div>' +
                    '<div class="map-popup-stat"><span class="map-popup-label">Offline</span><span class="map-popup-value" style="color:#ef4444;">' + loc.offlineCount + '</span></div>' +
                '</div>' +
                (modelHtml ? '<div class="map-popup-models"><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">Models</div>' + modelHtml + '</div>' : '') +
            '</div>';

        var circle = L.circleMarker([centroid.lat, centroid.lng], {
            radius: radius,
            fillColor: '#f7931a',
            fillOpacity: 0.35,
            color: '#f7931a',
            weight: 2,
            opacity: 0.8
        });

        circle.bindPopup(popupContent, {
            className: 'map-popup-leaflet',
            maxWidth: 280,
            minWidth: 200
        });

        circle.bindTooltip(locationName + ' (' + totalMiners + ' miners)', {
            className: 'map-tooltip-leaflet',
            direction: 'top',
            offset: [0, -radius]
        });

        circle.addTo(map);
        markers.push(circle);
    }

    // Auto-fit bounds
    if (markers.length > 0) {
        var group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.3));
    }

    // Update summary metrics
    var totalMapped = 0;
    var totalHashrate = 0;
    var totalOnline = 0;
    var totalOffline = 0;

    for (var s = 0; s < locKeys.length; s++) {
        var l = locations[locKeys[s]];
        totalMapped += l.onlineCount + l.offlineCount;
        totalHashrate += l.totalHashrate;
        totalOnline += l.onlineCount;
        totalOffline += l.offlineCount;
    }

    document.getElementById('mapLocations').textContent = locKeys.length;
    document.getElementById('mapMiners').textContent = totalMapped;
    document.getElementById('mapHashrate').textContent = totalHashrate > 0 ? totalHashrate.toLocaleString() : '--';

    if (locKeys.length > 0) {
        var top = locations[locKeys[0]];
        var topCountryName = GEO_DATA.getCountryName(top.country) || top.country;
        var topName = top.state ? top.state : topCountryName;
        document.getElementById('mapTopLocation').textContent = topName;
        document.getElementById('mapTopLocationSub').textContent = top.totalHashrate.toLocaleString() + ' TH/s';
    }

    var onlineRate = totalMapped > 0 ? ((totalOnline / totalMapped) * 100).toFixed(0) + '%' : '--';
    document.getElementById('mapOnlineRate').textContent = onlineRate;

    // Render location breakdown table
    var tbody = document.getElementById('locationTableBody');
    if (locKeys.length > 0) {
        var html = '';
        for (var t = 0; t < locKeys.length; t++) {
            var loc = locations[locKeys[t]];
            var countryName = GEO_DATA.getCountryName(loc.country) || loc.country;
            var locName = loc.state ? (loc.state + ', ' + countryName) : countryName;
            var minerCount = loc.onlineCount + loc.offlineCount;
            var eff = loc.totalHashrate > 0 ? (loc.totalPower / loc.totalHashrate).toFixed(1) + ' J/TH' : '--';
            var onlinePct = minerCount > 0 ? ((loc.onlineCount / minerCount) * 100).toFixed(0) + '%' : '--';

            html += '<tr>' +
                '<td style="text-align:left">' + locName + '</td>' +
                '<td style="text-align:right">' + minerCount + '</td>' +
                '<td style="text-align:right">' + loc.totalHashrate.toLocaleString() + ' TH/s</td>' +
                '<td style="text-align:right">' + loc.totalPower.toLocaleString() + ' W</td>' +
                '<td style="text-align:right">' + eff + '</td>' +
                '<td style="text-align:right"><span style="color:' + (onlinePct === '100%' ? '#4ade80' : '#fbbf24') + '">' + onlinePct + '</span></td>' +
                '</tr>';
        }
        tbody.innerHTML = html;
    }

    // Handle empty state
    if (locKeys.length === 0) {
        document.getElementById('fleetMap').innerHTML =
            '<div style="display:flex;align-items:center;justify-content:center;height:100%;text-align:center;color:#555;flex-direction:column;gap:8px;">' +
                '<div style="font-size:36px;opacity:0.4;">&#127758;</div>' +
                '<p style="font-size:14px;color:#888;">No miners with locations assigned</p>' +
                '<p style="font-size:12px;color:#555;">Add a country and state when creating miners on the Dashboard</p>' +
            '</div>';
    }
})();
