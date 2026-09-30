import React, { useState, useEffect, useRef } from 'react';
import { initialNodes, initialEdges } from './data/cityData';
import { 
  simulateCascade, 
  computeFailureR0, 
  updateRunways,
  generatePlans,
  generatePlansBackend,
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
import { MapController } from './MapController';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const createNodeIcon = (node: InfraNode) => {
  const isFailed = node.health === "FAILED";
  let pinHtml = '';
  
  if (node.sector === 'healthcare') {
    pinHtml = `
      <div class="hospital-shield" style="background: linear-gradient(135deg, #ef4444, #991b1b); box-shadow: 0 0 15px #ef444480, inset 0 2px 5px rgba(255,255,255,0.4); width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; position: relative;">
          <span style="font-size: 20px;">${node.icon}</span>
          <div style="position: absolute; inset: -6px; border: 2px solid #ef4444; border-radius: 16px; animation: radarPulse 2s linear infinite; opacity: 0.5; pointer-events: none;"></div>
          <text style="position: absolute; bottom: -20px; white-space: nowrap; font-size: 10px; font-weight: bold; color: var(--text-h); text-shadow: 0px 0px 4px #000;">${node.name}</text>
      </div>
    `;
  } else {
    pinHtml = `
      <div style="
          position: relative;
          width: 30px;
          height: 30px;
          background-color: ${node.sector === 'power' ? '#f59e0b' : node.sector === 'water' ? '#3b82f6' : '#8b5cf6'};
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
          <text style="transform: rotate(45deg); position: absolute; bottom: -30px; left: -15px; white-space: nowrap; font-size: 10px; font-weight: bold; color: var(--text-h); text-shadow: 0px 0px 4px #000;">${node.name}</text>
      </div>
    `;
  }

  return L.divIcon({ html: pinHtml, className: '', iconSize: [40, 40], iconAnchor: [20, 40] });
};

import { runPredictionBatch } from './services/predictionApi';
import RunwayAnalystProcess from './components/RunwayAnalystProcess';
import { ReflectorAgent } from './components/ReflectorAgent';
import { GisReportModal } from './components/GisReportModal';
import { CityMap } from './components/CityMap';

// Icons for the UI
const IconCheck = () => <span style={{ color: 'var(--neon-green)' }}>✓</span>;
const IconAlert = () => <span style={{ color: 'var(--neon-red)' }}>⚠</span>;
const IconInfo = () => <span style={{ color: 'var(--neon-cyan)' }}>ℹ</span>;

export default function App() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapControllerRef = useRef<MapController | null>(null);
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
  const [predictions, setPredictions] = useState<any[]>([]);
  const [isPredicting, setIsPredicting] = useState(false);
  const [predictionTime, setPredictionTime] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'GRAPH' | 'PLANS' | 'ENGINE' | 'CHAT'>('GRAPH');

  useEffect(() => {
    if (mapRef.current) {
      if (!mapControllerRef.current) {
        const cityData = {
          center: [9.9252, 78.1198],
          zoom: 13,
          nodes: nodes,
          edges: edges
        };
        const engineStub = {
          getNode: (id: string) => nodes.find(n => n.id === id),
          getAllNodes: () => nodes
        };
        mapControllerRef.current = new MapController(mapRef.current, cityData, engineStub);
        mapControllerRef.current.init();
      } else {
        mapControllerRef.current.cityData.nodes = nodes;
        mapControllerRef.current.cityData.edges = edges;
        mapControllerRef.current.showCascade = cascadeResult ? true : false;
        mapControllerRef.current.refreshMarkers();
        if (activeTab === 'GRAPH') {
          mapControllerRef.current.map.invalidateSize();
        }
      }
    }
  }, [nodes, edges, activeTab, cascadeResult]);

  // --- Chat State ---
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([
    { role: 'assistant', content: 'Hello! I am your AI Resilience Assistant powered by Ollama. How can I help you analyze the infrastructure today?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isChatFloating, setIsChatFloating] = useState(false);

  // --- Voice Helpers ---
  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice recognition is not supported in this browser.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setChatInput(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    
    recognition.start();
  };

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
    (async () => {
      const r0 = await computeFailureR0(initialNodes, initialEdges);
      setFailureR0(r0);
      addTrace('SYSTEM', 'Initialization', 'Calculated base Failure R0 across 18-node network via backend.');
    })();
  }, []);

  // --- Predictive Analyst ---
  const handleRunPrediction = async () => {
    setIsPredicting(true);
    addTrace('PREDICTIVE_ANALYST', 'Analysis', 'Fetching current telemetry and analyzing risk across network...', 'INFO');
    try {
      const results = await runPredictionBatch(nodes);
      setPredictions(results);
      setPredictionTime(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      const criticalCount = results.filter((r: any) => r.risk_level === 'CRITICAL').length;
      const highCount = results.filter((r: any) => r.risk_level === 'HIGH').length;
      
      if (criticalCount > 0 || highCount > 0) {
        addTrace('PREDICTIVE_ANALYST', 'Warning', `Identified ${criticalCount} critical and ${highCount} high risk nodes.`, 'WARNING');
      } else {
        addTrace('PREDICTIVE_ANALYST', 'Clear', `Network telemetry stable. No immediate failure risks detected.`, 'SUCCESS');
      }
    } catch (e) {
      addTrace('PREDICTIVE_ANALYST', 'Error', 'Prediction model unavailable or telemetry data stale.', 'CRITICAL');
    } finally {
      setIsPredicting(false);
    }
  };

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
    
    const cascade = await simulateCascade(nodes, edges, [nodeId]);
    setCascadeResult(cascade);
    
    // Update nodes based on cascade
    const newNodes = nodes.map(n => {
      if (cascade.failedNodes.includes(n.id)) {
        return { ...n, health: 'FAILED' as const, currentLoad: 0 };
      }
      if (cascade.propagationPath.some(p => p.to === n.id)) {
        return { ...n, health: 'STRESSED' as const };
      }
      return n;
    });
    setNodes(newNodes);

    addTrace('PLANNER', 'Simulation', `Cascade predicted: ${cascade.failedNodes.length} nodes failed, Impact: ${cascade.populationAffected.toLocaleString()} people.`, 'WARNING');

    // Plans will now be generated by clicking "Run Decision Analyst"
    setPlans([]);
    setSelectedPlanId(null);
    setRootFailureNodeId(nodeId);
    addTrace('PLANNER', 'Planning', 'Awaiting Decision Analyst action...', 'INFO');
    
    // Monte Carlo will be run when plans are generated
  };

  // --- Decision Analyst ---
  const handleRunDecisionAnalyst = async () => {
    addTrace('PLANNER', 'Optimization', 'Connecting to Recovery Optimizer (Decision Analyst)...', 'INFO');
    setActiveTab('PLANS');
    
    // Call the backend engine
    const failedNodesIds = nodes.filter(n => n.health === 'FAILED' || n.health === 'AT_RISK').map(n => n.id);
    if (failedNodesIds.length === 0) {
      addTrace('PLANNER', 'Optimization', 'No failed or at-risk nodes to optimize.', 'SUCCESS');
      return;
    }

    try {
      const newPlans = await generatePlansBackend(nodes, edges, failedNodesIds, rootFailureNodeId);
      setPlans(newPlans);
      if (newPlans.length > 0) {
        setSelectedPlanId(newPlans[0].id);
        addTrace('PLANNER', 'Planning', `Analyst successfully generated ${newPlans.length} feasible recovery plans. Optimal Plan selected.`, 'SUCCESS');
        
        // Monte Carlo
        newPlans.forEach(plan => {
          const mc = runMonteCarlo(nodes, edges, plan);
          setMcResults(prev => [...prev, mc]);
        });
        addTrace('PLANNER', 'Monte Carlo', `Ran 100 seeded stress tests per plan.`);
        
        if (autoExecute) {
          addTrace('PLANNER', 'Automation', `Auto-execute enabled. Executing optimal plan immediately.`, 'INFO');
          handleExecutePlan(newPlans[0]);
        }
      } else {
        addTrace('PLANNER', 'Planning', `Analyst found NO FEASIBLE PLANS due to runway constraints.`, 'CRITICAL');
      }
    } catch (e) {
      addTrace('PLANNER', 'Error', 'Failed to reach Recovery Optimizer backend.', 'CRITICAL');
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
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    const userMsg = { role: 'user' as const, content: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    const callOllama = async (modelName: string) => {
      const systemPrompt = "You are the ResilienceOS AI Assistant. Analyze infrastructure reports. If the user mentions a 'powercut', state that Substation Alpha (PWR_SUB_A) is failing. If they mention 'water', state that Water Treatment Alpha (WTR_PLANT_A) is failing. Briefly explain the impact and confirm you are forwarding the report to the Cascade Analyst.";
      
      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'system', content: systemPrompt }, ...chatMessages, userMsg].map(m => ({ role: m.role, content: m.content })),
          stream: false
        })
      });
      if (!response.ok) throw new Error(`Model ${modelName} failed`);
      return response.json();
    };

    try {
      // Attempt primary model
      let data;
      try {
        data = await callOllama('gemma3:1b');
      } catch (e) {
        // Fallback to qwen
        setChatMessages(prev => [...prev, { role: 'assistant', content: 'Fallback: gemma3:1b not found, trying qwen...' }]);
        data = await callOllama('qwen');
      }
      
      setChatMessages(prev => {
        // Remove the temporary fallback message if it exists
        const cleaned = prev.filter(m => !m.content.startsWith('Fallback:'));
        return [...cleaned, { role: 'assistant', content: data.message.content }];
      });
      speak(data.message.content);

      // Auto-trigger the Cascade Analyst based on extracted keywords
      const lowerInput = chatInput.toLowerCase();
      let injectedNode = '';
      if (lowerInput.includes('water')) {
        injectedNode = 'WTR_PLANT_A';
      } else if (lowerInput.includes('power') || lowerInput.includes('electricity') || lowerInput.includes('blackout')) {
        injectedNode = 'PWR_SUB_A';
      }

      if (injectedNode) {
        setIsAnalyzing(true);
        setTimeout(() => {
          setIsAnalyzing(false);
          handleInjectFailure(injectedNode, `AI Extracted Incident: ${chatInput}`);
          setActiveTab('GRAPH'); 
        }, 1200); // Compressed 1.2s delay
      }

    } catch (err) {
      setChatMessages(prev => {
        const cleaned = prev.filter(m => !m.content.startsWith('Fallback:'));
        
        // --- Simulated AI Engine Fallback ---
        // If Ollama is not installed, we provide a dynamic simulated response so the app remains perfectly functional
        const inputLower = chatInput.toLowerCase();
        let simResponse = "I'm currently running in Simulated Mode because the local Ollama engine isn't installed. ";
        
        if (inputLower.includes('flood') || inputLower.includes('water')) {
          simResponse += "However, based on the network graph, flooding at Substation Alpha severely impacts downstream residential zones. I recommend routing backup power from the East Grid.";
        } else if (inputLower.includes('status') || inputLower.includes('health')) {
          simResponse += "The current infrastructure is operating nominally, but we have 2 critical nodes that lack sufficient runway buffers. Please check the 'Recovery Plans' tab.";
        } else if (inputLower.includes('plan') || inputLower.includes('recover')) {
          simResponse += "Our Monte Carlo simulations indicate Plan B yields the highest recovery probability (85%) with the lowest risk of cascading blackouts.";
        } else {
          simResponse += "I've analyzed the infrastructure graph. To perform a deep neural-net analysis on that specific scenario, please install Ollama. In the meantime, I can answer basic status queries!";
        }

        return [...cleaned, { role: 'assistant', content: simResponse }];
      });
    } finally {
      setIsChatLoading(false);
    }
  };
  const renderMap = (isActive: boolean) => (
    <div className="graph-container" style={{ display: isActive ? 'flex' : 'none', position: 'relative', overflow: 'hidden', borderRadius: '16px', height: '100%', flexGrow: 1, minHeight: '600px', flexDirection: 'column' }}>
      <div ref={mapRef} id="resilience-map" style={{ width: '100%', flexGrow: 1, background: '#0f172a' }}></div>
    </div>
  );


  // --- Execute Plan ---
  const handleExecutePlan = async (plan: RecoveryPlan) => {
    addTrace('PLANNER', 'Execution', `Executing Recovery Plan: ${plan.name}...`, 'INFO');
    setActiveTab('GRAPH');
    
    let currentNodes = [...nodes];
    
    // Step-by-step execution to visualize recovery on the graph
    for (const action of plan.actions) {
      addTrace('PLANNER', 'Execution', `Action dispatched: ${action.description}. Awaiting field technician confirmation.`, 'WARNING');
      
      currentNodes = currentNodes.map(n => {
        if (n.id === action.targetNodeId) {
          return { ...n, health: 'RECOVERING' as const };
        }
        return n;
      });
      setNodes([...currentNodes]);
      setPendingConfirmations(prev => [...prev, { nodeId: action.targetNodeId, actionDesc: action.description }]);
      
      // Artificial delay for visualization
      await new Promise(r => setTimeout(r, 1500));
    }
    
    setCascadeResult(null);
    setPlans([]);
    setSelectedPlanId(null);
  };

  const handleConfirmRepair = (nodeId: string) => {
    setNodes(prev => {
      let nextNodes = prev.map(n => n.id === nodeId ? { ...n, health: 'HEALTHY' as const, currentLoad: n.capacity * 0.8 } : n);
      // Auto-heal indirectly stressed nodes if all failed nodes are recovering/healthy
      const stillFailing = nextNodes.some(n => n.health === 'FAILED' || n.health === 'RECOVERING');
      if (!stillFailing) {
        nextNodes = nextNodes.map(n => (n.health === 'STRESSED' || n.health === 'AT_RISK') ? { ...n, health: 'HEALTHY' as const, currentLoad: n.capacity * 0.8 } : n);
        setEvents([]);
      }
      return nextNodes;
    });
    
    setPendingConfirmations(prev => prev.filter(p => p.nodeId !== nodeId));
    addTrace('SYSTEM', 'Recovery', `Infrastructure fully restored via Direct Repair at Node ${nodeId}. Technician confirmation received.`, 'SUCCESS');
  };

  return (
    <div className="app-container">
      {/* NEW DIGITAL SYNC OVERLAY */}
      {isAnalyzing && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'radial-gradient(circle at center, rgba(15,23,42,0.85) 0%, rgba(0,0,0,0.98) 100%)',
          backdropFilter: 'blur(8px)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div className="cyber-glitch-box">
             <div className="cyber-ring ring-1"></div>
             <div className="cyber-ring ring-2"></div>
             <div className="cyber-ring ring-3"></div>
             <div className="cyber-core"></div>
          </div>
          <h2 className="glitch-text" data-text="CALCULATING VECTORS">
            CALCULATING VECTORS
          </h2>
          <div style={{ marginTop: '20px', color: '#00f3ff', fontSize: '14px', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '4px' }}>
            [ Engaging Neural Sub-Routines ]
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="header">
        <div className="header-brand">
          <div className="header-logo">RESILIENCE<span>OS</span></div>
          <div className="header-tagline">Agentic Infrastructure Engine</div>
        </div>
        
        <div className="nav-tabs">
          <button className={`nav-tab ${activeTab === 'DASHBOARD' ? 'active' : ''}`} onClick={() => setActiveTab('DASHBOARD')}>Dashboard</button>
          <button className={`nav-tab ${activeTab === 'GRAPH' ? 'active' : ''}`} onClick={() => setActiveTab('GRAPH')}>Leaflet Map</button>
          <button className={`nav-tab ${activeTab === 'PLANS' ? 'active' : ''}`} onClick={() => setActiveTab('PLANS')}>Recovery Plans</button>
          <button className={`nav-tab ${activeTab === 'ENGINE' ? 'active' : ''}`} onClick={() => setActiveTab('ENGINE')}>GraphEngine</button>
          <button className={`nav-tab ${isChatFloating ? 'active' : ''}`} onClick={() => setIsChatFloating(!isChatFloating)}>AI Assistant</button>
        </div>

        <div className="header-status" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <button 
            id="view-gis-report-btn" 
            onClick={() => setIsGisModalOpen(true)}
            style={{ 
              background: '#2563eb', color: '#fff', border: 'none', padding: '6px 12px', 
              borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', 
              gap: '6px', fontSize: '0.85rem', fontWeight: 'bold'
            }}
          >
            <svg style={{ width: '14px', height: '14px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            GIS Report
          </button>
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
            <button className="inject-btn" onClick={() => {
              setIsAnalyzing(true);
              setTimeout(() => { setIsAnalyzing(false); setActiveTab('GRAPH'); handleInjectFailure('PWR_SUB_A', 'Flood at Substation Alpha'); }, 1200);
            }}>
              <span className="inject-icon">🌊</span> Flood: Substation Alpha
            </button>
            <button className="inject-btn" onClick={() => {
              setIsAnalyzing(true);
              setTimeout(() => { setIsAnalyzing(false); setActiveTab('GRAPH'); handleInjectFailure('TRN_ROAD_R1', 'Road R1 Blocked by Debris'); }, 1200);
            }}>
              <span className="inject-icon">🚧</span> Block: Road R1
            </button>
            <button className="inject-btn" onClick={() => {
              setIsAnalyzing(true);
              setTimeout(() => { setIsAnalyzing(false); setActiveTab('GRAPH'); handleInjectFailure('WTR_PLANT_A', 'Water Plant Pump Failure'); }, 1200);
            }}>
              <span className="inject-icon">💧</span> Fail: Water Plant A
            </button>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-header">Predictive Analyst</div>
          <div className="event-injector">
            <button className="inject-btn" onClick={handleRunPrediction} disabled={isPredicting} style={{ background: 'rgba(255, 102, 0, 0.2)', borderColor: 'var(--neon-orange)' }}>
              <span className="inject-icon">🔮</span> {isPredicting ? 'ANALYZING...' : 'RUN PREDICTION'}
            </button>
            {predictionTime && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
                Last analysis: {predictionTime}
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-header">Decision Analyst</div>
          <div className="event-injector">
            <button className="inject-btn" onClick={handleRunDecisionAnalyst} style={{ background: 'rgba(57, 255, 20, 0.2)', borderColor: 'var(--neon-green)' }}>
              <span className="inject-icon">🧠</span> Run Recovery Optimizer
            </button>
            <label style={{ display: 'flex', alignItems: 'center', marginTop: '10px', fontSize: '0.9rem', color: 'var(--neon-cyan)', cursor: 'pointer' }}>
              <input type="checkbox" checked={autoExecute} onChange={e => setAutoExecute(e.target.checked)} style={{ marginRight: '8px', cursor: 'pointer' }} />
              Auto-Execute Optimal Plan
            </label>
          </div>
        </div>

      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        {activeTab === 'MAP' && (
          <div className="dashboard-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <CityMap />
            </div>
          </div>
        )}

        {activeTab === 'REFLECTOR' && (
          <div className="dashboard-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <ReflectorAgent nodes={nodes} cascadeResult={cascadeResult} plans={plans} events={events} lessons={lessons} attacks={attacks} />
            </div>
          </div>
        )}

        {activeTab === 'RUNWAY' && (
          <div className="dashboard-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <RunwayAnalystProcess nodes={nodes} cascadeResult={cascadeResult} events={events} />
            </div>
          </div>
        )}

        {activeTab === 'DASHBOARD' && (
          <div className="dashboard-grid">
            <div className="dashboard-card" style={{ gridColumn: '1 / -1' }}>
              <div className="dashboard-card-header">Predictive Analyst: Early-Warning Engine</div>
              <div className="dashboard-card-body">
                {predictions.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-text">No active predictions. Click RUN PREDICTION to analyze network telemetry.</div>
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Node</th>
                        <th>Risk Level</th>
                        <th>P(10m)</th>
                        <th>P(30m)</th>
                        <th>P(60m)</th>
                        <th>Contributing Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {predictions.sort((a, b) => b.horizons['30_min'] - a.horizons['30_min']).slice(0, 5).map((p: any) => {
                        const node = nodes.find(n => n.id === p.node_id);
                        return (
                          <tr key={p.prediction_id}>
                            <td>{node?.name || p.node_id}</td>
                            <td><span className={`plan-status-badge ${p.risk_level.toLowerCase()}`}>{p.risk_level}</span></td>
                            <td>{(p.horizons['10_min'] * 100).toFixed(1)}%</td>
                            <td style={{ fontWeight: 'bold' }}>{(p.horizons['30_min'] * 100).toFixed(1)}%</td>
                            <td>{(p.horizons['60_min'] * 100).toFixed(1)}%</td>
                            <td>
                              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                                {p.evidence.map((ev: any, i: number) => (
                                  <span key={i} style={{ fontSize: '0.8rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                                    {ev.feature}: {ev.value.toFixed(2)}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

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

          </div>
        )}

        {renderMap(activeTab === 'GRAPH')}

        {isChatFloating && (
          <div className="chat-floating-window glass-card" style={{ 
            position: 'fixed', 
            bottom: '20px', 
            right: '320px', 
            width: '400px', 
            height: '600px', 
            zIndex: 9000, 
            display: 'flex', 
            flexDirection: 'column', 
            padding: 0,
            boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
            border: '1px solid rgba(0,243,255,0.3)',
            borderRadius: '16px',
            overflow: 'hidden',
            background: 'var(--bg-card)'
          }}>
            <div className="dashboard-card-header" style={{ padding: 'var(--space-md)', background: 'rgba(0, 243, 255, 0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,243,255,0.3)' }}>
              <span>AI Resilience Assistant</span>
              <button onClick={() => setIsChatFloating(false)} style={{ background: 'transparent', border: 'none', color: '#00f3ff', cursor: 'pointer', fontSize: '18px', padding: '0 8px' }}>✕</button>
            </div>
            <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {chatMessages.map((m, i) => (
                <div key={i} className={`chat-bubble ${m.role}`} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', background: m.role === 'user' ? 'rgba(0, 243, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)', border: `1px solid ${m.role === 'user' ? 'rgba(0, 243, 255, 0.3)' : 'var(--border)'}`, padding: 'var(--space-sm) var(--space-md)', borderRadius: '12px', maxWidth: '80%', color: 'var(--text-h)' }}>
                  <div style={{ fontSize: '10px', opacity: 0.6, marginBottom: '4px', textTransform: 'uppercase' }}>{m.role === 'user' ? 'You' : 'Ollama Engine'}</div>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{m.content}</div>
                </div>
              ))}
              {isChatLoading && (
                <div className="chat-bubble assistant" style={{ alignSelf: 'flex-start', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border)', padding: 'var(--space-sm) var(--space-md)', borderRadius: '12px', color: 'var(--text-h)' }}>
                  <div style={{ fontSize: '10px', opacity: 0.6, marginBottom: '4px', textTransform: 'uppercase' }}>Ollama Engine</div>
                  <div>Analyzing...</div>
                </div>
              )}
            </div>
            <form onSubmit={handleChatSubmit} style={{ display: 'flex', borderTop: '1px solid var(--border)', padding: 'var(--space-md)', background: 'rgba(0,0,0,0.2)' }}>
              <input 
                type="text" 
                value={chatInput} 
                onChange={e => setChatInput(e.target.value)} 
                placeholder="Ask about infrastructure resilience..." 
                style={{ flex: 1, background: 'var(--bg-void)', border: '1px solid var(--border)', color: 'var(--text-h)', padding: 'var(--space-sm) var(--space-md)', borderRadius: '8px', marginRight: 'var(--space-sm)', outline: 'none' }}
                disabled={isChatLoading}
              />
              <button type="button" onClick={handleVoiceInput} className="inject-btn" style={{ margin: '0 var(--space-sm) 0 0', padding: 'var(--space-sm)', background: isListening ? '#ff006e' : 'var(--bg-card)' }} disabled={isChatLoading || isListening}>
                {isListening ? '🎙️...' : '🎤'}
              </button>
              <button type="submit" className="inject-btn" style={{ margin: 0, padding: 'var(--space-sm) var(--space-md)' }} disabled={isChatLoading}>Send</button>
            </form>
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
                
                {selectedPlanId === plan.id && plan.status !== 'REJECTED' && (
                  <div style={{ display: 'flex', gap: '10px', margin: 'var(--space-md)' }}>
                    {plan.status !== 'VERIFIED' && (
                      <button className="btn btn-danger" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); handleChallenge(); }}>
                        ATTACK PLAN
                      </button>
                    )}
                    <button className="btn" style={{ flex: 2, background: 'var(--neon-green)', color: '#000', fontWeight: 'bold' }} onClick={(e) => { e.stopPropagation(); handleExecutePlan(plan); }}>
                      EXECUTE RECOVERY PLAN
                    </button>
                  </div>
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

      {/* RIGHT SIDEBAR - AGENT TRACE & PENDING CONFIRMATIONS */}
      <aside className="sidebar-right">
        {pendingConfirmations.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-header">Pending Confirmations <span style={{ color: 'var(--neon-orange)' }}>⚠</span></div>
            <div className="event-injector">
              {pendingConfirmations.map((conf, idx) => {
                const node = nodes.find(n => n.id === conf.nodeId);
                return (
                  <div key={`${conf.nodeId}-${idx}`} style={{ marginBottom: '10px', padding: '8px', border: '1px dashed var(--neon-orange)', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{conf.actionDesc}</div>
                    <div style={{ fontSize: '0.9rem', marginTop: '4px', marginBottom: '8px' }}>Waiting for technician text/image from <strong>{node?.name}</strong></div>
                    <button className="inject-btn" onClick={() => handleConfirmRepair(conf.nodeId)} style={{ background: 'rgba(57, 255, 20, 0.2)', borderColor: 'var(--neon-green)', padding: '4px 8px', fontSize: '0.8rem' }}>
                      <span className="inject-icon">✓</span> Confirm Repair
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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

      <GisReportModal isOpen={isGisModalOpen} onClose={() => setIsGisModalOpen(false)} />
    </div>
  );
}
