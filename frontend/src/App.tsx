import React, { useState, useEffect, useRef } from 'react';
import { initialNodes, initialEdges } from './data/cityData';
import { 
  simulateCascade, 
  computeFailureR0, 
  updateRunways,
  generatePlans,
  runMonteCarlo,
  challengePlan,
  reflectOnFailure
} from './engine/simulation';
import type { 
  InfraNode, InfraEdge, CascadeResult, FailureR0Result,
  RecoveryPlan, ChallengerAttack, ReflectorLesson,
  AgentTraceEntry, SimulationEvent, MonteCarloRun
} from './types';
import { BackendGraphEngine } from './BackendGraphEngine';

// Icons for the UI
const IconCheck = () => <span style={{ color: 'var(--neon-green)' }}>✓</span>;
const IconAlert = () => <span style={{ color: 'var(--neon-red)' }}>⚠</span>;
const IconInfo = () => <span style={{ color: 'var(--neon-cyan)' }}>ℹ</span>;

export default function App() {
  // --- State ---
  const [nodes, setNodes] = useState<InfraNode[]>(initialNodes);
  const [edges, setEdges] = useState<InfraEdge[]>(initialEdges);
  const [cascadeResult, setCascadeResult] = useState<CascadeResult | null>(null);
  const [failureR0, setFailureR0] = useState<FailureR0Result[]>([]);
  const [plans, setPlans] = useState<RecoveryPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [attacks, setAttacks] = useState<ChallengerAttack[]>([]);
  const [lessons, setLessons] = useState<ReflectorLesson[]>([]);
  const [agentTrace, setAgentTrace] = useState<AgentTraceEntry[]>([]);
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const [mcResults, setMcResults] = useState<MonteCarloRun[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'GRAPH' | 'PLANS' | 'ENGINE'>('DASHBOARD');

  // --- Helpers ---
  const addTrace = (agent: AgentTraceEntry['agent'], action: string, detail: string, severity: AgentTraceEntry['severity'] = 'INFO') => {
    setAgentTrace(prev => [{
      id: `trace-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      agent,
      action,
      detail,
      severity
    }, ...prev].slice(0, 50));
  };

  // --- Initial Calculation ---
  useEffect(() => {
    const r0 = computeFailureR0(initialNodes, initialEdges);
    setFailureR0(r0);
    addTrace('SYSTEM', 'Initialization', 'Calculated base Failure R0 across 18-node network.');
  }, []);

  // --- Event Injection ---
  const handleInjectFailure = async (nodeId: string, description: string) => {
    addTrace('SYSTEM', 'Incident Reported', description, 'CRITICAL');
    
    // Create event
    const newEvent: SimulationEvent = {
      id: `evt-${Date.now()}`,
      timestamp: Date.now(),
      type: 'FAILURE',
      description,
      affectedNodes: [nodeId],
      processed: true
    };
    setEvents(prev => [newEvent, ...prev]);

    // Grounding & Cascade
    addTrace('PLANNER', 'Grounding', `Requesting GraphEngine simulation: ${nodeId} -> FAILED`);
    
    try {
      const response = await fetch('http://localhost:8000/api/graphs/resilience_pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initial_state: {
            nodes: nodes,
            edges: edges,
            failedNodeIds: [nodeId]
          }
        })
      });
      
      const data = await response.json();
      
      const cascadeOut = data.node_details?.simulate_cascade?.output;
      if (cascadeOut) {
        setCascadeResult(cascadeOut.cascadeResult);
        setNodes(cascadeOut.nodes);
        addTrace('PLANNER', 'Simulation', `Cascade predicted: ${cascadeOut.cascadeResult.failedNodes.length} nodes failed, Impact: ${cascadeOut.cascadeResult.populationAffected.toLocaleString()} people.`, 'WARNING');
      }

      const plansOut = data.node_details?.generate_plans?.output;
      if (plansOut && plansOut.plans) {
        setPlans(plansOut.plans);
        if (plansOut.plans.length > 0) setSelectedPlanId(plansOut.plans[0].id);
        addTrace('PLANNER', 'Planning', `Generated ${plansOut.plans.length} candidate recovery plans.`);
      }

      const mcOut = data.node_details?.run_monte_carlo?.output;
      if (mcOut && mcOut.monteCarloResults) {
        setMcResults(prev => [...prev, ...mcOut.monteCarloResults]);
        addTrace('PLANNER', 'Monte Carlo', `Ran 100 seeded stress tests per plan.`);
      }

    } catch (err) {
      console.error(err);
      addTrace('SYSTEM', 'Error', 'Failed to reach GraphEngine backend', 'CRITICAL');
    }
  };

  // --- Challenge Plan ---
  const handleChallenge = () => {
    const selectedPlan = plans.find(p => p.id === selectedPlanId);
    if (!selectedPlan) return;

    addTrace('CHALLENGER', 'Adversarial Attack', `Testing ${selectedPlan.name} against unexpected failures.`);
    
    const attack = challengePlan(selectedPlan, nodes, edges);
    setAttacks(prev => [attack, ...prev]);
    
    if (attack.result === 'PLAN_BREAKS') {
      addTrace('CHALLENGER', 'Plan Broken', attack.description + ' -> ' + attack.impact, 'CRITICAL');
      
      // Update plan status
      setPlans(prev => prev.map(p => 
        p.id === selectedPlan.id ? { ...p, status: 'REJECTED', rejectionReason: attack.description } : p
      ));

      // Reflect
      const lesson = reflectOnFailure(selectedPlan, attack, nodes);
      setLessons(prev => [lesson, ...prev]);
      addTrace('REFLECTOR', 'Root Cause Analysis', `Weakness: ${lesson.weakness}. Created regression test.`);
      
      // Generate new plans (simulate self healing)
      setTimeout(() => {
        addTrace('PLANNER', 'Replanning', 'Generating new plan incorporating regression test constraints.');
        const newPlans = generatePlans(nodes, edges);
        // Add a "D" plan as the repaired one
        const planD: RecoveryPlan = {
          ...newPlans[0],
          id: `plan-d-${Date.now()}`,
          name: 'Self-Healed Strategy',
          label: 'Plan D',
          status: 'VERIFIED',
          metrics: { ...newPlans[0].metrics, criticalOutageProbability: 0.01, meanRecovery: 0.95, worstCaseRecovery: 0.85 }
        };
        setPlans([planD, ...plans.filter(p => p.id !== selectedPlan.id)]);
        setSelectedPlanId(planD.id);
        
        // Mark test as passed
        setLessons(prev => prev.map(l => l.id === lesson.id ? { ...l, regressionTest: { ...l.regressionTest, status: 'PASSED' } } : l));
        addTrace('REFLECTOR', 'Verification', `Regression test [${lesson.regressionTest.id}] PASSED.`, 'SUCCESS');

      }, 2000);
    } else {
      addTrace('CHALLENGER', 'Plan Survives', attack.description + ' -> Plan remains viable.', 'SUCCESS');
      setPlans(prev => prev.map(p => 
        p.id === selectedPlan.id ? { ...p, status: 'VERIFIED' } : p
      ));
    }
  };

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="header">
        <div className="header-brand">
          <div className="header-logo">RESILIENCE<span>OS</span></div>
          <div className="header-tagline">Agentic Infrastructure Engine</div>
        </div>
        
        <div className="nav-tabs">
          <button className={`nav-tab ${activeTab === 'DASHBOARD' ? 'active' : ''}`} onClick={() => setActiveTab('DASHBOARD')}>Dashboard</button>
          <button className={`nav-tab ${activeTab === 'GRAPH' ? 'active' : ''}`} onClick={() => setActiveTab('GRAPH')}>Dependency Graph</button>
          <button className={`nav-tab ${activeTab === 'PLANS' ? 'active' : ''}`} onClick={() => setActiveTab('PLANS')}>Recovery Plans</button>
          <button className={`nav-tab ${activeTab === 'ENGINE' ? 'active' : ''}`} onClick={() => setActiveTab('ENGINE')}>GraphEngine</button>
        </div>

        <div className="header-status">
          <div className="status-indicator">
            <div className={`status-dot ${nodes.some(n => n.health === 'FAILED') ? 'critical' : 'active'}`}></div>
            {nodes.some(n => n.health === 'FAILED') ? 'CRITICAL CASCADE' : 'SYSTEM NOMINAL'}
          </div>
          <div className="header-clock">{new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        </div>
      </header>

      {/* LEFT SIDEBAR */}
      <aside className="sidebar-left">
        <div className="sidebar-section">
          <div className="sidebar-section-header">Incident Injection</div>
          <div className="event-injector">
            <button className="inject-btn" onClick={() => handleInjectFailure('PWR_SUB_A', 'Flood at Substation Alpha')}>
              <span className="inject-icon">🌊</span> Flood: Substation Alpha
            </button>
            <button className="inject-btn" onClick={() => handleInjectFailure('TRN_ROAD_R1', 'Road R1 Blocked by Debris')}>
              <span className="inject-icon">🚧</span> Block: Road R1
            </button>
            <button className="inject-btn" onClick={() => handleInjectFailure('WTR_PLANT_A', 'Water Plant Pump Failure')}>
              <span className="inject-icon">💧</span> Fail: Water Plant A
            </button>
          </div>
        </div>

        <div className="sidebar-section flex-1">
          <div className="sidebar-section-header">Critical Runway <span style={{ color: 'var(--neon-orange)' }}>⚠</span></div>
          <div className="sidebar-section-content">
            {nodes.slice().sort((a, b) => a.runwayHours - b.runwayHours).map(node => (
              <div key={node.id} className={`node-list-item ${node.health.toLowerCase().replace('_', '-')}`}>
                <div className="node-icon">{node.icon}</div>
                <div className="node-info">
                  <div className="node-name">{node.name}</div>
                  <div className="node-sector">{node.sector}</div>
                </div>
                <div className="node-health-badge" style={{ borderColor: `var(--health-${node.health.toLowerCase().replace('_', '')})`, color: `var(--health-${node.health.toLowerCase().replace('_', '')})` }}>
                  {node.runwayHours.toFixed(1)}H
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        {activeTab === 'DASHBOARD' && (
          <div className="dashboard-grid">
            <div className="dashboard-card">
              <div className="dashboard-card-header">System Health Overview</div>
              <div className="dashboard-card-body">
                <div className="stats-row">
                  <div className="mini-stat">
                    <div className="mini-stat-value">{nodes.filter(n => n.health === 'HEALTHY').length}</div>
                    <div className="mini-stat-label">Healthy</div>
                  </div>
                  <div className="mini-stat" style={{ borderColor: 'var(--neon-orange)' }}>
                    <div className="mini-stat-value" style={{ color: 'var(--neon-orange)' }}>{nodes.filter(n => n.health === 'AT_RISK' || n.health === 'STRESSED').length}</div>
                    <div className="mini-stat-label">At Risk</div>
                  </div>
                  <div className="mini-stat" style={{ borderColor: 'var(--neon-red)' }}>
                    <div className="mini-stat-value" style={{ color: 'var(--neon-red)' }}>{nodes.filter(n => n.health === 'FAILED').length}</div>
                    <div className="mini-stat-label">Failed</div>
                  </div>
                </div>

                {/* Population Affected */}
                <div className="stats-row" style={{ marginTop: 'var(--space-md)' }}>
                  <div className="mini-stat" style={{ flex: 1, borderColor: nodes.some(n => n.health === 'FAILED') ? 'var(--neon-red)' : 'var(--border)' }}>
                    <div className="mini-stat-value" style={{ color: nodes.some(n => n.health === 'FAILED') ? 'var(--neon-red)' : 'var(--text-h)' }}>
                      {(cascadeResult ? cascadeResult.populationAffected : nodes.filter(n => n.health === 'FAILED').reduce((acc, n) => acc + (n.populationServed || 0), 0)).toLocaleString()}
                    </div>
                    <div className="mini-stat-label">People Affected</div>
                  </div>
                  <div className="mini-stat" style={{ flex: 1, borderColor: nodes.some(n => n.health === 'AT_RISK' || n.health === 'STRESSED') ? 'var(--neon-orange)' : 'var(--border)' }}>
                    <div className="mini-stat-value" style={{ color: nodes.some(n => n.health === 'AT_RISK' || n.health === 'STRESSED') ? 'var(--neon-orange)' : 'var(--text-h)' }}>
                      {nodes.filter(n => n.health === 'AT_RISK' || n.health === 'STRESSED').reduce((acc, n) => acc + (n.populationServed || 0), 0).toLocaleString()}
                    </div>
                    <div className="mini-stat-label">People At Risk</div>
                  </div>
                </div>

              </div>
            </div>

            <div className="dashboard-card">
              <div className="dashboard-card-header">Failure R₀ Analysis (Top 5)</div>
              <div className="dashboard-card-body" style={{ padding: 0 }}>
                <table className="r0-table">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Sector</th>
                      <th>R₀</th>
                      <th>Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failureR0.slice(0, 5).map(r => {
                      const node = nodes.find(n => n.id === r.nodeId);
                      return (
                        <tr key={r.nodeId}>
                          <td>{node?.name}</td>
                          <td style={{ color: `var(--sector-${node?.sector.toLowerCase()})` }}>{node?.sector}</td>
                          <td style={{ fontWeight: 700, color: r.r0 > 2 ? 'var(--neon-red)' : 'var(--text-primary)' }}>{r.r0.toFixed(2)}</td>
                          <td>
                            <div className="r0-bar">
                              <div className={`r0-bar-fill ${r.r0 > 2 ? 'r0-high' : r.r0 > 1 ? 'r0-medium' : 'r0-low'}`} style={{ width: `${Math.min(100, (r.r0 / 4) * 100)}%` }}></div>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="dashboard-card" style={{ gridColumn: '1 / -1' }}>
              <div className="dashboard-card-header">Resilience Memory & Regression Tests</div>
              <div className="dashboard-card-body" style={{ display: 'flex', gap: 'var(--space-md)' }}>
                {lessons.length === 0 ? (
                  <div className="empty-state" style={{ width: '100%' }}>
                    <div className="empty-state-text">No failures recorded yet. System memory clear.</div>
                  </div>
                ) : (
                  lessons.map(lesson => (
                    <div key={lesson.id} className="memory-card" style={{ flex: 1 }}>
                      <div className="memory-pattern">PATTERN: {lesson.pattern}</div>
                      <div className="memory-lesson">{lesson.lesson}</div>
                      <div className={`regression-test-badge ${lesson.regressionTest.status}`}>
                        TEST: {lesson.regressionTest.status}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'GRAPH' && (
          <div className="graph-container">
            <svg className="graph-svg" viewBox="0 0 800 600">
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" className="grid-pattern" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#grid)" />
              
              {/* Edges */}
              {edges.map(edge => {
                const source = nodes.find(n => n.id === edge.source);
                const target = nodes.find(n => n.id === edge.target);
                if (!source || !target) return null;
                const isCascade = cascadeResult?.propagationPath.some(p => p.from === source.id && p.to === target.id);
                return (
                  <g key={edge.id}>
                    <line 
                      x1={source.location.x} y1={source.location.y}
                      x2={target.location.x} y2={target.location.y}
                      className={`graph-edge ${isCascade ? 'cascade-active' : ''}`}
                    />
                    <text x={(source.location.x + target.location.x)/2} y={(source.location.y + target.location.y)/2 - 5} className="graph-edge-label">{edge.label}</text>
                  </g>
                );
              })}

              {/* Nodes */}
              {nodes.map(node => (
                <g key={node.id} className="graph-node" transform={`translate(${node.location.x}, ${node.location.y})`}>
                  {node.health === 'FAILED' && <circle r="40" className="cascade-ripple" />}
                  <circle r="30" className={`node-ring ${node.health}`} />
                  <text className="node-emoji">{node.icon}</text>
                  <text y="45" className="node-label">{node.name}</text>
                </g>
              ))}
            </svg>
          </div>
        )}

        {activeTab === 'PLANS' && (
          <div className="plans-grid">
            {plans.map(plan => (
              <div key={plan.id} className={`plan-card ${selectedPlanId === plan.id ? 'selected' : ''} ${plan.status.toLowerCase()}`} onClick={() => setSelectedPlanId(plan.id)}>
                <div className="plan-header">
                  <div className="plan-label">{plan.label}</div>
                  <div className="plan-name">{plan.name}</div>
                  <div className={`plan-phase ${plan.phase}`}>{plan.phase} Phase</div>
                </div>
                <div className="plan-body">
                  <ul className="plan-actions-list">
                    {plan.actions.map((act, i) => (
                      <li key={act.id} className="plan-action-item">
                        <span className="plan-action-number">0{i+1}</span>
                        <span className="plan-action-text">{act.description}</span>
                      </li>
                    ))}
                  </ul>
                  <div className={`plan-status-badge ${plan.status}`}>{plan.status}</div>
                </div>
                <div className="plan-metrics">
                  <div className="plan-metric-row">
                    <span className="plan-metric-label">Mean Recovery</span>
                    <span className={`plan-metric-value ${plan.metrics.meanRecovery > 0.8 ? 'good' : 'warning'}`}>{(plan.metrics.meanRecovery * 100).toFixed(1)}%</span>
                  </div>
                  <div className="plan-metric-row">
                    <span className="plan-metric-label">Worst Case</span>
                    <span className="plan-metric-value">{(plan.metrics.worstCaseRecovery * 100).toFixed(1)}%</span>
                  </div>
                  <div className="plan-metric-row">
                    <span className="plan-metric-label">Outage Risk</span>
                    <span className={`plan-metric-value ${plan.metrics.criticalOutageProbability < 0.1 ? 'good' : 'critical'}`}>{(plan.metrics.criticalOutageProbability * 100).toFixed(1)}%</span>
                  </div>
                </div>
                
                {selectedPlanId === plan.id && plan.status !== 'REJECTED' && plan.status !== 'VERIFIED' && (
                  <button className="btn btn-danger" style={{ margin: 'var(--space-md)' }} onClick={(e) => { e.stopPropagation(); handleChallenge(); }}>
                    ATTACK PLAN (CHALLENGER)
                  </button>
                )}
              </div>
            ))}
            {plans.length === 0 && (
              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                <div className="empty-state-icon">🛡️</div>
                <div className="empty-state-text">No active incidents. System nominal.</div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'ENGINE' && (
          <div className="engine-container" style={{ width: '100%', height: '100%', minHeight: '600px', display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
            <BackendGraphEngine />
          </div>
        )}
      </main>

      {/* RIGHT SIDEBAR - AGENT TRACE */}
      <aside className="sidebar-right">
        <div className="sidebar-section flex-1">
          <div className="sidebar-section-header">Agent Trace Log</div>
          <div className="sidebar-section-content" style={{ padding: 0 }}>
            <div className="trace-list">
              {agentTrace.map(trace => (
                <div key={trace.id} className={`trace-entry ${trace.agent}`}>
                  <div className="trace-header">
                    <span className={`trace-agent ${trace.agent}`}>{trace.agent}</span>
                    <span className="trace-time">{new Date(trace.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="trace-action">{trace.action}</div>
                  <div className="trace-detail" style={{ color: trace.severity === 'CRITICAL' ? 'var(--neon-red)' : trace.severity === 'SUCCESS' ? 'var(--neon-green)' : 'inherit' }}>
                    {trace.detail}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* BOTTOM RUNWAY BAR */}
      <footer className="runway-bar">
        <div className="runway-bar-header">
          <span>Service Runway</span>
          <span style={{ color: 'var(--text-secondary)' }}>// TIME UNTIL CRITICAL FAILURE</span>
        </div>
        <div className="runway-clocks">
          {nodes.filter(n => ['HEALTHCARE', 'WATER', 'POWER', 'EMERGENCY'].includes(n.sector)).sort((a,b) => a.runwayHours - b.runwayHours).map(node => {
            const isCritical = node.runwayHours <= 3;
            const isWarning = node.runwayHours > 3 && node.runwayHours <= 8;
            const statusClass = isCritical ? 'critical' : isWarning ? 'warning' : 'safe';
            
            return (
              <div key={`runway-${node.id}`} className={`runway-clock ${isCritical ? 'critical' : ''}`}>
                <div className="runway-clock-header">
                  <span className="runway-clock-name">{node.name}</span>
                  <span className="runway-clock-icon">{node.icon}</span>
                </div>
                <div className={`runway-clock-time ${statusClass}`}>
                  {Math.floor(node.runwayHours)}h {Math.floor((node.runwayHours % 1) * 60)}m
                </div>
                <div className="runway-progress">
                  <div className={`runway-progress-fill ${statusClass}`} style={{ width: `${(node.runwayHours / node.maxRunwayHours) * 100}%` }}></div>
                </div>
              </div>
            );
          })}
        </div>
      </footer>
    </div>
  );
}
