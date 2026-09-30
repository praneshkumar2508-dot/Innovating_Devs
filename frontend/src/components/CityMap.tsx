import React, { useEffect, useRef } from 'react';

declare const L: any;
declare global {
    interface Window {
        ResilienceOS: any;
    }
}

const SECTOR_CONFIG: any = {
    'power': { color: '#3b82f6', bgColor: 'rgba(59,130,246,0.1)', label: 'Power Grid' },
    'healthcare': { color: '#ef4444', bgColor: 'rgba(239,68,68,0.1)', label: 'Healthcare' },
    'water': { color: '#0ea5e9', bgColor: 'rgba(14,165,233,0.1)', label: 'Water Supply' },
    'telecom': { color: '#a855f7', bgColor: 'rgba(168,85,247,0.1)', label: 'Telecom' },
    'transport': { color: '#f59e0b', bgColor: 'rgba(245,158,11,0.1)', label: 'Transport' }
};

const HEALTH_COLORS: any = {
    'HEALTHY': '#10b981',
    'STRESSED': '#f59e0b',
    'AT_RISK': '#f97316',
    'FAILED': '#ef4444',
    'RECOVERING': '#3b82f6'
};

const DEPARTMENTS: any = {
    'power': { shortName: 'TNEB', helpline: '1912', whatsapp: '9445850811', phone: '0452-2537528', localOffice: 'Madurai Central', complaintPortal: 'https://www.tangedco.gov.in' },
    'healthcare': { shortName: 'DPH', helpline: '104', phone: '0452-2532535', localOffice: 'Madurai Medical College' },
    'water': { shortName: 'TWAD', helpline: '1800-425-1616' }
};

class MapController {
    containerId: string;
    cityData: any;
    engine: any;
    map: any;
    markers: Map<any, any>;
    floodLayer: any;
    floodLabel: any;
    cascadeLines: any[];
    dependencyLines: any[];
    coverageZones: any[];
    showFlood: boolean;
    showCascade: boolean;
    showDeps: boolean;
    showCoverage: boolean;
    initialized: boolean;
    baseLayers: any;
    currentTileLayer: any;

    constructor(containerId: string, cityData: any, engine: any) {
        this.containerId = containerId;
        this.cityData = cityData;
        this.engine = engine;
        this.map = null;
        this.markers = new Map();
        this.floodLayer = null;
        this.floodLabel = null;
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

        L.control.zoom({ position: 'bottomright' }).addTo(this.map);
        L.control.scale({ position: 'bottomleft', imperial: false }).addTo(this.map);

        const legend = L.control({ position: 'bottomleft' });
        legend.onAdd = function () {
            const div = L.DomUtil.create('div', 'info legend');
            div.style.cssText = 'background: rgba(15, 23, 42, 0.9); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; font-size: 10px; backdrop-filter: blur(8px);';
            div.innerHTML = `
                <div style="font-weight: bold; color: white; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 12px;">Map Legend</div>
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;"><div style="width: 12px; height: 12px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px rgba(16,185,129,0.5);"></div> Healthy</div>
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;"><div style="width: 12px; height: 12px; border-radius: 50%; background: #f59e0b; box-shadow: 0 0 8px rgba(245,158,11,0.5);"></div> At Risk</div>
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;"><div style="width: 12px; height: 12px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.5);"></div> Failed</div>
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;"><div style="width: 16px; border-bottom: 2px dashed #3b82f6;"></div> Animated Data Flow</div>
                <div style="display: flex; align-items: center; gap: 8px;"><div style="width: 16px; height: 16px; border-radius: 50%; border: 1px dashed rgba(52,211,153,0.5); background: rgba(52,211,153,0.1);"></div> Radar Coverage Zone</div>
            `;
            return div;
        };
        legend.addTo(this.map);

        const darkTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd' });
        const lightTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd' });
        const streetTile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
        const satelliteTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 });
        const topoTile = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 });

        this.baseLayers = {
            '🌑 Dark Mode': darkTile,
            '🏢 Professional (Light)': lightTile,
            '🗺️ Street View': streetTile,
            '🛰️ Satellite View': satelliteTile,
            '🏔️ Topographic': topoTile,
        };

        // Default to satellite map
        satelliteTile.addTo(this.map);
        this.currentTileLayer = satelliteTile;

        L.control.layers(this.baseLayers, null, { position: 'topright', collapsed: true }).addTo(this.map);

        this.cityData.nodes.forEach((node: any) => this._addMarker(node));
        this._createDependencyLines();
        this._createHospitalPathways();
        this._createAmbientClinics();
        this._createFloodZone();
        this._createCoverageZones();
        this._addCrewMarkers();

        const allLatLngs = this.cityData.nodes.map((n: any) => [n.lat, n.lng]);
        this.map.fitBounds(allLatLngs, { padding: [40, 40] });

        this.showDeps = true;
        this.dependencyLines.forEach(l => l.addTo(this.map));
        this.showCoverage = true;
        this.coverageZones.forEach(z => { z.inner.addTo(this.map); z.outer.addTo(this.map); });

        this.initialized = true;
    }

    _addMarker(nodeData: any) {
        const node = this.engine.getNode(nodeData.id) || nodeData;
        const sectorCfg = SECTOR_CONFIG[node.sector] || SECTOR_CONFIG['power'];
        const healthColor = HEALTH_COLORS[node.health] || '#10b981';
        const isFailed = node.health === "FAILED";
        const isAtRisk = node.health === "AT_RISK" || node.health === "STRESSED";
        const dept = DEPARTMENTS[node.sector];

        let pinHtml = '';

        if (node.sector === 'healthcare') {
            let hospitalColor = '#ef4444';
            let hospitalGradient = 'linear-gradient(135deg, #ef4444, #991b1b)';
            
            if (node.icon === '🚑') {
                hospitalColor = '#f97316';
                hospitalGradient = 'linear-gradient(135deg, #f97316, #c2410c)';
            } else if (node.icon === '🔬') {
                hospitalColor = '#a855f7';
                hospitalGradient = 'linear-gradient(135deg, #a855f7, #7e22ce)';
            } else if (node.icon === '⚕️') {
                hospitalColor = '#06b6d4';
                hospitalGradient = 'linear-gradient(135deg, #06b6d4, #0e7490)';
            }

            pinHtml = `
                <div class="hospital-shield" style="width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${hospitalGradient}; box-shadow: 0 0 15px ${hospitalColor}80, inset 0 2px 5px rgba(255,255,255,0.4); position: relative;">
                    <span style="font-size: 16px;">${node.icon}</span>
                    <div style="position: absolute; inset: -6px; border: 2px solid ${hospitalColor}; border-radius: 50%; animation: radarPulse 2s linear infinite; opacity: 0.5; pointer-events: none;"></div>
                </div>
            `;
        } else {
            pinHtml = `
                <div style="
                    position: relative; width: 30px; height: 30px;
                    background-color: ${sectorCfg.color || '#3b91ff'};
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    display: flex; align-items: center; justify-content: center;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.4);
                    border: 2px solid white;
                ">
                    <span style="transform: rotate(45deg); font-size: 14px; margin-left: 2px; margin-bottom: 2px;">${node.icon}</span>
                    ${isFailed ? `<div style="position:absolute; inset:-4px; border-radius:50%; border: 2px solid #ef4444; animation: dashAnim 1.5s infinite; transform: rotate(45deg);"></div>` : ''}
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

        const marker = L.marker([nodeData.lat, nodeData.lng], { icon }).addTo(this.map);

        const loadPct = Math.round((node.load / node.capacity) * 100);
        const loadColor = loadPct > 85 ? '#ef4444' : loadPct > 60 ? '#f59e0b' : '#10b981';
        const runwayHtml = node.runway !== null ? `
            <div style="margin-top:8px;padding:6px 8px;background:rgba(0,0,0,0.2);border-radius:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <span style="font-size:10px;color:#94a3b8;">⏱️ Runway</span>
                    <span style="font-size:12px;font-weight:700;color:${node.runway < 3 ? '#ef4444' : node.runway < 6 ? '#f59e0b' : '#10b981'};font-family:monospace;">${node.runway}h</span>
                </div>
                <div style="height:6px;background:rgba(255,255,255,0.1);border-radius:99px;overflow:hidden;">
                    <div style="height:100%;width:${Math.min(100, (node.runway / 12) * 100)}%;background:${node.runway < 3 ? '#ef4444' : node.runway < 6 ? '#f59e0b' : '#10b981'};border-radius:99px;"></div>
                </div>
            </div>
        ` : '';

        let complaintBtn = '';
        if ((isFailed || isAtRisk) && dept) {
            complaintBtn = `
                <div style="margin-top:10px;padding:8px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;">
                    <div style="font-size:10px;font-weight:700;color:#f87171;margin-bottom:6px;">🚨 REPORT TO ${dept.shortName}</div>
                    <div style="font-size:10px;color:#cbd5e1;line-height:1.6;">
                        📞 Helpline: <a href="tel:${dept.helpline}" style="color:#f87171;font-weight:700;font-family:monospace;">${dept.helpline}</a><br>
                    </div>
                    <div style="display:flex;gap:6px;margin-top:8px;">
                        <button onclick="window.ResilienceOS.sendComplaint('${node.id}')" style="flex:1;padding:8px;border-radius:8px;background:linear-gradient(135deg,#ef4444,#f97316);color:white;border:none;font-size:11px;font-weight:700;cursor:pointer;">
                            📤 Send Complaint
                        </button>
                    </div>
                </div>
            `;
        }

        const popupContent = `
            <div style="min-width:260px;max-width:320px;font-family:Inter,sans-serif;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <div style="width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;background:${sectorCfg?.bgColor};border:1px solid ${sectorCfg?.color}30">${node.icon}</div>
                    <div style="flex:1;">
                        <div style="font-weight:800;font-size:14px;color:white;">${node.name}</div>
                        <div style="display:flex;gap:6px;margin-top:2px;">
                            <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${sectorCfg?.bgColor};color:${sectorCfg?.color};font-weight:700;text-transform:uppercase;">${sectorCfg?.label}</span>
                            <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${healthColor}20;color:${healthColor};font-weight:700;">${node.health}</span>
                        </div>
                    </div>
                </div>
                <div style="padding:6px 8px;background:rgba(59,145,255,0.06);border:1px solid rgba(59,145,255,0.15);border-radius:8px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:9px;color:#94a3b8;font-weight:600;">ASSET ID</span>
                        <span style="font-size:11px;color:#3b91ff;font-weight:700;font-family:monospace;">${node.assetCode || node.id}</span>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;">
                    <div style="padding:5px 8px;background:rgba(0,0,0,0.15);border-radius:6px;">
                        <div style="font-size:8px;color:#64748b;">Criticality</div>
                        <div style="font-size:13px;font-weight:800;font-family:monospace;color:${node.criticality >= 0.9 ? '#ef4444' : node.criticality >= 0.7 ? '#f59e0b' : '#10b981'}">${(node.criticality * 100).toFixed(0)}%</div>
                    </div>
                    <div style="padding:5px 8px;background:rgba(0,0,0,0.15);border-radius:6px;">
                        <div style="font-size:8px;color:#64748b;">Population</div>
                        <div style="font-size:13px;font-weight:800;font-family:monospace;color:#e2e8f0;">${(node.populationServed / 1000).toFixed(0)}K</div>
                    </div>
                    <div style="padding:5px 8px;background:rgba(0,0,0,0.15);border-radius:6px;">
                        <div style="font-size:8px;color:#64748b;">Load</div>
                        <div style="font-size:13px;font-weight:800;font-family:monospace;color:${loadColor}">${node.load}/${node.capacity}</div>
                    </div>
                    <div style="padding:5px 8px;background:rgba(0,0,0,0.15);border-radius:6px;">
                        <div style="font-size:8px;color:#64748b;">Recovery</div>
                        <div style="font-size:13px;font-weight:800;font-family:monospace;color:#e2e8f0;">${node.recoveryTime}h</div>
                    </div>
                </div>
                ${runwayHtml}
                ${complaintBtn}
            </div>
        `;

        marker.bindPopup(popupContent, { maxWidth: 350, className: 'resilience-popup' });
        this.markers.set(nodeData.id, marker);
    }

    _createDependencyLines() {
        this.cityData.edges.forEach((edge: any) => {
            const fromNode = this.cityData.nodes.find((n: any) => n.id === edge.source || n.id === edge.from);
            const toNode = this.cityData.nodes.find((n: any) => n.id === edge.target || n.id === edge.to);
            if (!fromNode || !toNode) return;

            const sectorCfg = SECTOR_CONFIG[fromNode.sector];
            const color = sectorCfg?.color || '#3b82f6';
            const weight = 2.5;

            const baseLine = L.polyline([[fromNode.lat, fromNode.lng], [toNode.lat, toNode.lng]], {
                color: color, weight: weight, opacity: 0.15, interactive: false
            });

            const animatedLine = L.polyline([[fromNode.lat, fromNode.lng], [toNode.lat, toNode.lng]], {
                color: color, weight: weight, opacity: 1.0, dashArray: '10,10', className: 'animated-dependency-line'
            });

            const tooltipHtml = `<div style="font-size:11px;font-weight:600;">Data / Supply Link</div><div style="font-size:9px;color:#94a3b8;">Type: ${edge.type || 'SUPPLIES'}</div>`;
            animatedLine.bindTooltip(tooltipHtml, { sticky: true, className: 'node-tooltip', opacity: 0.95 });

            this.dependencyLines.push(baseLine);
            this.dependencyLines.push(animatedLine);
        });
    }

    _createHospitalPathways() {
        const hospitals = this.cityData.nodes.filter((n: any) => n.sector === 'healthcare');
        if (hospitals.length < 2) return;

        const coords = hospitals.map((h: any) => [h.lat, h.lng]);
        coords.push([hospitals[0].lat, hospitals[0].lng]);

        const corridorBase = L.polyline(coords, { color: '#ef4444', weight: 8, opacity: 0.15, interactive: false });
        const corridorPulse = L.polyline(coords, { color: '#ffffff', weight: 3, opacity: 0.9, dashArray: '2, 30', className: 'hospital-corridor-pulse', interactive: false });
        const corridorMain = L.polyline(coords, { color: '#ef4444', weight: 2, opacity: 0.8, dashArray: '15, 10', className: 'hospital-corridor-main' });

        const tooltipHtml = `<div style="font-size:11px;font-weight:700;color:#ef4444;">🚨 Emergency Medical Corridor</div><div style="font-size:9px;color:#94a3b8;">High-speed inter-hospital transit and supply route</div>`;
        corridorMain.bindTooltip(tooltipHtml, { sticky: true, className: 'node-tooltip' });

        this.dependencyLines.push(corridorBase, corridorMain, corridorPulse);
    }

    _createAmbientClinics() {
        const minLat = 9.910, maxLat = 9.955, minLng = 78.100, maxLng = 78.160;
        if (!this.map.getPane('ambientPane')) {
            this.map.createPane('ambientPane');
            this.map.getPane('ambientPane').style.zIndex = '390'; 
        }
        for (let i = 0; i < 150; i++) {
            const lat = minLat + Math.random() * (maxLat - minLat);
            const lng = minLng + Math.random() * (maxLng - minLng);
            const opacity = 0.4 + (Math.random() * 0.6);
            const scale = 0.5 + (Math.random() * 0.5);

            const icon = L.divIcon({
                html: `<div style="display: flex; align-items: center; justify-content: center; width: ${12 * scale}px; height: ${12 * scale}px; background-color: rgba(239, 68, 68, ${opacity}); border-radius: 2px; box-shadow: 0 0 5px rgba(239,68,68,0.5);">
                    <svg viewBox="0 0 24 24" width="${8 * scale}px" height="${8 * scale}px" stroke="white" stroke-width="4" stroke-linecap="round"><line x1="12" y1="4" x2="12" y2="20"></line><line x1="4" y1="12" x2="20" y2="12"></line></svg>
                </div>`,
                className: '', iconSize: [12, 12], iconAnchor: [6, 6]
            });

            const marker = L.marker([lat, lng], { icon: icon, pane: 'ambientPane', interactive: true });
            marker.bindTooltip(`<div style="font-weight: 700; color: #ef4444; margin-bottom: 2px;">City Care Clinic #${Math.floor(Math.random() * 999)}</div>`, { className: 'node-tooltip', direction: 'top' });
            marker.addTo(this.map);
            this.dependencyLines.push(marker);
        }
    }

    _createCoverageZones() {
        this.cityData.nodes.forEach((node: any) => {
            if (!['healthcare', 'power', 'water'].includes(node.sector)) return;
            const sectorCfg = SECTOR_CONFIG[node.sector];
            const color = sectorCfg?.color || '#3b82f6';
            const radius = Math.min((node.populationServed || 50000) / 100, 1500);

            const innerZone = L.circle([node.lat, node.lng], { color: color, fillColor: color, fillOpacity: 0.1, weight: 1, radius: radius * 0.3, interactive: false });
            const outerZone = L.circle([node.lat, node.lng], { color: color, fillColor: color, fillOpacity: 0.03, weight: 1.5, dashArray: '10,15', radius: radius, interactive: false, className: 'radar-zone' });
            this.coverageZones.push({ inner: innerZone, outer: outerZone });
        });
    }

    _createFloodZone() {
        this.floodLayer = L.polygon(this.cityData.floodZone, {
            color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.18, weight: 3, dashArray: '10,5',
        });
        const center = this.floodLayer.getBounds().getCenter();
        this.floodLabel = L.marker(center, {
            icon: L.divIcon({
                html: '<div style="background:rgba(59,130,246,0.2);border:1px solid rgba(59,130,246,0.4);padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;color:#60a5fa;white-space:nowrap;backdrop-filter:blur(4px);">🌊 FLOOD ZONE</div>',
                className: '', iconAnchor: [50, 12],
            })
        });
        // Add by default for demo
        this.floodLayer.addTo(this.map);
        this.floodLabel.addTo(this.map);
    }

    _addCrewMarkers() {
        this.cityData.crews.forEach((crew: any) => {
            const icon = L.divIcon({
                html: `<div style="background:rgba(16,185,129,0.15);border:2px solid #10b981;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 0 10px rgba(16,185,129,0.3);">🔧</div>`,
                className: '', iconSize: [28, 28], iconAnchor: [14, 14],
            });
            L.marker(crew.location, { icon })
                .addTo(this.map)
                .bindTooltip(`<strong>${crew.name}</strong><br>Specialty: ${crew.specialty}<br>Size: ${crew.size} members<br>Status: ${crew.available ? '✓ Available' : '✗ Deployed'}`, {
                    className: 'node-tooltip', opacity: 0.95,
                });
        });
    }
}

export const CityMap: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const controllerInstance = useRef<MapController | null>(null);

  useEffect(() => {
    window.ResilienceOS = {
        sendComplaint: (id: string) => alert(`Complaint sent for ${id}!`)
    };

    if (typeof L === 'undefined' || controllerInstance.current || !mapRef.current) return;

    const mockCityData = {
        center: [9.9252, 78.1198],
        zoom: 13,
        nodes: [
            { id: 'HOSP01', name: 'Govt Rajaji Hospital', icon: '➕', lat: 9.9300, lng: 78.1200, sector: 'healthcare', health: 'AT_RISK', load: 800, capacity: 1000, runway: 4, criticality: 0.9, populationServed: 120000, recoveryTime: 24, crewRequirement: 5, accessible: true, backupAvailable: true },
            { id: 'HOSP02', name: 'Apollo Speciality', icon: '🚑', lat: 9.9400, lng: 78.1400, sector: 'healthcare', health: 'HEALTHY', load: 500, capacity: 800, runway: null, criticality: 0.8, populationServed: 80000, recoveryTime: 12, crewRequirement: 3, accessible: true, backupAvailable: true },
            { id: 'SUB01', name: 'Main Substation Alpha', icon: '⚡', lat: 9.9200, lng: 78.1100, sector: 'power', health: 'FAILED', load: 1200, capacity: 1000, runway: 0, criticality: 0.95, populationServed: 250000, recoveryTime: 48, crewRequirement: 10, accessible: false, backupAvailable: false },
            { id: 'WATER01', name: 'Vaigai Water Treatment', icon: '💧', lat: 9.9150, lng: 78.1300, sector: 'water', health: 'STRESSED', load: 900, capacity: 1000, runway: 12, criticality: 0.85, populationServed: 300000, recoveryTime: 36, crewRequirement: 6, accessible: true, backupAvailable: true },
            { id: 'SUB02', name: 'Substation Beta', icon: '⚡', lat: 9.9350, lng: 78.1050, sector: 'power', health: 'HEALTHY', load: 600, capacity: 1000, runway: null, criticality: 0.8, populationServed: 150000, recoveryTime: 24, crewRequirement: 5, accessible: true, backupAvailable: false },
            { id: 'COMM01', name: 'Telecom Hub', icon: '📡', lat: 9.9280, lng: 78.1150, sector: 'telecom', health: 'HEALTHY', load: 400, capacity: 1000, runway: null, criticality: 0.7, populationServed: 500000, recoveryTime: 12, crewRequirement: 2, accessible: true, backupAvailable: true },
            { id: 'ROAD01', name: 'Major Interchange', icon: '🛣️', lat: 9.9320, lng: 78.1300, sector: 'transport', health: 'HEALTHY', load: 1500, capacity: 2000, runway: null, criticality: 0.6, populationServed: 1000000, recoveryTime: 8, crewRequirement: 4, accessible: true, backupAvailable: false }
        ],
        edges: [
            { source: 'SUB01', target: 'HOSP01', type: 'SUPPLIES' },
            { source: 'SUB01', target: 'HOSP02', type: 'SUPPLIES' },
            { source: 'SUB01', target: 'WATER01', type: 'SUPPLIES' },
            { source: 'SUB02', target: 'COMM01', type: 'SUPPLIES' },
            { source: 'WATER01', target: 'HOSP01', type: 'SUPPLIES' },
            { source: 'SUB02', target: 'HOSP02', type: 'SUPPLIES' },
            { source: 'COMM01', target: 'HOSP01', type: 'COMMUNICATES_WITH' }
        ],
        floodZone: [
            [9.910, 78.120], [9.915, 78.135], [9.905, 78.140], [9.900, 78.125]
        ],
        crews: [
            { name: 'Alpha Repair Crew', specialty: 'Electrical', size: 12, available: true, location: [9.922, 78.112] },
            { name: 'Bravo Water Crew', specialty: 'Plumbing', size: 8, available: false, location: [9.918, 78.132] }
        ]
    };

    const mockEngine = {
        getNode: (id: string) => mockCityData.nodes.find(n => n.id === id),
        getAllNodes: () => mockCityData.nodes
    };

    const mapId = 'city-map-container';
    mapRef.current.id = mapId;

    const controller = new MapController(mapId, mockCityData, mockEngine);
    controller.init();
    controllerInstance.current = controller;

    return () => {
      // Cleanup if unmounted
    };
  }, []);

  return (
    <div className="chart-card full-width" style={{ padding: '2px', border: '1px solid var(--border-color)', height: '100%', minHeight: '600px' }}>
      <div 
        ref={mapRef}
        style={{ height: '600px', width: '100%', borderRadius: '1rem', background: '#0f172a' }}
      ></div>
    </div>
  );
};
