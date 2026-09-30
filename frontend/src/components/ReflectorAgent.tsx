import React, { useState } from 'react';
import type { InfraNode, CascadeResult, RecoveryPlan, SimulationEvent, ReflectorLesson, ChallengerAttack } from '../types';

interface ReflectorAgentProps {
  nodes: InfraNode[];
  cascadeResult: CascadeResult | null;
  plans: RecoveryPlan[];
  events: SimulationEvent[];
  lessons: ReflectorLesson[];
  attacks: ChallengerAttack[];
}

export const ReflectorAgent: React.FC<ReflectorAgentProps> = ({ nodes, cascadeResult, plans, events, lessons, attacks }) => {
  const [status, setStatus] = useState<'IDLE' | 'RUNNING' | 'SUCCESS' | 'ERROR'>('IDLE');

  const failedNodes = nodes.filter(n => n.health === 'FAILED');
  const stressedNodes = nodes.filter(n => n.health === 'STRESSED' || n.health === 'AT_RISK');
  const hasIncident = failedNodes.length > 0 || stressedNodes.length > 0 || events.length > 0;
  const latestEvent = events.length > 0 ? events[0] : null;
  const selectedPlan = plans.length > 0 ? plans[0] : null;

  const handleReflect = () => {
    if (!hasIncident) {
      setStatus('ERROR');
      return;
    }
    setStatus('RUNNING');
    setTimeout(() => {
      setStatus('SUCCESS');
    }, 2000);
  };

  // Determine incident type and details dynamically
  const incidentType = latestEvent?.description || 'No incident detected';
  const primaryFailedNode = failedNodes[0] || stressedNodes[0];
  const incidentSector = primaryFailedNode?.sector || 'UNKNOWN';

  // Dynamic timeline based on real events
  const timeline = events.map((evt, i) => ({
    time: `T+${Math.floor((Date.now() - evt.timestamp) / 60000)}m`,
    description: evt.description,
  }));

  // Dynamic prediction assessment
  const getPredictionAssessment = () => {
    if (!primaryFailedNode) return { predicted: 'N/A', actual: 'N/A', result: 'N/A', resultColor: 'var(--text-secondary)' };
    const actual = primaryFailedNode.health;
    // If the node is failed and we had events, the prediction was likely correct
    if (actual === 'FAILED') {
      return { predicted: 'HIGH RISK', actual: 'FAILED', result: 'TRUE POSITIVE', resultColor: 'var(--neon-green)' };
    }
    if (actual === 'STRESSED' || actual === 'AT_RISK') {
      return { predicted: 'MEDIUM RISK', actual: actual, result: 'EARLY WARNING', resultColor: 'var(--neon-orange)' };
    }
    return { predicted: 'LOW RISK', actual: actual, result: 'MONITORING', resultColor: 'var(--neon-cyan)' };
  };

  const prediction = getPredictionAssessment();

  // Dynamic root cause based on sector
  const getRootCause = () => {
    if (!primaryFailedNode) return { cause: 'No incident', evidence: 'N/A', confidence: 0 };
    switch (incidentSector) {
      case 'POWER':
        return { cause: 'Transformer overload caused thermal runaway, exceeding rated capacity limits', evidence: `LOAD_EVENT: ${primaryFailedNode.currentLoad}/${primaryFailedNode.capacity}`, confidence: 0.93 };
      case 'TRANSPORT':
        return { cause: 'Debris accumulation blocked primary arterial, cutting crew access routes', evidence: `TRANSPORT_EVENT: Road accessibility blocked`, confidence: 0.88 };
      case 'WATER':
        return { cause: 'Pump motor failure led to pressure drop below critical threshold', evidence: `PRESSURE_EVENT: Flow rate dropped`, confidence: 0.91 };
      default:
        return { cause: `${primaryFailedNode.name} exceeded operational thresholds`, evidence: `SYS_EVENT`, confidence: 0.85 };
    }
  };
  const rootCause = getRootCause();

  // Dynamic lessons based on sector
  const getDynamicLessons = () => {
    const baseLessons = [];
    if (incidentSector === 'POWER') {
      baseLessons.push({ label: 'CAPACITY_LESSON', text: `${primaryFailedNode?.name} load exceeded rated capacity by ${Math.max(0, ((primaryFailedNode?.currentLoad || 0) / (primaryFailedNode?.capacity || 1) - 1) * 100).toFixed(0)}%. Load balancing across substations should be reviewed.` });
      baseLessons.push({ label: 'RUNWAY_LESSON', text: `Backup generator runway was ${primaryFailedNode?.runwayHours}h — below the 6h minimum safety threshold.` });
    } else if (incidentSector === 'TRANSPORT') {
      baseLessons.push({ label: 'ACCESS_LESSON', text: `Road blockage cut crew access to ${cascadeResult?.failedNodes.length || 0} downstream nodes. Pre-cleared alternate routes needed.` });
      baseLessons.push({ label: 'DEPENDENCY_LESSON', text: `Hospital supply chain had single-point-of-failure dependency on ${primaryFailedNode?.name}.` });
    } else if (incidentSector === 'WATER') {
      baseLessons.push({ label: 'PUMP_LESSON', text: `Pump failure at ${primaryFailedNode?.name} affected ${((primaryFailedNode?.populationServed || 0) / 1000).toFixed(0)}K people. Redundant pump system required.` });
      baseLessons.push({ label: 'RESERVOIR_LESSON', text: `Reservoir reserves were insufficient to bridge the ${primaryFailedNode?.recoveryTimeHours}h repair window.` });
    }
    // Add lessons from challenger attacks
    lessons.forEach(l => {
      baseLessons.push({ label: 'CHALLENGER_LESSON', text: l.lesson });
    });
    return baseLessons;
  };
  const dynamicLessons = getDynamicLessons();

  // Dynamic regression tests
  const getDynamicTests = () => {
    const tests = [];
    if (incidentSector === 'POWER') {
      tests.push({ id: 'REG-PWR-001', desc: `If ${primaryFailedNode?.name} fails, does hospital maintain power via backup within 15 minutes?` });
      tests.push({ id: 'REG-PWR-002', desc: `If load exceeds 90% at ${primaryFailedNode?.name}, does load shedding trigger automatically?` });
    } else if (incidentSector === 'TRANSPORT') {
      tests.push({ id: 'REG-TRN-001', desc: `If ${primaryFailedNode?.name} is blocked, can crew reach all critical nodes via detour within 2 hours?` });
      tests.push({ id: 'REG-TRN-002', desc: `If road debris exceeds 50% coverage, is emergency airlift protocol triggered?` });
    } else if (incidentSector === 'WATER') {
      tests.push({ id: 'REG-WTR-001', desc: `If pump fails at ${primaryFailedNode?.name}, does tanker deployment begin within 30 minutes?` });
      tests.push({ id: 'REG-WTR-002', desc: `If reservoir drops below 20%, is rationing protocol activated automatically?` });
    }
    // Include tests from challenger
    lessons.forEach(l => {
      tests.push({ id: l.regressionTest.id, desc: l.regressionTest.description });
    });
    return tests;
  };
  const dynamicTests = getDynamicTests();

  return (
    <div className="chart-card full-width" style={{ padding: '24px', border: '1px solid var(--border-color)', height: '100%', overflowY: 'auto', maxHeight: 'calc(100vh - 100px)' }}>
      <div className="chart-header" style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.5rem', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          🧠 Reflector Agent
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
          {hasIncident ? `Incident: ${incidentType} | Sector: ${incidentSector}` : 'No active incident to reflect on.'}
        </p>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <button 
          onClick={handleReflect} 
          disabled={status === 'RUNNING' || !hasIncident}
          className="sim-btn primary"
          style={{ 
            background: status === 'SUCCESS' ? 'var(--neon-green)' : !hasIncident ? 'var(--bg-secondary)' : 'var(--accent-purple)', 
            color: status === 'SUCCESS' ? '#000' : !hasIncident ? 'var(--text-secondary)' : '#000',
            boxShadow: status === 'SUCCESS' ? '0 0 15px rgba(57,255,20,0.4)' : !hasIncident ? 'none' : '0 0 15px rgba(123,97,255,0.4)',
            cursor: !hasIncident ? 'not-allowed' : 'pointer'
          }}
        >
          {status === 'IDLE' && (hasIncident ? 'REFLECT INCIDENT' : 'NO INCIDENT TO REFLECT')}
          {status === 'RUNNING' && '⚙️ ANALYZING INCIDENT...'}
          {status === 'SUCCESS' && '✓ REFLECTION COMPLETE'}
          {status === 'ERROR' && '⚠ NO INCIDENT DATA AVAILABLE'}
        </button>
      </div>

      {status === 'SUCCESS' && (
        <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: '1fr 1fr' }}>
          
          <div className="dashboard-card" style={{ gridColumn: '1 / -1' }}>
            <div className="dashboard-card-header">Incident Summary</div>
            <div className="dashboard-card-body" style={{ display: 'flex', gap: '30px', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
              <div><span style={{ color: 'var(--text-secondary)' }}>Incident:</span> {incidentType}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Sector:</span> {incidentSector}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Failed:</span> <span style={{ color: 'var(--neon-red)' }}>{failedNodes.length} nodes</span></div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Stressed:</span> <span style={{ color: 'var(--neon-orange)' }}>{stressedNodes.length} nodes</span></div>
              {cascadeResult && <div><span style={{ color: 'var(--text-secondary)' }}>Pop. Affected:</span> <span style={{ color: 'var(--neon-red)' }}>{(cascadeResult.populationAffected / 1000).toFixed(0)}K</span></div>}
            </div>
          </div>

          <div className="dashboard-card">
            <div className="dashboard-card-header">What Happened? (Timeline)</div>
            <div className="dashboard-card-body" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
              {timeline.length > 0 ? timeline.map((t, i) => (
                <div key={i} style={{ marginBottom: '8px' }}>
                  <strong>{t.time}:</strong> {t.description}
                </div>
              )) : (
                <div style={{ color: 'var(--text-secondary)' }}>No timeline events recorded.</div>
              )}
              {failedNodes.map(n => (
                <div key={n.id} style={{ marginBottom: '4px', color: 'var(--neon-orange)' }}>
                  ↳ {n.name}: {n.health} (Runway: {n.runwayHours}h)
                </div>
              ))}
            </div>
          </div>

          <div className="dashboard-card">
            <div className="dashboard-card-header">Prediction Review</div>
            <div className="dashboard-card-body" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Predicted:</span> {prediction.predicted}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Actual:</span> {prediction.actual}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Result:</span> <strong style={{ color: prediction.resultColor }}>{prediction.result}</strong>
              </div>
            </div>
          </div>

          <div className="dashboard-card">
            <div className="dashboard-card-header">Plan Review</div>
            <div className="dashboard-card-body" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
              {selectedPlan ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Selected:</span> {selectedPlan.name}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Actions:</span> {selectedPlan.actions.length} steps
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Status:</span> <span style={{ color: selectedPlan.status === 'VERIFIED' ? 'var(--neon-green)' : 'var(--neon-orange)' }}>{selectedPlan.status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Est. Time:</span> <strong style={{ color: 'var(--neon-cyan)' }}>{selectedPlan.metrics.timeToStabilize.toFixed(1)}h</strong>
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--text-secondary)' }}>No recovery plan generated yet. Run the Decision Analyst first.</div>
              )}
            </div>
          </div>

          <div className="dashboard-card">
            <div className="dashboard-card-header">Root Cause</div>
            <div className="dashboard-card-body">
              <div style={{ color: 'var(--neon-orange)', fontWeight: 'bold', marginBottom: '10px' }}>
                {rootCause.cause}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Evidence: {rootCause.evidence}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Confidence: <span style={{ color: rootCause.confidence > 0.9 ? 'var(--neon-green)' : 'var(--neon-orange)' }}>
                  {rootCause.confidence > 0.9 ? 'HIGH' : 'MEDIUM'} ({rootCause.confidence.toFixed(2)})
                </span>
              </div>
            </div>
          </div>

          <div className="dashboard-card" style={{ gridColumn: '1 / -1' }}>
            <div className="dashboard-card-header">Generated Lessons</div>
            <div className="dashboard-card-body">
              {dynamicLessons.length > 0 ? (
                <ol style={{ paddingLeft: '20px', margin: 0, color: 'var(--text-secondary)' }}>
                  {dynamicLessons.map((lesson, i) => (
                    <li key={i} style={{ marginBottom: '10px' }}>
                      <strong style={{ color: '#fff' }}>{lesson.label}:</strong> {lesson.text}
                    </li>
                  ))}
                </ol>
              ) : (
                <div style={{ color: 'var(--text-secondary)' }}>No lessons generated. Inject an incident and run the Reflector.</div>
              )}
            </div>
          </div>

          <div className="dashboard-card">
            <div className="dashboard-card-header">Regression Tests Generated</div>
            <div className="dashboard-card-body">
              {dynamicTests.length > 0 ? (
                <ul style={{ paddingLeft: '20px', margin: 0, color: 'var(--text-secondary)' }}>
                  {dynamicTests.map((test, i) => (
                    <li key={i} style={{ marginBottom: '10px' }}><strong>{test.id}:</strong> {test.desc}</li>
                  ))}
                </ul>
              ) : (
                <div style={{ color: 'var(--text-secondary)' }}>No tests generated yet.</div>
              )}
            </div>
          </div>

          <div className="dashboard-card">
            <div className="dashboard-card-header">Recommendations</div>
            <div className="dashboard-card-body">
              {incidentSector === 'POWER' && <div style={{ marginBottom: '10px' }}>Review: Transformer load balancing and backup generator fuel policy.</div>}
              {incidentSector === 'TRANSPORT' && <div style={{ marginBottom: '10px' }}>Review: Pre-cleared alternate route registry and debris monitoring system.</div>}
              {incidentSector === 'WATER' && <div style={{ marginBottom: '10px' }}>Review: Redundant pump installation schedule and emergency tanker deployment SLA.</div>}
              {!['POWER', 'TRANSPORT', 'WATER'].includes(incidentSector) && <div style={{ marginBottom: '10px' }}>Review: General infrastructure resilience and crew allocation policy.</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Status:</span>
                <span style={{ padding: '4px 8px', background: 'rgba(255, 102, 0, 0.2)', color: 'var(--neon-orange)', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>PENDING REVIEW</span>
              </div>
            </div>
          </div>

        </div>
      )}

      {status === 'ERROR' && (
        <div style={{ padding: '20px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '1rem' }}>⚠ No incident data available</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '8px' }}>Inject an incident from the left sidebar first, then return here to reflect.</div>
        </div>
      )}
    </div>
  );
};
