import React, { useEffect, useRef } from 'react';
import jsPDF from 'jspdf';

interface GisReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GisReportModal: React.FC<GisReportModalProps> = ({ isOpen, onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === modalRef.current) {
      onClose();
    }
  };

  const generatePDF = () => {
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let y = 16;
      const left = 14;
      const right = pageWidth - 14;
      const contentWidth = right - left;

      const ensureSpace = (needed: number) => {
        if (y + needed > pageHeight - 16) {
          doc.addPage();
          y = 16;
          doc.setFillColor(30, 41, 59);
          doc.rect(0, 0, pageWidth, 8, 'F');
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text('ResilienceOS GIS Incident Report - Reference: INC-2026-0930-FL01', left, 5.5);
        }
      };

      const drawSectionHeader = (title: string) => {
        ensureSpace(12);
        doc.setFillColor(241, 245, 249);
        doc.rect(left, y, contentWidth, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text(title, left + 3, y + 5);
        y += 10;
      };

      const drawBullet = (label: string, text: string) => {
        ensureSpace(6);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(51, 65, 85);
        doc.text(`• ${label}:`, left + 3, y);
        
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        const labelWidth = doc.getTextWidth(`• ${label}: `);
        const splitText = doc.splitTextToSize(text, contentWidth - labelWidth - 6);
        doc.text(splitText, left + 3 + labelWidth, y);
        y += (splitText.length * 4.5) + 1.5;
      };

      // --- Top Title Banner ---
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 24, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text('ResilienceOS - Full GIS Spatial & Incident Report', left, 11);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('Autonomous Threat Mitigation, GIS Spatial Analysis & Infrastructure Telemetry', left, 18);
      y = 30;

      // --- 1. Incident Overview ---
      drawSectionHeader('1. INCIDENT OVERVIEW');
      drawBullet('Incident Reference', 'INC-2026-0930-FL01');
      drawBullet('Event Classification', 'Hydro-Meteorological Flash Flood Event (Level 4 Alert)');
      drawBullet('Timestamp Triggered', 'September 30, 2026 - 15:42:10 UTC');
      drawBullet('Affected Geographic Grid', 'Sector Alpha-7 (Substation A), Corridor Bravo Primary Arterial');
      drawBullet('Peak Recorded Telemetry', '128.4 mm/hr precipitation, 1.85m water level breach');
      drawBullet('Primary Operational Threat', 'Substation A switchgear water ingress & secondary power grid collapse');
      y += 3;

      // --- 2. Actions Taken ---
      drawSectionHeader('2. TIMELINE OF ACTIONS TAKEN');
      const actions = [
          { time: '15:42:10 UTC', action: 'Sensor Alert Triggered: IoT unit SENSOR-FL-09 breached safe threshold of 1.85m.' },
          { time: '15:42:18 UTC', action: 'Autonomous Triage: Mitigation pipeline spawned dynamic fail-safe response plan.' },
          { time: '15:42:35 UTC', action: 'Electrical Grid Decoupling: Critical feeder lines 4A and 4B safely isolated.' },
          { time: '15:43:02 UTC', action: 'Power Rerouting: Switched grid to Auxiliary feeder 7C; 94.2% power continuity preserved.' },
          { time: '15:43:40 UTC', action: 'Traffic Diversion: Smart signals engaged on Corridor Bravo; 1,420 vehicles rerouted.' },
          { time: '15:45:00 UTC', action: 'Active Drainage Actuation: Sump pump arrays Alpha & Beta activated at 100% capacity.' }
      ];
      actions.forEach(item => {
          ensureSpace(7);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          doc.setTextColor(37, 99, 235);
          doc.text(`[${item.time}]`, left + 3, y);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85);
          const splitAct = doc.splitTextToSize(item.action, contentWidth - 35);
          doc.text(splitAct, left + 34, y);
          y += (splitAct.length * 4.2) + 2;
      });
      y += 3;

      // --- 3. Resolution Status ---
      drawSectionHeader('3. INCIDENT RESOLUTION STATUS');
      drawBullet('Overall Resolution', 'STABILIZED & MITIGATED (Automated Response Complete)');
      drawBullet('Power Infrastructure', 'Resolved. Primary substation preserved; zero customer outages.');
      drawBullet('Corridor Mobility', 'Resolved. Water receding; 0.4m depth, single lane reopened.');
      drawBullet('Flood Defense Systems', 'Active. Dual pump arrays operating continuously at 85% load.');
      drawBullet('Pending Physical Inspection', 'Pending. On-site inspection scheduled for Substation vault & pump sediment traps.');
      y += 3;

      // --- 4. Final Assessment ---
      drawSectionHeader('4. FINAL ASSESSMENT & PERFORMANCE METRICS');
      drawBullet('Predictive Lead Time', '12 Minutes ahead of physical ground water impact (Exceeds SLA)');
      drawBullet('Automated Reroute Latency', '27 Seconds total execution time from sensor breach');
      drawBullet('Total Traffic Diverted', '1,420 vehicles diverted away from flood choke point');
      drawBullet('System Performance Grade', 'Grade A (Exemplary Autonomous Resilience Execution)');
      y += 3;

      // --- 5. Strategic Recommendations ---
      drawSectionHeader('5. STRATEGIC RECOMMENDATIONS (FUTURE PREVENTION)');
      drawBullet('High Priority [Infra]', 'Elevate Substation A switchgear foundations by 45cm above 100-year flood levels.');
      drawBullet('Medium Priority [IoT]', 'Deploy dual-redundant optical water sensors to eliminate single-point telemetry reliance.');
      drawBullet('Medium Priority [SOP]', 'Refine manual confirmation policy: set auto-approval timeout to 60s for rapid floods.');
      drawBullet('Low Priority [Fleet]', 'Integrate predictive alarms with municipal dispatch to pre-position vacuum trucks.');
      drawBullet('Software / QA [Test]', 'Register incident telemetry dataset into regression suite as REG-2026-FL01.');

      // --- Footer on all pages ---
      const pageCount = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(148, 163, 184);
          doc.text(`ResilienceOS Confidential - Incident Report | Page ${i} of ${pageCount}`, left, pageHeight - 8);
          doc.text(`Generated: ${new Date().toISOString()}`, right - 45, pageHeight - 8);
      }

      // Trigger direct PDF download
      doc.save('ResilienceOS_GIS_Incident_Report.pdf');
    } catch (err: any) {
      console.error('GIS PDF Generation Error:', err);
      alert('Failed to generate PDF. Error: ' + err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      id="gis-report-modal" 
      ref={modalRef}
      onClick={handleBackdropClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)'
      }}
    >
      <div style={{
        position: 'relative', width: '100%', maxWidth: '56rem', maxHeight: '90vh',
        backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '0.75rem',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', color: '#f1f5f9'
      }}>
        
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.5rem', borderBottom: '1px solid #1e293b', backgroundColor: 'rgba(2, 6, 23, 0.6)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ padding: '0.5rem', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', borderRadius: '0.5rem' }}>
              <svg style={{ width: '1.25rem', height: '1.25rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </span>
            <div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#ffffff', margin: 0 }}>Full GIS Spatial & Telemetry Incident Report</h3>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Incident Reference: <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>INC-2026-0930-FL01</span></p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button 
              id="download-gis-report" 
              onClick={generatePDF}
              style={{
                padding: '0.375rem 0.75rem', fontSize: '0.75rem', fontWeight: 600,
                backgroundColor: '#059669', color: '#ffffff', borderRadius: '0.5rem',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
              }}
            >
              <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
              </svg>
              Export as PDF
            </button>
            <button 
              id="close-gis-modal" 
              onClick={onClose}
              style={{
                color: '#94a3b8', padding: '0.25rem', borderRadius: '0.5rem', background: 'transparent',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center'
              }}
            >
              <svg style={{ width: '1.25rem', height: '1.25rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable Report Body */}
        <div id="gis-report-content" style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', fontSize: '0.875rem', color: '#cbd5e1' }}>
          
          {/* 1. Incident Overview */}
          <div style={{ backgroundColor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(51, 65, 85, 0.6)', borderRadius: '0.5rem', padding: '1.25rem' }}>
            <h4 style={{ color: '#ffffff', fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px solid rgba(51, 65, 85, 0.6)', paddingBottom: '0.5rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.75rem 0' }}>
              <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '9999px', backgroundColor: '#f43f5e' }}></span> 1. Incident Overview
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
              <div>
                <p style={{ margin: '0.25rem 0' }}><strong style={{ color: '#e2e8f0' }}>Incident ID:</strong> INC-2026-0930-FL01</p>
                <p style={{ margin: '0.25rem 0' }}><strong style={{ color: '#e2e8f0' }}>Timestamp:</strong> September 30, 2026 - 15:42:10 UTC</p>
                <p style={{ margin: '0.25rem 0' }}><strong style={{ color: '#e2e8f0' }}>Classification:</strong> Hydro-Meteorological Flash Flood Event</p>
                <p style={{ margin: '0.25rem 0' }}><strong style={{ color: '#e2e8f0' }}>Severity:</strong> Critical (Level 4 Operational Alert)</p>
              </div>
              <div>
                <p style={{ margin: '0.25rem 0' }}><strong style={{ color: '#e2e8f0' }}>Peak Sensor Reading:</strong> 128.4 mm/hr precipitation</p>
                <p style={{ margin: '0.25rem 0' }}><strong style={{ color: '#e2e8f0' }}>Affected Zones:</strong> Grid Alpha-7 (Substation A), Corridor Bravo</p>
                <p style={{ margin: '0.25rem 0' }}><strong style={{ color: '#e2e8f0' }}>Primary Impact:</strong> Water ingress threat at Substation A switchgear</p>
                <p style={{ margin: '0.25rem 0' }}><strong style={{ color: '#e2e8f0' }}>Trigger:</strong> IoT Telemetry ultrasonic water level &gt; 1.85m</p>
              </div>
            </div>
          </div>

          {/* 2. Actions Taken */}
          <div style={{ backgroundColor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(51, 65, 85, 0.6)', borderRadius: '0.5rem', padding: '1.25rem' }}>
            <h4 style={{ color: '#ffffff', fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px solid rgba(51, 65, 85, 0.6)', paddingBottom: '0.5rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.75rem 0' }}>
              <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '9999px', backgroundColor: '#3b82f6' }}></span> 2. Timeline of Actions Taken
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
              {[
                {text: '[15:42:10] Sensor Alert: SENSOR-FL-09 triggered threshold breach (1.85m level).'},
                {text: '[15:42:18] Autonomous Triage: Emergency response orchestrator spawned mitigation plan.'},
                {text: '[15:42:35] Grid Isolation: Feeder lines 4A and 4B safely decoupled.'},
                {text: '[15:43:02] Power Rerouting: Auxiliary feeder 7C engaged; 94.2% power continuity maintained.'},
                {text: '[15:43:40] Traffic Re-routing: Corridor Bravo smart signals updated; 1,420 vehicles diverted.'},
                {text: '[15:45:00] Drainage Actuation: Sump pump arrays Alpha & Beta activated at 100% capacity.'}
              ].map((act, i) => (
                <div key={i} style={{ padding: '0.625rem', borderRadius: '0.25rem', backgroundColor: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(51, 65, 85, 0.4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{act.text}</span>
                  <span style={{ color: '#34d399', fontFamily: 'sans-serif', fontWeight: 'bold' }}>COMPLETED</span>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Resolution Status */}
          <div style={{ backgroundColor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(51, 65, 85, 0.6)', borderRadius: '0.5rem', padding: '1.25rem' }}>
            <h4 style={{ color: '#ffffff', fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px solid rgba(51, 65, 85, 0.6)', paddingBottom: '0.5rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.75rem 0' }}>
              <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '9999px', backgroundColor: '#f59e0b' }}></span> 3. Incident Resolution Status
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
              <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)', padding: '0.75rem', borderRadius: '0.25rem', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                <p style={{ color: '#34d399', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.375rem', margin: '0 0 0.5rem 0' }}>
                  <svg style={{ width: '1rem', height: '1rem' }} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                  Resolved & Stabilized:
                </p>
                <ul style={{ listStyleType: 'disc', listStylePosition: 'inside', margin: 0, padding: 0, fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <li>Primary electrical grid overload averted</li>
                  <li>Critical hospital feeder retained continuous uninterrupted power</li>
                  <li>Corridor Bravo water clearance initiated (depth dropped to 0.4m)</li>
                  <li>All automated fail-safe interlocks operated with 100% reliability</li>
                </ul>
              </div>
              <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)', padding: '0.75rem', borderRadius: '0.25rem', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                <p style={{ color: '#fbbf24', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.375rem', margin: '0 0 0.5rem 0' }}>
                  <svg style={{ width: '1rem', height: '1rem' }} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
                  Pending Follow-up:
                </p>
                <ul style={{ listStyleType: 'disc', listStylePosition: 'inside', margin: 0, padding: 0, fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <li>Physical inspection of Substation A transformer vault insulation</li>
                  <li>Drainage pump beta sediment trap clearance</li>
                  <li>Sensor calibration check for ultrasonic unit SENSOR-FL-09</li>
                </ul>
              </div>
            </div>
          </div>

          {/* 4. Final Assessment */}
          <div style={{ backgroundColor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(51, 65, 85, 0.6)', borderRadius: '0.5rem', padding: '1.25rem' }}>
            <h4 style={{ color: '#ffffff', fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px solid rgba(51, 65, 85, 0.6)', paddingBottom: '0.5rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.75rem 0' }}>
              <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '9999px', backgroundColor: '#a855f7' }}></span> 4. Final Assessment & Performance Metrics
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', textAlign: 'center', marginBottom: '0.75rem' }}>
              {[
                {label: 'Response Lead Time', val: '12 min Early', col: '#34d399'},
                {label: 'Traffic Diverted', val: '1,420 Vehicles', col: '#60a5fa'},
                {label: 'Power Reroute Latency', val: '27 seconds', col: '#c084fc'},
                {label: 'Overall Grade', val: 'A (Exemplary)', col: '#34d399'},
              ].map((s, i) => (
                <div key={i} style={{ backgroundColor: 'rgba(15, 23, 42, 0.7)', padding: '0.75rem', borderRadius: '0.25rem', border: '1px solid #334155' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{s.label}</div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 'bold', color: s.col }}>{s.val}</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>
              The predictive simulation model successfully anticipated water encroachment 12 minutes prior to physical ground intrusion. All human-in-the-loop overrides responded within acceptable protocol tolerances.
            </p>
          </div>

          {/* 5. Future Suggestions */}
          <div style={{ backgroundColor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(51, 65, 85, 0.6)', borderRadius: '0.5rem', padding: '1.25rem' }}>
            <h4 style={{ color: '#ffffff', fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px solid rgba(51, 65, 85, 0.6)', paddingBottom: '0.5rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.75rem 0' }}>
              <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '9999px', backgroundColor: '#10b981' }}></span> 5. Strategic Recommendations (Future Prevention)
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ padding: '0.75rem', borderRadius: '0.25rem', backgroundColor: 'rgba(15, 23, 42, 0.6)', borderLeft: '4px solid #f43f5e' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600, color: '#f1f5f9' }}>[HIGH PRIORITY] Physical Ingress Elevation</span>
                  <span style={{ fontSize: '10px', backgroundColor: 'rgba(244, 63, 94, 0.2)', color: '#fda4af', padding: '0 0.5rem', borderRadius: '0.25rem', fontFamily: 'monospace' }}>INFRASTRUCTURE</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#cbd5e1', margin: 0 }}>Raise Substation A switchgear base elevation by 45cm to increase hydraulic safety margin above the 100-year storm flood datum.</p>
              </div>
              
              <div style={{ padding: '0.75rem', borderRadius: '0.25rem', backgroundColor: 'rgba(15, 23, 42, 0.6)', borderLeft: '4px solid #f59e0b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600, color: '#f1f5f9' }}>[MEDIUM PRIORITY] Redundant Sensor Array</span>
                  <span style={{ fontSize: '10px', backgroundColor: 'rgba(245, 158, 11, 0.2)', color: '#fcd34d', padding: '0 0.5rem', borderRadius: '0.25rem', fontFamily: 'monospace' }}>IOT TELEMETRY</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#cbd5e1', margin: 0 }}>Deploy dual-redundant optical level probes at drainage choke points to eliminate single-point reliance on ultrasonic gauges.</p>
              </div>

              <div style={{ padding: '0.75rem', borderRadius: '0.25rem', backgroundColor: 'rgba(15, 23, 42, 0.6)', borderLeft: '4px solid #3b82f6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600, color: '#f1f5f9' }}>[LOW PRIORITY] Automated Pre-positioning of Crews</span>
                  <span style={{ fontSize: '10px', backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', padding: '0 0.5rem', borderRadius: '0.25rem', fontFamily: 'monospace' }}>OPERATIONS</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#cbd5e1', margin: 0 }}>Integrate early warning telemetry with municipal fleet dispatch to pre-stage pump vac-trucks 30 minutes before heavy rainfall onset.</p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
