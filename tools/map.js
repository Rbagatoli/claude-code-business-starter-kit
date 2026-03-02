// ===== ION MINING GROUP — Fleet Map (Choropleth + Globe) =====
initNav('map');

// Always start on globe view (no localStorage persistence for default)

// ISO 3166-1 numeric → alpha-2 mapping (world-atlas uses numeric IDs)
var NUM_TO_A2 = {
    '004':'AF','008':'AL','010':'AQ','012':'DZ','016':'AS','020':'AD','024':'AO',
    '028':'AG','031':'AZ','032':'AR','036':'AU','040':'AT','044':'BS','048':'BH',
    '050':'BD','051':'AM','052':'BB','056':'BE','060':'BM','064':'BT','068':'BO',
    '070':'BA','072':'BW','076':'BR','084':'BZ','086':'IO','090':'SB','092':'VG',
    '096':'BN','100':'BG','104':'MM','108':'BI','112':'BY','116':'KH','120':'CM',
    '124':'CA','132':'CV','136':'KY','140':'CF','144':'LK','148':'TD','152':'CL',
    '156':'CN','158':'TW','162':'CX','166':'CC','170':'CO','174':'KM','175':'YT',
    '178':'CG','180':'CD','184':'CK','188':'CR','191':'HR','192':'CU','196':'CY',
    '203':'CZ','204':'BJ','208':'DK','212':'DM','214':'DO','218':'EC','222':'SV',
    '226':'GQ','231':'ET','232':'ER','233':'EE','234':'FO','238':'FK','242':'FJ',
    '246':'FI','250':'FR','254':'GF','258':'PF','260':'TF','262':'DJ','266':'GA',
    '268':'GE','270':'GM','275':'PS','276':'DE','288':'GH','292':'GI','296':'KI',
    '300':'GR','304':'GL','308':'GD','312':'GP','316':'GU','320':'GT','324':'GN',
    '328':'GY','332':'HT','336':'VA','340':'HN','344':'HK','348':'HU','352':'IS',
    '356':'IN','360':'ID','364':'IR','368':'IQ','372':'IE','376':'IL','380':'IT',
    '384':'CI','388':'JM','392':'JP','398':'KZ','400':'JO','404':'KE','408':'KP',
    '410':'KR','414':'KW','417':'KG','418':'LA','422':'LB','426':'LS','428':'LV',
    '430':'LR','434':'LY','438':'LI','440':'LT','442':'LU','446':'MO','450':'MG',
    '454':'MW','458':'MY','462':'MV','466':'ML','470':'MT','474':'MQ','478':'MR',
    '480':'MU','484':'MX','492':'MC','496':'MN','498':'MD','499':'ME','500':'MS',
    '504':'MA','508':'MZ','512':'OM','516':'NA','520':'NR','524':'NP','528':'NL',
    '531':'CW','533':'AW','534':'SX','540':'NC','548':'VU','554':'NZ','558':'NI',
    '562':'NE','566':'NG','570':'NU','574':'NF','578':'NO','580':'MP','583':'FM',
    '584':'MH','585':'PW','586':'PK','591':'PA','598':'PG','600':'PY','604':'PE',
    '608':'PH','612':'PN','616':'PL','620':'PT','624':'GW','626':'TL','630':'PR',
    '634':'QA','638':'RE','642':'RO','643':'RU','646':'RW','652':'BL','654':'SH',
    '659':'KN','660':'AI','662':'LC','663':'MF','666':'PM','670':'VC','674':'SM',
    '678':'ST','682':'SA','686':'SN','688':'RS','690':'SC','694':'SL','702':'SG',
    '703':'SK','704':'VN','705':'SI','706':'SO','710':'ZA','716':'ZW','720':'YE',
    '724':'ES','728':'SS','729':'SD','732':'EH','740':'SR','744':'SJ','748':'SZ',
    '752':'SE','756':'CH','760':'SY','762':'TJ','764':'TH','768':'TG','772':'TK',
    '776':'TO','780':'TT','784':'AE','788':'TN','792':'TR','795':'TM','796':'TC',
    '798':'TV','800':'UG','804':'UA','807':'MK','818':'EG','826':'GB','831':'GG',
    '832':'JE','833':'IM','834':'TZ','840':'US','850':'VI','854':'BF','858':'UY',
    '860':'UZ','862':'VE','876':'WF','882':'WS','887':'YE','894':'ZM',
    '-99':'XK'
};

// ===== SHARED DATA AGGREGATION =====
var fleet = FleetData.getFleet();
var miners = fleet.miners || [];

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
            models: {},
            weightedElecSum: 0,
            totalPowerWeight: 0
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

    var elecVal = (m.elecCost !== null && m.elecCost !== undefined) ? m.elecCost : (fleet.defaults ? fleet.defaults.elecCost : 0.07);
    loc.weightedElecSum += elecVal * pw;
    loc.totalPowerWeight += pw;

    var modelName = m.model || 'Unknown';
    if (!loc.models[modelName]) loc.models[modelName] = 0;
    loc.models[modelName] += qty;
}

var locKeys = Object.keys(locations);
locKeys.sort(function(a, b) {
    return locations[b].totalHashrate - locations[a].totalHashrate;
});

var countryData = {};
for (var ci = 0; ci < locKeys.length; ci++) {
    var loc = locations[locKeys[ci]];
    var cc = loc.country;
    if (!countryData[cc]) {
        countryData[cc] = { totalHashrate: 0, totalPower: 0, onlineCount: 0, offlineCount: 0, models: {}, weightedElecSum: 0, totalPowerWeight: 0 };
    }
    var cd = countryData[cc];
    cd.totalHashrate += loc.totalHashrate;
    cd.totalPower += loc.totalPower;
    cd.onlineCount += loc.onlineCount;
    cd.offlineCount += loc.offlineCount;
    cd.weightedElecSum += loc.weightedElecSum;
    cd.totalPowerWeight += loc.totalPowerWeight;
    var mk = Object.keys(loc.models);
    for (var mi = 0; mi < mk.length; mi++) {
        if (!cd.models[mk[mi]]) cd.models[mk[mi]] = 0;
        cd.models[mk[mi]] += loc.models[mk[mi]];
    }
}

var maxCountryHash = 0;
var globalTotalHashrate = 0;
var countryKeys = Object.keys(countryData);
for (var ck = 0; ck < countryKeys.length; ck++) {
    var ckHash = countryData[countryKeys[ck]].totalHashrate;
    if (ckHash > maxCountryHash) maxCountryHash = ckHash;
    globalTotalHashrate += ckHash;
}

// ===== SHARED POPUP BUILDERS =====
function buildPieChart(currentA2) {
    if (globalTotalHashrate <= 0) return '';

    var entries = [];
    for (var k = 0; k < countryKeys.length; k++) {
        entries.push({ code: countryKeys[k], hash: countryData[countryKeys[k]].totalHashrate });
    }
    entries.sort(function(a, b) { return b.hash - a.hash; });

    var slices = [];
    var otherHash = 0;
    for (var e = 0; e < entries.length; e++) {
        if (e < 5) {
            slices.push({ label: entries[e].code, value: entries[e].hash, isCurrent: entries[e].code === currentA2 });
        } else {
            otherHash += entries[e].hash;
        }
    }
    if (otherHash > 0) {
        slices.push({ label: 'Other', value: otherHash, isCurrent: false });
    }

    var currentInSlices = false;
    for (var cs = 0; cs < slices.length; cs++) {
        if (slices[cs].isCurrent) { currentInSlices = true; break; }
    }
    if (!currentInSlices && countryData[currentA2]) {
        var curHash = countryData[currentA2].totalHashrate;
        for (var os = 0; os < slices.length; os++) {
            if (slices[os].label === 'Other') {
                slices[os].value -= curHash;
                if (slices[os].value <= 0) slices.splice(os, 1);
                break;
            }
        }
        var bumped = slices.length > 5 ? slices.splice(4, 1)[0] : null;
        if (bumped) {
            for (var bs = 0; bs < slices.length; bs++) {
                if (slices[bs].label === 'Other') { slices[bs].value += bumped.value; break; }
            }
        }
        slices.push({ label: currentA2, value: curHash, isCurrent: true });
    }

    var mutedColors = ['#555', '#4a4a4a', '#3f3f3f', '#353535', '#2a2a2a', '#333'];
    var cx = 50, cy = 50, r = 38;
    var startAngle = -Math.PI / 2;
    var paths = '';
    var legendHtml = '';

    for (var s = 0; s < slices.length; s++) {
        var slice = slices[s];
        var pct = slice.value / globalTotalHashrate;
        var angle = pct * 2 * Math.PI;
        var endAngle = startAngle + angle;
        var fill = slice.isCurrent ? '#f7931a' : mutedColors[s % mutedColors.length];

        if (pct >= 0.9999) {
            paths += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '" stroke="#111" stroke-width="0.5"/>';
        } else if (pct > 0.001) {
            var x1 = cx + r * Math.cos(startAngle);
            var y1 = cy + r * Math.sin(startAngle);
            var x2 = cx + r * Math.cos(endAngle);
            var y2 = cy + r * Math.sin(endAngle);
            var largeArc = angle > Math.PI ? 1 : 0;

            paths += '<path d="M' + cx + ',' + cy + ' L' + x1.toFixed(2) + ',' + y1.toFixed(2) +
                ' A' + r + ',' + r + ' 0 ' + largeArc + ',1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) +
                ' Z" fill="' + fill + '" stroke="#111" stroke-width="0.5"/>';
        }

        startAngle = endAngle;

        var displayLabel = slice.label === 'Other' ? 'Other' : (GEO_DATA.getCountryName(slice.label) || slice.label);
        if (displayLabel.length > 12) displayLabel = slice.label;
        var pctText = (pct * 100).toFixed(1) + '%';
        var labelColor = slice.isCurrent ? '#f7931a' : '#999';
        legendHtml += '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:' + labelColor + ';">' +
            '<span style="width:8px;height:8px;border-radius:50%;background:' + fill + ';flex-shrink:0;"></span>' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + displayLabel + '</span>' +
            '<span style="font-weight:600;">' + pctText + '</span></div>';
    }

    var currentPct = countryData[currentA2] ? ((countryData[currentA2].totalHashrate / globalTotalHashrate) * 100).toFixed(1) : '0.0';
    var pieMobile = window.innerWidth <= 600;
    var pieSize = pieMobile ? 50 : 70;

    return '<div style="padding-top:' + (pieMobile ? '6' : '10') + 'px;margin-top:' + (pieMobile ? '4' : '8') + 'px;border-top:1px solid rgba(255,255,255,0.08);">' +
        '<div style="font-size:' + (pieMobile ? '9' : '10') + 'px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:' + (pieMobile ? '4' : '6') + 'px;">Fleet Share</div>' +
        '<div style="display:flex;align-items:flex-start;gap:' + (pieMobile ? '6' : '10') + 'px;">' +
            '<svg viewBox="0 0 100 100" width="' + pieSize + '" height="' + pieSize + '" style="flex-shrink:0;">' + paths + '</svg>' +
            '<div style="display:flex;flex-direction:column;gap:' + (pieMobile ? '2' : '3') + 'px;min-width:0;flex:1;padding-top:2px;">' + legendHtml + '</div>' +
        '</div>' +
        '<div style="text-align:center;font-size:' + (pieMobile ? '10' : '11') + 'px;color:#f7931a;margin-top:' + (pieMobile ? '4' : '6') + 'px;font-weight:600;">' + currentPct + '% of fleet hashrate</div>' +
    '</div>';
}

function buildPopup(a2, data) {
    var countryName = GEO_DATA.getCountryName(a2) || a2;
    var totalMiners = data.onlineCount + data.offlineCount;
    var efficiency = data.totalHashrate > 0 ? ((data.totalPower * 1000) / data.totalHashrate).toFixed(1) : '--';
    var avgElecCost = data.totalPowerWeight > 0 ? (data.weightedElecSum / data.totalPowerWeight).toFixed(3) : '--';

    var modelHtml = '';
    var modelKeys = Object.keys(data.models);
    modelKeys.sort(function(a, b) { return data.models[b] - data.models[a]; });
    for (var mk = 0; mk < modelKeys.length; mk++) {
        modelHtml += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;padding:2px 0;">' +
            '<span>' + modelKeys[mk] + '</span><span style="color:#e8e8e8;">' + data.models[modelKeys[mk]] + '</span></div>';
    }

    return '<div class="map-popup-container">' +
        '<div class="map-popup-title">' + countryName + '</div>' +
        '<div class="map-popup-stats">' +
            '<div class="map-popup-stat"><span class="map-popup-label">Miners</span><span class="map-popup-value">' + totalMiners + '</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Hashrate</span><span class="map-popup-value">' + data.totalHashrate.toLocaleString() + ' TH/s</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Power</span><span class="map-popup-value">' + data.totalPower.toLocaleString() + ' kW</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Efficiency</span><span class="map-popup-value">' + efficiency + ' J/TH</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Avg. Elec. Cost</span><span class="map-popup-value" style="color:#f7931a;">$' + avgElecCost + '/kWh</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Online</span><span class="map-popup-value" style="color:#4ade80;">' + data.onlineCount + '</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Offline</span><span class="map-popup-value" style="color:#ef4444;">' + data.offlineCount + '</span></div>' +
        '</div>' +
        (modelHtml ? '<div class="map-popup-models"><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">Models</div>' + modelHtml + '</div>' : '') +
        buildPieChart(a2) +
    '</div>';
}

function buildStatePopup(loc) {
    var countryName = GEO_DATA.getCountryName(loc.country) || loc.country;
    var stateName = loc.state + ', ' + countryName;
    var stateMiners = loc.onlineCount + loc.offlineCount;
    var stateEff = loc.totalHashrate > 0 ? ((loc.totalPower * 1000) / loc.totalHashrate).toFixed(1) : '--';
    var avgElecCost = loc.totalPowerWeight > 0 ? (loc.weightedElecSum / loc.totalPowerWeight).toFixed(3) : '--';

    var stateModelHtml = '';
    var smKeys = Object.keys(loc.models);
    smKeys.sort(function(a, b) { return loc.models[b] - loc.models[a]; });
    for (var smk = 0; smk < smKeys.length; smk++) {
        stateModelHtml += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;padding:2px 0;">' +
            '<span>' + smKeys[smk] + '</span><span style="color:#e8e8e8;">' + loc.models[smKeys[smk]] + '</span></div>';
    }

    return '<div class="map-popup-container">' +
        '<div class="map-popup-title">' + stateName + '</div>' +
        '<div class="map-popup-stats">' +
            '<div class="map-popup-stat"><span class="map-popup-label">Miners</span><span class="map-popup-value">' + stateMiners + '</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Hashrate</span><span class="map-popup-value">' + loc.totalHashrate.toLocaleString() + ' TH/s</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Power</span><span class="map-popup-value">' + loc.totalPower.toLocaleString() + ' kW</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Efficiency</span><span class="map-popup-value">' + stateEff + ' J/TH</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Avg. Elec. Cost</span><span class="map-popup-value" style="color:#f7931a;">$' + avgElecCost + '/kWh</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Online</span><span class="map-popup-value" style="color:#4ade80;">' + loc.onlineCount + '</span></div>' +
            '<div class="map-popup-stat"><span class="map-popup-label">Offline</span><span class="map-popup-value" style="color:#ef4444;">' + loc.offlineCount + '</span></div>' +
        '</div>' +
        (stateModelHtml ? '<div class="map-popup-models"><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">Models</div>' + stateModelHtml + '</div>' : '') +
    '</div>';
}

// ===== LEAFLET FLAT MAP =====
var leafletMap, leafletGeoLayer, leafletStateMarkers = {};
(function() {
    var map = L.map('fleetMap', {
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        maxZoom: 10,
        zoomControl: false,
        attributionControl: false
    });
    leafletMap = map;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    L.control.attribution({ position: 'bottomright', prefix: false })
        .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a> &copy; <a href="https://carto.com/" target="_blank">CARTO</a>')
        .addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')
        .then(function(r) { return r.json(); })
        .then(function(world) {
            var countriesGeo = topojson.feature(world, world.objects.countries);

            var geoLayer = L.geoJSON(countriesGeo, {
                style: function(feature) {
                    var a2 = NUM_TO_A2[String(feature.id)];
                    var data = a2 ? countryData[a2] : null;

                    if (data && maxCountryHash > 0) {
                        var ratio = data.totalHashrate / maxCountryHash;
                        var opacity = 0.15 + ratio * 0.60;
                        return {
                            fillColor: '#f7931a',
                            fillOpacity: opacity,
                            weight: 1.5,
                            color: 'rgba(247,147,26,0.5)',
                            opacity: 0.7
                        };
                    }
                    return {
                        fillColor: '#f7931a',
                        fillOpacity: 0.02,
                        weight: 0.5,
                        color: '#333',
                        opacity: 0.3
                    };
                },
                onEachFeature: function(feature, layer) {
                    var a2 = NUM_TO_A2[String(feature.id)];
                    var data = a2 ? countryData[a2] : null;
                    if (!data) return;

                    var ratio = maxCountryHash > 0 ? data.totalHashrate / maxCountryHash : 0;
                    var baseOpacity = 0.15 + ratio * 0.60;

                    layer.on('mouseover', function() {
                        layer.setStyle({
                            fillOpacity: Math.min(baseOpacity + 0.15, 0.9),
                            weight: 2,
                            color: 'rgba(247,147,26,0.8)'
                        });
                        if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                            layer.bringToFront();
                        }
                    });

                    layer.on('mouseout', function() {
                        geoLayer.resetStyle(layer);
                    });

                    var countryName = GEO_DATA.getCountryName(a2) || a2;
                    var totalMiners = data.onlineCount + data.offlineCount;
                    layer.bindTooltip(countryName + ' (' + totalMiners + ' miners)', {
                        className: 'map-tooltip-leaflet',
                        direction: 'top',
                        sticky: true
                    });

                    var isMobile = window.innerWidth <= 600;
                    layer.bindPopup(buildPopup(a2, data), {
                        className: 'map-popup-leaflet',
                        maxWidth: isMobile ? 280 : 260,
                        minWidth: isMobile ? 220 : 180
                    });
                }
            }).addTo(map);
            leafletGeoLayer = geoLayer;

            // State-level circle markers
            for (var si = 0; si < locKeys.length; si++) {
                var loc = locations[locKeys[si]];
                if (!loc.state) continue;

                var centroid = GEO_DATA.getCentroid(loc.country, loc.state);
                if (!centroid) continue;

                var stateMiners = loc.onlineCount + loc.offlineCount;
                var stateRatio = maxCountryHash > 0 ? loc.totalHashrate / maxCountryHash : 0.3;
                var stateRadius = 4 + stateRatio * 16;

                var stateMarker = L.circleMarker([centroid.lat, centroid.lng], {
                    radius: Math.max(stateRadius, 4),
                    fillColor: '#fff',
                    fillOpacity: 0.25,
                    color: '#f7931a',
                    weight: 1,
                    opacity: 0.6
                });

                var isMobile = window.innerWidth <= 600;
                stateMarker.bindPopup(buildStatePopup(loc), {
                    className: 'map-popup-leaflet',
                    maxWidth: isMobile ? 280 : 260,
                    minWidth: isMobile ? 220 : 180
                });

                var countryName = GEO_DATA.getCountryName(loc.country) || loc.country;
                var stateName = loc.state + ', ' + countryName;
                stateMarker.bindTooltip(stateName + ' (' + stateMiners + ' miners)', {
                    className: 'map-tooltip-leaflet',
                    direction: 'top',
                    offset: [0, -stateRadius]
                });

                stateMarker.addTo(map);
                leafletStateMarkers[loc.country + '|' + loc.state] = stateMarker;
            }
        })
        .catch(function(err) {
            console.error('Failed to load country boundaries:', err);
        });

    // Empty state overlay for flat map
    if (locKeys.length === 0) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#555;flex-direction:column;gap:8px;z-index:500;pointer-events:none;';
        overlay.innerHTML =
            '<div style="font-size:36px;opacity:0.4;">&#127758;</div>' +
            '<p style="font-size:14px;color:#888;">No miners with locations assigned</p>' +
            '<p style="font-size:12px;color:#555;">Add a country and state when creating miners on the Dashboard</p>';
        var mapContainer = document.getElementById('fleetMap');
        mapContainer.style.position = 'relative';
        mapContainer.appendChild(overlay);
    }
})();

// ===== SUMMARY METRICS + TABLE (shared) =====
(function() {
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

    var tbody = document.getElementById('locationTableBody');
    if (locKeys.length > 0) {
        var html = '';
        for (var t = 0; t < locKeys.length; t++) {
            var loc = locations[locKeys[t]];
            var countryName = GEO_DATA.getCountryName(loc.country) || loc.country;
            var locName = loc.state ? (loc.state + ', ' + countryName) : countryName;
            var minerCount = loc.onlineCount + loc.offlineCount;
            var eff = loc.totalHashrate > 0 ? ((loc.totalPower * 1000) / loc.totalHashrate).toFixed(1) + ' J/TH' : '--';
            var onlinePct = minerCount > 0 ? ((loc.onlineCount / minerCount) * 100).toFixed(0) + '%' : '--';

            html += '<tr data-country="' + loc.country + '" data-state="' + (loc.state || '') + '">' +
                '<td style="text-align:left">' + locName + '</td>' +
                '<td style="text-align:right">' + minerCount + '</td>' +
                '<td style="text-align:right">' + loc.totalHashrate.toLocaleString() + ' TH/s</td>' +
                '<td style="text-align:right">' + loc.totalPower.toLocaleString() + ' kW</td>' +
                '<td style="text-align:right">' + eff + '</td>' +
                '<td style="text-align:right"><span style="color:' + (onlinePct === '100%' ? '#4ade80' : '#fbbf24') + '">' + onlinePct + '</span></td>' +
                '</tr>';
        }
        tbody.innerHTML = html;
    }
})();

// ===== GLOBE VIEW + TOGGLE =====
var _globeRef = null, _showGlobePopupRef = null;
(function() {
    var globeInstance = null;
    var globeInitialized = false;
    var currentView = 'globe';

    var btnMap = document.getElementById('btnMapView');
    var btnGlobe = document.getElementById('btnGlobeView');
    var mapCard = document.getElementById('mapCard');
    var globeCard = document.getElementById('globeCard');

    function setView(view) {
        currentView = view;
        if (view === 'map') {
            mapCard.style.display = '';
            globeCard.style.display = 'none';
            btnMap.classList.add('active');
            btnGlobe.classList.remove('active');
            document.getElementById('globePopup').style.display = 'none';
        } else {
            mapCard.style.display = 'none';
            globeCard.style.display = '';
            btnMap.classList.remove('active');
            btnGlobe.classList.add('active');
            if (!globeInitialized) requestAnimationFrame(function() { initGlobe(); });
        }
    }

    btnMap.addEventListener('click', function() { setView('map'); });
    btnGlobe.addEventListener('click', function() { setView('globe'); });

    if (currentView === 'globe') setView('globe');

    var popupAnimFrame = null;

    _showGlobePopupRef = showGlobePopup;
    function showGlobePopup(html, lat, lng, evt) {
        var popup = document.getElementById('globePopup');
        document.getElementById('globePopupContent').innerHTML = html;
        popup.dataset.lat = lat;
        popup.dataset.lng = lng;
        popup.style.display = 'block';

        // Position at click coordinates immediately (reliable)
        if (evt) {
            popup.style.left = evt.clientX + 'px';
            popup.style.top = evt.clientY + 'px';
        }
        popup.style.opacity = '1';
        popup.style.pointerEvents = 'auto';

        // Start tracking to follow rotation
        if (!popupAnimFrame) startPopupTracking();
    }

    function updatePopupPosition() {
        var popup = document.getElementById('globePopup');
        if (popup.style.display === 'none' || !popup.dataset.lat || !globeInstance) return;

        var lat = parseFloat(popup.dataset.lat);
        var lng = parseFloat(popup.dataset.lng);

        // Try to get screen coordinates for the lat/lng
        var screenCoords;
        try { screenCoords = globeInstance.getScreenCoords(lat, lng, 0.01); } catch(e) {}
        if (!screenCoords || isNaN(screenCoords.x) || isNaN(screenCoords.y)) return;

        // Convert to viewport coordinates using the globe's inner canvas container
        var innerDiv = document.querySelector('#fleetGlobe > div');
        var rect = innerDiv ? innerDiv.getBoundingClientRect() : document.getElementById('fleetGlobe').getBoundingClientRect();
        var vpX = rect.left + screenCoords.x;
        var vpY = rect.top + screenCoords.y;

        // Back-side detection: if projected point is outside the globe's visible circle, hide
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var globeRadius = Math.min(rect.width, rect.height) * 0.42;
        var dist = Math.sqrt((vpX - cx) * (vpX - cx) + (vpY - cy) * (vpY - cy));

        if (dist > globeRadius) {
            popup.style.opacity = '0';
            popup.style.pointerEvents = 'none';
            return;
        }

        popup.style.left = vpX + 'px';
        popup.style.top = vpY + 'px';
        popup.style.opacity = '1';
        popup.style.pointerEvents = 'auto';
    }

    function startPopupTracking() {
        function track() {
            var popup = document.getElementById('globePopup');
            if (popup.style.display === 'none') { popupAnimFrame = null; return; }
            updatePopupPosition();
            popupAnimFrame = requestAnimationFrame(track);
        }
        popupAnimFrame = requestAnimationFrame(track);
    }

    function hideGlobePopup() {
        var popup = document.getElementById('globePopup');
        popup.style.display = 'none';
        if (popupAnimFrame) { cancelAnimationFrame(popupAnimFrame); popupAnimFrame = null; }
    }

    document.getElementById('globePopupClose').addEventListener('click', hideGlobePopup);

    function getGlobeInstance() { return globeInstance; }
    _globeRef = getGlobeInstance;

    function initGlobe() {
        globeInitialized = true;
        var globeContainer = document.getElementById('fleetGlobe');
        var rect = globeContainer.getBoundingClientRect();

        globeInstance = Globe()
            .width(rect.width)
            .height(rect.height)
            .backgroundColor('rgba(0,0,0,0)')
            .showGlobe(true)
            .showAtmosphere(true)
            .atmosphereColor('#f7931a')
            .atmosphereAltitude(0.15);

        fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')
            .then(function(r) { return r.json(); })
            .then(function(world) {
                var countriesGeo = topojson.feature(world, world.objects.countries);

                globeInstance
                    .polygonsData(countriesGeo.features)
                    .polygonCapColor(function(feat) {
                        var a2 = NUM_TO_A2[String(feat.id)];
                        var data = a2 ? countryData[a2] : null;
                        if (data && maxCountryHash > 0) {
                            var ratio = data.totalHashrate / maxCountryHash;
                            var alpha = 0.2 + ratio * 0.8;
                            return 'rgba(247, 147, 26, ' + alpha.toFixed(2) + ')';
                        }
                        return 'rgba(247, 147, 26, 0.03)';
                    })
                    .polygonSideColor(function() { return 'rgba(247, 147, 26, 0.05)'; })
                    .polygonStrokeColor(function(feat) {
                        var a2 = NUM_TO_A2[String(feat.id)];
                        return countryData[a2] ? 'rgba(247, 147, 26, 0.4)' : '#222';
                    })
                    .polygonAltitude(function(feat) {
                        var a2 = NUM_TO_A2[String(feat.id)];
                        var data = a2 ? countryData[a2] : null;
                        if (data && maxCountryHash > 0) {
                            return 0.005 + (data.totalHashrate / maxCountryHash) * 0.02;
                        }
                        return 0.001;
                    })
                    .polygonLabel(function(feat) {
                        var a2 = NUM_TO_A2[String(feat.id)];
                        var data = a2 ? countryData[a2] : null;
                        if (!data) return '';
                        var name = GEO_DATA.getCountryName(a2) || a2;
                        var total = data.onlineCount + data.offlineCount;
                        return '<div class="globe-tooltip">' + name + ' (' + total + ' miners)</div>';
                    })
                    .onPolygonClick(function(feat, evt) {
                        var a2 = NUM_TO_A2[String(feat.id)];
                        var data = a2 ? countryData[a2] : null;
                        if (!data) { hideGlobePopup(); return; }
                        var centroid = GEO_DATA.getCentroid(a2);
                        var pLat = centroid ? centroid.lat : 0;
                        var pLng = centroid ? centroid.lng : 0;
                        showGlobePopup(buildPopup(a2, data), pLat, pLng, evt);
                    })
                    .onPolygonHover(function(hoverFeat) {
                        globeInstance.polygonAltitude(function(feat) {
                            var a2 = NUM_TO_A2[String(feat.id)];
                            var data = a2 ? countryData[a2] : null;
                            var isHovered = feat === hoverFeat;
                            if (data && maxCountryHash > 0) {
                                var base = 0.005 + (data.totalHashrate / maxCountryHash) * 0.02;
                                return isHovered ? base + 0.015 : base;
                            }
                            return isHovered ? 0.008 : 0.001;
                        });
                        globeContainer.style.cursor = hoverFeat && countryData[NUM_TO_A2[String(hoverFeat.id)]] ? 'pointer' : 'default';
                    });

                // State-level point markers
                var statePoints = [];
                for (var si = 0; si < locKeys.length; si++) {
                    var loc = locations[locKeys[si]];
                    if (!loc.state) continue;
                    var centroid = GEO_DATA.getCentroid(loc.country, loc.state);
                    if (!centroid) continue;
                    var stateMiners = loc.onlineCount + loc.offlineCount;
                    var stateRatio = maxCountryHash > 0 ? loc.totalHashrate / maxCountryHash : 0.3;
                    statePoints.push({
                        lat: centroid.lat,
                        lng: centroid.lng,
                        size: 0.15 + stateRatio * 0.5,
                        color: '#f7931a',
                        label: loc.state + ', ' + (GEO_DATA.getCountryName(loc.country) || loc.country),
                        miners: stateMiners,
                        locData: loc
                    });
                }

                globeInstance
                    .pointsData(statePoints)
                    .pointLat('lat')
                    .pointLng('lng')
                    .pointAltitude(0.01)
                    .pointRadius('size')
                    .pointColor('color')
                    .pointLabel(function(d) {
                        return '<div class="globe-tooltip">' + d.label + ' (' + d.miners + ' miners)</div>';
                    })
                    .onPointClick(function(point, evt) {
                        showGlobePopup(buildStatePopup(point.locData), point.lat, point.lng, evt);
                    })
                    .onGlobeClick(function() {
                        hideGlobePopup();
                    });

                globeInstance(globeContainer);

                // Auto-rotate
                globeInstance.controls().autoRotate = true;
                globeInstance.controls().autoRotateSpeed = 0.3;
                globeInstance.controls().enableZoom = true;

                // Pause rotation on interaction, resume after idle
                var idleTimer;
                globeContainer.addEventListener('mousedown', function() {
                    globeInstance.controls().autoRotate = false;
                    clearTimeout(idleTimer);
                });
                globeContainer.addEventListener('touchstart', function() {
                    globeInstance.controls().autoRotate = false;
                    clearTimeout(idleTimer);
                }, { passive: true });
                globeContainer.addEventListener('mouseup', function() {
                    idleTimer = setTimeout(function() { globeInstance.controls().autoRotate = true; }, 8000);
                });
                globeContainer.addEventListener('touchend', function() {
                    idleTimer = setTimeout(function() { globeInstance.controls().autoRotate = true; }, 8000);
                });

                // Click anywhere in globe card (including background) dismisses popup
                globeContainer.addEventListener('click', function(e) {
                    if (!document.getElementById('globePopup').contains(e.target)) {
                        hideGlobePopup();
                    }
                });

                // Center on top mining location
                if (locKeys.length > 0) {
                    var topLoc = locations[locKeys[0]];
                    var topCentroid = GEO_DATA.getCentroid(topLoc.country, topLoc.state);
                    if (topCentroid) {
                        globeInstance.pointOfView({ lat: topCentroid.lat, lng: topCentroid.lng, altitude: 2.0 }, 1000);
                    }
                }
            })
            .catch(function(err) {
                console.error('Failed to load globe data:', err);
            });

        // Empty state for globe
        if (locKeys.length === 0) {
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#555;flex-direction:column;gap:8px;z-index:500;pointer-events:none;';
            overlay.innerHTML =
                '<div style="font-size:36px;opacity:0.4;">&#127758;</div>' +
                '<p style="font-size:14px;color:#888;">No miners with locations assigned</p>' +
                '<p style="font-size:12px;color:#555;">Add a country and state when creating miners on the Dashboard</p>';
            globeContainer.style.position = 'relative';
            globeContainer.appendChild(overlay);
        }
    }
})();

// ===== LOCATION TABLE CLICK → CENTER + POPUP =====
(function() {
    var tbody = document.getElementById('locationTableBody');
    tbody.addEventListener('click', function(e) {
        var row = e.target.closest('tr');
        if (!row || !row.dataset.country) return;

        var country = row.dataset.country;
        var state = row.dataset.state || '';
        var centroid = GEO_DATA.getCentroid(country, state || undefined);
        if (!centroid) return;

        var currentView = document.getElementById('globeCard').style.display !== 'none' ? 'globe' : 'map';
        var locKey = country + '|' + state;
        var locData = locations[locKey];

        if (currentView === 'globe') {
            var globe = _globeRef ? _globeRef() : null;
            if (!globe) return;

            globe.pointOfView({ lat: centroid.lat, lng: centroid.lng, altitude: 2.0 }, 1000);

            setTimeout(function() {
                var popupHtml;
                if (state && locData) {
                    popupHtml = buildStatePopup(locData);
                } else if (countryData[country]) {
                    popupHtml = buildPopup(country, countryData[country]);
                }
                if (popupHtml && _showGlobePopupRef) {
                    _showGlobePopupRef(popupHtml, centroid.lat, centroid.lng);
                }
            }, 1100);
        } else {
            if (!leafletMap) return;
            var targetPoint = leafletMap.latLngToContainerPoint([centroid.lat, centroid.lng]);
            targetPoint.y -= 120;
            var offsetLatLng = leafletMap.containerPointToLatLng(targetPoint);
            leafletMap.panTo(offsetLatLng);
            leafletMap.once('moveend', function() {
                var targetLayer = null;
                if (state && leafletStateMarkers[locKey]) {
                    targetLayer = leafletStateMarkers[locKey];
                } else if (leafletGeoLayer) {
                    leafletGeoLayer.eachLayer(function(layer) {
                        if (!layer.feature) return;
                        var a2 = NUM_TO_A2[String(layer.feature.id)];
                        if (a2 === country) targetLayer = layer;
                    });
                }
                if (targetLayer) {
                    var popup = targetLayer.getPopup();
                    if (popup) {
                        popup.options.autoPan = false;
                        targetLayer.openPopup();
                        popup.options.autoPan = true;
                    }
                }
            });
        }
    });
})();
