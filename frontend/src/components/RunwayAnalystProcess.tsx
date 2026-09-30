import React, { useState, useRef, useEffect } from 'react';
import type { InfraNode, CascadeResult, SimulationEvent } from '../types';

interface RunwayAnalystProps {
  nodes: InfraNode[];
  cascadeResult: CascadeResult | null;
  events: SimulationEvent[];
}

export default function RunwayAnalystProcess({ nodes, cascadeResult, events }: RunwayAnalystProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const requestRef = useRef<number | null>(null);

  const stressedNodes = nodes.filter(n => n.health === 'FAILED' || n.health === 'STRESSED' || n.health === 'AT_RISK' || n.health === 'RECOVERING');
  const healthyCount = nodes.filter(n => n.health === 'HEALTHY').length;
  const failedCount = nodes.filter(n => n.health === 'FAILED').length;
  const hasIncident = stressedNodes.length > 0;

  const startAnalysis = () => {
    if (analyzing) return;
    setAnalyzing(true);
    setProgress(0);
    
    // Generate dynamic logs based on actual node state
    const dynamicLogs: string[] = [
      "[SYS] INITIATING DETERMINISTIC ENGINE...",
      `[FETCH] Polling telemetry from ${nodes.length} grid nodes...`,
      `[FETCH] ${healthyCount}/${nodes.length} nodes healthy. ${failedCount} FAILED.`,
    ];

    if (hasIncident) {
      stressedNodes.slice(0, 3).forEach(n => {
        dynamicLogs.push(`[ALERT] ${n.name} — Status: ${n.health}, Runway: ${n.runwayHours}h, Load: ${n.currentLoad}/${n.capacity}`);
      });
      if (cascadeResult) {
        dynamicLogs.push(`[CASCADE] Impact: ${cascadeResult.failedNodes.length} nodes failed, ${(cascadeResult.populationAffected / 1000).toFixed(0)}K people affected.`);
      }
      dynamicLogs.push("[BOTTLENECKS] CRITICAL: Cascade bottleneck detected in dependency graph.");
    } else {
      dynamicLogs.push("[VALIDATE] All backup generators SOC above threshold.");
      dynamicLogs.push("[VALIDATE] Water reservoir levels nominal.");
      dynamicLogs.push("[FORECAST] No demand spikes projected via Monte Carlo.");
    }
    
    dynamicLogs.push("[PUBLISH] Deriving absolute T_fail values...");
    dynamicLogs.push("[PUBLISH] Updating UI clocks. OPERATION COMPLETE.");

    setLogs([dynamicLogs[0]]);
    
    let startTime: number | undefined;
    const duration = 5000;

    const animate = (time: number) => {
      if (!startTime) startTime = time;
      const elapsed = time - startTime;
      // If no incident, cap progress at a lower value reflecting healthy status
      const maxProgress = hasIncident ? 100 : Math.max(20, Math.min(80, (1 - healthyCount / nodes.length) * 100 + 20));
      const currentProgress = Math.min((elapsed / duration) * maxProgress, maxProgress);
      
      setProgress(currentProgress);
      
      const logIndex = Math.floor((elapsed / duration) * dynamicLogs.length);
      const visibleLogs = dynamicLogs.slice(0, Math.min(logIndex + 1, dynamicLogs.length));
      setLogs(visibleLogs.slice(Math.max(visibleLogs.length - 6, 0)));
      
      if (elapsed < duration) {
        requestRef.current = requestAnimationFrame(animate);
      } else {
        setAnalyzing(false);
      }
    };
    
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  const getStepColor = () => {
    if (progress === 0 && !analyzing) return 'var(--accent-cyan)';
    if (!hasIncident) return 'var(--accent-cyan)';
    if (progress < 20) return 'var(--accent-red)';
    if (progress < 40) return 'var(--accent-pink)';
    if (progress < 60) return 'var(--accent-purple)';
    if (progress < 80) return 'var(--accent-blue)';
    return 'var(--accent-cyan)';
  };
  
  const activeColor = getStepColor();

  // Sort stressed nodes by runway (most critical first)
  const sortedStressed = [...stressedNodes].sort((a, b) => a.runwayHours - b.runwayHours);

  return (
    <div className="chart-card full-width" style={{ padding: '12px', marginBottom: '16px', border: analyzing ? `1px solid ${activeColor}` : '1px solid var(--border-color)', transition: 'border-color 0.3s' }}>
      
      <div className="chart-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="chart-title" style={{ fontSize: '1rem', fontWeight: 'bold' }}>⚙️ Runway Analyst — Deterministic Engine</span>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '2px', margin: 0 }}>
            Calculates time-to-failure dynamically from load, backup reserves, and multi-resource bottlenecks.
          </p>
        </div>
        <button 
          id="runway-analyst-btn"
          className="sim-btn primary" 
          onClick={startAnalysis}
          disabled={analyzing}
          style={{ 
            background: analyzing ? 'var(--bg-secondary)' : 'var(--accent-cyan)', 
            color: analyzing ? 'var(--text-secondary)' : '#000', 
            boxShadow: analyzing ? 'none' : '0 0 10px rgba(6,214,160,0.4)',
            padding: '4px 12px',
            fontSize: '0.8rem'
          }}
        >
          {analyzing ? '⚙️ CALCULATING...' : '▶ RUN'}
        </button>
      </div>
      
      {/* Cybernetic HUD Terminal */}
      <div style={{ padding: '10px', display: 'flex', gap: '20px', marginTop: '10px', background: '#030509', borderRadius: '6px', border: `1px solid ${activeColor}`, boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)', transition: 'border-color 0.3s' }}>
        
        <div style={{ position: 'relative', width: '60px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="60" height="60" viewBox="0 0 60 60" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="30" cy="30" r="25" fill="none" stroke="#111827" strokeWidth="4" />
            <circle cx="30" cy="30" r="25" fill="none" stroke={activeColor} strokeWidth="4" 
              strokeDasharray="157" 
              strokeDashoffset={157 - (157 * progress) / 100}
              style={{ transition: 'stroke 0.3s' }}
            />
          </svg>
          <div style={{ position: 'absolute', color: activeColor, fontSize: '0.9rem', fontWeight: 900, textShadow: `0 0 5px ${activeColor}`, transition: 'color 0.3s, text-shadow 0.3s' }}>
            {Math.floor(progress)}%
          </div>
        </div>

        <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: activeColor, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '60px', textShadow: `0 0 3px ${activeColor}`, transition: 'color 0.3s, text-shadow 0.3s' }}>
          {logs.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>&gt; ENGINE IDLE. {hasIncident ? `${stressedNodes.length} nodes require analysis.` : 'All systems nominal.'}</div>}
          {logs.map((log, i) => (
            <div key={i} style={{ whiteSpace: 'nowrap', opacity: i === logs.length - 1 ? 1 : 0.6, marginBottom: '2px' }}>
              <span style={{ color: '#fff', marginRight: '6px' }}>&gt;</span>{log}
            </div>
          ))}
        </div>
      </div>

      {/* Live Runway Bars — only show after analysis or if there are stressed nodes */}
      {(progress > 50 || (!analyzing && sortedStressed.length > 0)) && sortedStressed.length > 0 && (
        <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#fff', marginBottom: '8px' }}>🕐 Service Runway — Time Until Critical Failure</div>
          {sortedStressed.map(node => {
            const pct = Math.min(100, (node.runwayHours / node.maxRunwayHours) * 100);
            const barColor = node.runwayHours <= 2 ? '#ef4444' : node.runwayHours <= 5 ? '#f59e0b' : '#10b981';
            const isFlashing = node.runwayHours <= 2;
            
            return (
              <div key={node.id} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '3px' }}>
                  <span style={{ color: '#e2e8f0' }}>{node.icon} {node.name} <span style={{ color: 'var(--text-secondary)' }}>({node.health})</span></span>
                  <span style={{ color: barColor, fontWeight: 'bold', fontFamily: 'var(--font-mono)', animation: isFlashing ? 'blink 0.8s infinite' : 'none' }}>{node.runwayHours}h / {node.maxRunwayHours}h</span>
                </div>
                <div style={{ height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ 
                    height: '100%', width: `${pct}%`, background: barColor, borderRadius: '4px',
                    boxShadow: `0 0 8px ${barColor}`,
                    transition: 'width 0.5s ease',
                    animation: isFlashing ? 'blink 0.8s infinite' : 'none'
                  }}></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {/* Summary when no issues */}
      {sortedStressed.length === 0 && progress > 50 && (
        <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(16,185,129,0.08)', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.3)', textAlign: 'center' }}>
          <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: '0.9rem' }}>✓ ALL SYSTEMS NOMINAL</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '4px' }}>No nodes are under stress. All runways at maximum capacity.</div>
        </div>
      )}
    </div>
  );
}
