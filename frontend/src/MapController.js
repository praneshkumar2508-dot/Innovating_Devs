import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const SECTOR_CONFIG = {
  power: { label: 'Power', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.2)' },
  water: { label: 'Water', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.2)' },
  healthcare: { label: 'Healthcare', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.2)' },
  telecom: { label: 'Telecom', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.2)' }
};

const HEALTH_COLORS = {
  HEALTHY: '#10b981',
  STRESSED: '#f59e0b',
  AT_RISK: '#f59e0b',
  FAILED: '#ef4444'
};

const DEPARTMENTS = {
  power: { shortName: 'POWER GRID', helpline: '1912', phone: '1800-425-4444' },
  water: { shortName: 'WATER SUPPLY', helpline: '1916' },
  healthcare: { shortName: 'HEALTH DEPT', helpline: '104' }
};

export class MapController {
    constructor(containerId, cityData, engine) {
        this.containerId = containerId;
        this.cityData = cityData;
        this.engine = engine;
        this.map = null;
        this.markers = new Map();
        this.floodLayer = null;
        this.cascadeLines = [];
        this.dependencyLines = [];
        this.coverageZones = [];
        this.showFlood = false;
        this.showCascade = false;
        this.showDeps = false;
        this.showCoverage = false;
        this.initialized = false;
        this.baseLayers = {};
        this.currentTileLayer = null;
    }

    init() {
        if (this.initialized) {
            this.map.invalidateSize();
            return;
        }

        this.map = L.map(this.containerId, {
            zoomControl: false,
            attributionControl: true,
        }).setView(this.cityData.center, this.cityData.zoom);

        // Zoom control on bottom-right
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        // Add Scale Control
        L.control.scale({ position: 'bottomleft', imperial: false }).addTo(this.map);

        // Add Custom Map Legend
        const legend = L.control({ position: 'bottomleft' });
        legend.onAdd = function (map) {
            const div = L.DomUtil.create('div', 'info legend glass-card p-3 rounded-xl border border-white/10 bg-surface-900/90 text-[10px] text-surface-200 shadow-lg');
            div.innerHTML = `
                <div class="font-bold text-white mb-2 pb-1 border-b border-white/10 text-xs">Map Legend</div>
                <div class="flex items-center gap-2 mb-1.5"><div class="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div> Healthy</div>
                <div class="flex items-center gap-2 mb-1.5"><div class="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div> At Risk</div>
                <div class="flex items-center gap-2 mb-2"><div class="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse"></div> Failed</div>
                <div class="flex items-center gap-2 mb-1.5"><div class="w-4 border-b-2 border-dashed border-brand-400"></div> Animated Data Flow</div>
                <div class="flex items-center gap-2"><div class="w-4 h-4 rounded-full border border-dashed border-emerald-400/50 bg-emerald-400/10"></div> Radar Coverage Zone</div>
            `;
            return div;
        };
        legend.addTo(this.map);

        // Standard dark view
        const darkTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
            maxZoom: 19,
            subdomains: 'abcd',
        });

        // Professional light view
        const lightTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
            maxZoom: 19,
            subdomains: 'abcd',
        });

        // Street view (realistic)
        const streetTile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
        });

        // Satellite-like (Esri World Imagery)
        const satelliteTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri, Maxar, Earthstar Geographics',
            maxZoom: 18,
        });

        // Topographic
        const topoTile = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenTopoMap',
            maxZoom: 17,
        });

        this.baseLayers = {
            '🏢 Professional (Light)': lightTile,
            '🌑 Dark Mode': darkTile,
            '🗺️ Street View': streetTile,
            '🛰️ Satellite View': satelliteTile,
            '🏔️ Topographic': topoTile,
        };

        // Default to highly professional light map for a clean dashboard look
        lightTile.addTo(this.map);
        this.currentTileLayer = lightTile;

        // Layer control
        L.control.layers(this.baseLayers, null, { position: 'topright', collapsed: true }).addTo(this.map);

        // ── Add infrastructure markers ──
        this.cityData.nodes.forEach(node => this._addMarker(node));

        // ── Dependency lines (hidden by default) ──
        this._createDependencyLines();
        
        // ── Hospital Pathways ──
        this._createHospitalPathways();

        // ── Ambient Nearby Hospitals ──
        this._createAmbientClinics();

        // ── Flood zone ──
        if (this.cityData.floodZone) {
            this._createFloodZone();
        }

        // ── Coverage zones ──
        this._createCoverageZones();

        // ── Crew markers ──
        if (this.cityData.crews) {
            this._addCrewMarkers();
        }

        // ── Fit bounds to show all markers ──
        const allLatLngs = this.cityData.nodes.map(n => [n.location.lat, n.location.lng]);
        if (allLatLngs.length > 0) {
            this.map.fitBounds(allLatLngs, { padding: [40, 40] });
        }

        // Show the infrastructure network by default
        this.showDeps = true;
        this.dependencyLines.forEach(l => l.addTo(this.map));

        this.initialized = true;
    }

    _addMarker(nodeData) {
        const node = this.engine.getNode(nodeData.id) || nodeData;
        const sectorCfg = SECTOR_CONFIG[node.sector] || SECTOR_CONFIG.power;
        const healthColor = HEALTH_COLORS[node.health] || '#10b981';
        const isFailed = node.health === "FAILED";
        const isAtRisk = node.health === "AT_RISK" || node.health === "STRESSED";
        const dept = DEPARTMENTS[node.sector];

        let pinHtml = '';

        if (node.sector === 'healthcare') {
            // Determine custom color based on hospital type
            let hospitalColor = '#ef4444'; // default red
            let hospitalGradient = 'linear-gradient(135deg, #ef4444, #991b1b)';
            
            if (node.icon === '🚑') {
                hospitalColor = '#f97316'; // Trauma - Orange
                hospitalGradient = 'linear-gradient(135deg, #f97316, #c2410c)';
            } else if (node.icon === '🔬') {
                hospitalColor = '#a855f7'; // Research - Purple
                hospitalGradient = 'linear-gradient(135deg, #a855f7, #7e22ce)';
            } else if (node.icon === '⚕️') {
                hospitalColor = '#06b6d4'; // Tertiary - Cyan
                hospitalGradient = 'linear-gradient(135deg, #06b6d4, #0e7490)';
            }

            // Innovative specific Hospital animation (Heartbeat Shield)
            pinHtml = `
                <div class="hospital-shield" style="background: ${hospitalGradient}; box-shadow: 0 0 15px ${hospitalColor}80, inset 0 2px 5px rgba(255,255,255,0.4); width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; position: relative;">
                    <span style="font-size: 20px;">${node.icon}</span>
                    <div style="position: absolute; inset: -6px; border: 2px solid ${hospitalColor}; border-radius: 16px; animation: radarPulse 2s linear infinite; opacity: 0.5; pointer-events: none;"></div>
                </div>
            `;
        } else {
            // Professional Color-Coded Pin Marker for other infra
            pinHtml = `
                <div style="
                    position: relative;
                    width: 30px;
                    height: 30px;
                    background-color: ${sectorCfg.color || '#3b91ff'};
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.4);
                    border: 2px solid white;
                ">
                    <span style="transform: rotate(45deg); font-size: 14px; margin-left: 2px; margin-bottom: 2px;">${node.icon}</span>
                    ${isFailed ? `<div style="position:absolute; inset:-4px; border-radius:50%; border: 2px solid #ef4444; animation: pulseRing 1.5s infinite; transform: rotate(45deg);"></div>` : ''}
                </div>
            `;
        }

        const icon = L.divIcon({
            html: pinHtml,
            className: '',
            iconSize: [30, 30],
            iconAnchor: [15, 30], 
            popupAnchor: [0, -30]
        });

        const marker = L.marker([nodeData.location.lat, nodeData.location.lng], { icon }).addTo(this.map);

        // ── Rich Popup ──
        const popupContent = `
            <div style="min-width:260px;max-width:320px;font-family:Inter,sans-serif;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <div style="width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;background:${sectorCfg?.bgColor};border:1px solid ${sectorCfg?.color}30">${node.icon}</div>
                    <div style="flex:1;">
                        <div style="font-weight:800;font-size:14px;color:var(--text-h);">${node.name}</div>
                        <div style="display:flex;gap:6px;margin-top:2px;">
                            <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${healthColor}20;color:${healthColor};font-weight:700;">${node.health}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        marker.bindPopup(popupContent, { maxWidth: 350, className: 'resilience-popup' });
        this.markers.set(nodeData.id, marker);
    }

    _createDependencyLines() {
        this.cityData.edges.forEach(edge => {
            const fromNode = this.cityData.nodes.find(n => n.id === edge.source);
            const toNode = this.cityData.nodes.find(n => n.id === edge.target);
            if (!fromNode || !toNode) return;

            const sectorCfg = SECTOR_CONFIG[fromNode.sector];
            const color = sectorCfg?.color || '#666';

            const style = { dash: '10, 10', weight: 2.5, speed: '1.5s' };
            const coords = [[fromNode.location.lat, fromNode.location.lng], [toNode.location.lat, toNode.location.lng]];

            const baseLine = L.polyline(coords, {
                color: color, weight: style.weight, opacity: 0.15, interactive: false
            });

            const animatedLine = L.polyline(coords, {
                color: '#ff00e6', weight: style.weight, opacity: 1.0, dashArray: style.dash, className: 'animated-dependency-line'
            });

            animatedLine.bindTooltip('Dependency', { sticky: true, className: 'node-tooltip', opacity: 0.95 });

            this.dependencyLines.push(baseLine);
            this.dependencyLines.push(animatedLine);
        });
    }

    _createHospitalPathways() {
        const hospitals = this.cityData.nodes.filter(n => n.sector === 'healthcare');
        if (hospitals.length < 2) return;

        const coords = hospitals.map(h => [h.location.lat, h.location.lng]);
        coords.push([hospitals[0].location.lat, hospitals[0].location.lng]);

        const corridorBase = L.polyline(coords, {
            color: '#ef4444', 
            weight: 8, 
            opacity: 0.15,
            interactive: false
        });

        const corridorPulse = L.polyline(coords, {
            color: '#ffffff',
            weight: 3,
            opacity: 0.9,
            dashArray: '2, 30',
            className: 'pulse-line',
            interactive: false
        });

        const corridorMain = L.polyline(coords, {
            color: '#ef4444',
            weight: 2,
            opacity: 0.8,
            dashArray: '15, 10'
        });

        this.dependencyLines.push(corridorBase);
        this.dependencyLines.push(corridorMain);
        this.dependencyLines.push(corridorPulse);
    }

    _createAmbientClinics() {
        const minLat = 9.910;
        const maxLat = 9.955;
        const minLng = 78.100;
        const maxLng = 78.160;

        if (!this.map.getPane('ambientPane')) {
            this.map.createPane('ambientPane');
            this.map.getPane('ambientPane').style.zIndex = 390; 
        }

        const numClinics = 50;
        
        for (let i = 0; i < numClinics; i++) {
            const lat = minLat + Math.random() * (maxLat - minLat);
            const lng = minLng + Math.random() * (maxLng - minLng);
            const opacity = 0.4 + (Math.random() * 0.6);
            const scale = 0.5 + (Math.random() * 0.5);

            const icon = L.divIcon({
                html: `<div style="
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: ${12 * scale}px; 
                    height: ${12 * scale}px; 
                    background-color: rgba(239, 68, 68, ${opacity});
                    border-radius: 2px;
                    box-shadow: 0 0 5px rgba(239,68,68,0.5);
                ">
                </div>`,
                className: '',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });

            const marker = L.marker([lat, lng], { 
                icon: icon, 
                pane: 'ambientPane',
                interactive: true 
            });

            marker.addTo(this.map);
            this.dependencyLines.push(marker);
        }
    }

    _createCoverageZones() {
        this.cityData.nodes.forEach(node => {
            if (node.sector !== 'healthcare' && node.sector !== 'power' && node.sector !== 'water') return;
            
            const sectorCfg = SECTOR_CONFIG[node.sector] || SECTOR_CONFIG.power;
            const color = sectorCfg.color;
            const radius = 800;

            const innerZone = L.circle([node.location.lat, node.location.lng], {
                color: color,
                fillColor: color,
                fillOpacity: 0.1,
                weight: 1,
                radius: radius * 0.3,
                interactive: false,
                className: 'core-pulse'
            });

            const outerZone = L.circle([node.location.lat, node.location.lng], {
                color: color,
                fillColor: color,
                fillOpacity: 0.03,
                weight: 1.5,
                dashArray: '10,15',
                radius: radius,
                interactive: false,
                className: 'radar-breathe'
            });

            this.coverageZones.push({ inner: innerZone, outer: outerZone });
        });
    }

    _createFloodZone() {}
    _addCrewMarkers() {}

    _drawCascadeLines() {
        this.cascadeLines.forEach(l => this.map.removeLayer(l));
        this.cascadeLines = [];

        const failedNodes = this.engine.getAllNodes().filter(n => n.health === "FAILED" || n.health === "AT_RISK");
        const cascadeEdges = this.cityData.edges.filter(e =>
            failedNodes.some(n => n.id === e.source) || failedNodes.some(n => n.id === e.target)
        );

        cascadeEdges.forEach(edge => {
            const fromNode = this.cityData.nodes.find(n => n.id === edge.source);
            const toNode = this.cityData.nodes.find(n => n.id === edge.target);
            if (!fromNode || !toNode || !fromNode.location || !toNode.location) return;

            const line = L.polyline(
                [[fromNode.location.lat, fromNode.location.lng], [toNode.location.lat, toNode.location.lng]],
                { color: '#ff0000', weight: 6, opacity: 1.0, dashArray: '10,10', className: 'error-pulse-line' }
            ).addTo(this.map);

            const midLat = (fromNode.location.lat + toNode.location.lat) / 2;
            const midLng = (fromNode.location.lng + toNode.location.lng) / 2;
            const arrowIcon = L.divIcon({
                html: '<div style="color:#ff0000;font-size:14px;font-weight:900;text-shadow:0 0 10px rgba(255,0,0,1);">⚡</div>',
                className: '',
                iconSize: [16, 16],
                iconAnchor: [8, 8],
            });
            const arrowMarker = L.marker([midLat, midLng], { icon: arrowIcon }).addTo(this.map);

            this.cascadeLines.push(line);
            this.cascadeLines.push(arrowMarker);
        });

        failedNodes.forEach(failedNode => {
            if (failedNode.health !== 'FAILED') return;
            const healthySameSector = this.cityData.nodes.filter(n => n.health === 'HEALTHY' && n.sector === failedNode.sector);
            if (healthySameSector.length === 0) return;
            
            let nearest = healthySameSector[0];
            let minDistance = Infinity;
            healthySameSector.forEach(hn => {
                const d = Math.pow(hn.location.lat - failedNode.location.lat, 2) + Math.pow(hn.location.lng - failedNode.location.lng, 2);
                if (d < minDistance) {
                    minDistance = d;
                    nearest = hn;
                }
            });

            const analysisLine = L.polyline(
                [[failedNode.location.lat, failedNode.location.lng], [nearest.location.lat, nearest.location.lng]],
                { color: '#39ff14', weight: 5, opacity: 1.0, dashArray: '12, 12', className: 'pulse-line' }
            ).addTo(this.map);

            const analysisMarker = L.circleMarker([nearest.location.lat, nearest.location.lng], {
                color: '#39ff14', fillColor: '#39ff14', fillOpacity: 0.4, weight: 4, radius: 26, className: 'analysis-ring'
            }).addTo(this.map);

            this.cascadeLines.push(analysisLine);
            this.cascadeLines.push(analysisMarker);
        });
    }

    refreshMarkers() {
        this.markers.forEach((marker) => {
            this.map.removeLayer(marker);
        });
        this.markers.clear();
        this.cityData.nodes.forEach(node => this._addMarker(node));

        if (this.showCascade) {
            this._drawCascadeLines();
        }
    }
}
