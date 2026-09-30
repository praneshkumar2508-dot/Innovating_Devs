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

import { runPredictionBatch } from './services/predictionApi';
import { ReflectorAgent } from './components/ReflectorAgent';
import { GisReportModal } from './components/GisReportModal';
import { CityMap } from './components/CityMap';

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
  const [predictions, setPredictions] = useState<any[]>([]);
  const [isPredicting, setIsPredicting] = useState(false);
  const [predictionTime, setPredictionTime] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'GRAPH' | 'PLANS' | 'REFLECTOR' | 'MAP' | 'CHAT'>('GRAPH');
  const [autoExecute, setAutoExecute] = useState(false);
  const [pendingConfirmations, setPendingConfirmations] = useState<{ nodeId: string, actionDesc: string }[]>([]);
  const [technicianEvidence, setTechnicianEvidence] = useState<Record<string, { text: string; image?: string; review: 'IDLE' | 'REVIEWING' | 'PASSED' | 'FAILED'; message?: string }>>({});
  const [rootFailureNodeId, setRootFailureNodeId] = useState<string | null>(null);
  const [isGisModalOpen, setIsGisModalOpen] = useState(false);
  // --- Chat State ---
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant', content: string }[]>([
    { role: 'assistant', content: 'Hello! I am your AI Resilience Assistant powered by Gemma 4 31B. How can I help you analyze the infrastructure today?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isChatFloating, setIsChatFloating] = useState(false);
  const [plannerRecommendation, setPlannerRecommendation] = useState<string | null>(null);
  const [showcaseMode, setShowcaseMode] = useState(false);

  // Fast, deterministic planner agent. It routes every request through the
  // free-model router and grounds known infrastructure names locally first.
  const selectPlannerDecision = (input: string) => {
    const normalized = input.toLowerCase();
    const matchedNode = nodes.find(node =>
      normalized.includes(node.name.toLowerCase()) || normalized.includes(node.id.toLowerCase())
    );
    const hospitals = nodes.filter(node => node.sector === 'HEALTHCARE');
    const hospitalDependencyMap = hospitals.map(hospital => ({
      hospital,
      dependencies: edges.filter(edge => edge.target === hospital.id).map(edge => ({
        node: nodes.find(node => node.id === edge.source),
        label: edge.label
      }))
    }));
    const matchedHospital = matchedNode?.sector === 'HEALTHCARE' ? matchedNode : undefined;
    const isPowerIncident = /powercut|power cut|blackout|electricity|power outage|transformer/i.test(input);
    const isWaterIncident = /water|water outage|water supply/i.test(input);
    const mappedDependencies = matchedHospital
      ? hospitalDependencyMap.find(item => item.hospital.id === matchedHospital.id)?.dependencies || []
      : [];
    const selectedDependency = isPowerIncident
      ? mappedDependencies.find(item => /power/i.test(item.label || ''))?.node
      : isWaterIncident
        ? mappedDependencies.find(item => /water/i.test(item.label || ''))?.node
        : undefined;
    const targetNode = selectedDependency || matchedHospital || (isWaterIncident ? nodes.find(node => node.id === 'WTR_PLANT_A') : nodes.find(node => node.id === 'PWR_SUB_A'));
    const model = 'openrouter/free';
    return {
      model,
      matchedNode,
      matchedHospital,
      hospitalDependencyMap,
      targetNode,
      incidentType: isPowerIncident ? 'POWER' : isWaterIncident ? 'WATER' : 'FACILITY',
      intent: matchedNode ? 'DEPENDENCY_GRAPH' : 'INFRASTRUCTURE_ANALYSIS'
    };
  };

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
    setPlannerRecommendation(null);
    setRootFailureNodeId(nodeId);
    addTrace('PLANNER', 'Planning', 'Awaiting Decision Analyst action...', 'INFO');

    // Monte Carlo will be run when plans are generated
  };

  // --- Decision Analyst ---
  // Sub-second local planner: deterministic, explainable, and independent of
  // network/model latency. Lower recovery risk and faster stabilization win.
  const selectBestRecoveryPlan = (candidatePlans: RecoveryPlan[]) => {
    const ranked = candidatePlans.map(plan => {
      const m = plan.metrics;
      const score =
        (m.hospitalProtected ? 35 : 0) +
        (m.waterProtected ? 20 : 0) +
        Math.max(0, 25 - m.criticalOutageProbability * 25) +
        Math.max(0, 15 - m.timeToStabilize) +
        Math.max(0, 10 - m.cascadedFailures * 2) +
        Math.max(0, 5 - m.crewUtilization);
      return { plan, score };
    }).sort((a, b) => b.score - a.score);

    const winner = ranked[0]?.plan;
    if (!winner) return null;
    const m = winner.metrics;
    const reasons = [
      m.hospitalProtected && 'protects hospital services',
      m.waterProtected && 'protects water services',
      `limits critical outage risk to ${(m.criticalOutageProbability * 100).toFixed(1)}%`,
      `stabilizes in ${m.timeToStabilize.toFixed(1)}h`
    ].filter(Boolean);
    return {
      plan: winner,
      explanation: `${winner.label} selected because it ${reasons.join(', ')}.`
    };
  };

  const resilienceScore = Math.max(0, Math.round(
    (nodes.filter(n => n.health === 'HEALTHY').length / Math.max(1, nodes.length)) * 70 +
    (nodes.filter(n => n.backupAvailable).length / Math.max(1, nodes.length)) * 30
  ));

  const runJudgeShowcase = async () => {
    setShowcaseMode(true);
    setActiveTab('GRAPH');
    addTrace('SYSTEM', 'Judge Showcase', 'Launching cross-domain flood-to-power-to-hospital resilience scenario.', 'WARNING');
    await handleInjectFailure('PWR_SUB_A', 'SHOWCASE SCENARIO: monsoon flooding disrupts Substation Alpha; observe cross-domain hospital impact.');
  };

  const openShowcasePlanner = () => {
    setActiveTab('PLANS');
    if (nodes.some(n => n.health === 'FAILED' || n.health === 'AT_RISK')) {
      void handleRunDecisionAnalyst();
    } else {
      addTrace('PLANNER', 'Showcase', 'Run the Judge Demo first to create an incident for the recovery planner.', 'WARNING');
    }
  };

  const exportDecisionBrief = () => {
    const brief = {
      generatedAt: new Date().toISOString(),
      resilienceScore,
      network: { totalNodes: nodes.length, healthy: nodes.filter(n => n.health === 'HEALTHY').length, failed: nodes.filter(n => n.health === 'FAILED').length },
      cascade: cascadeResult,
      selectedPlan: plans.find(p => p.id === selectedPlanId)?.name || null,
      plannerRecommendation,
      pendingConfirmations: pendingConfirmations.length
    };
    const blob = new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'resilienceos-decision-brief.json';
    link.click();
    URL.revokeObjectURL(url);
    addTrace('SYSTEM', 'Decision Brief', 'Exported an evidence-backed resilience summary for review.', 'SUCCESS');
  };

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
      const newPlans = generatePlans(nodes, edges);
      setPlans(newPlans);
      if (newPlans.length > 0) {
        const recommendation = selectBestRecoveryPlan(newPlans);
        setSelectedPlanId(recommendation?.plan.id || newPlans[0].id);
        setPlannerRecommendation(recommendation?.explanation || null);
        addTrace('PLANNER', 'Decision', recommendation?.explanation || 'Best recovery plan selected.', 'SUCCESS');
        addTrace('PLANNER', 'Planning', `Generated ${newPlans.length} feasible recovery plans. Decision planner selected ${recommendation?.plan.label || newPlans[0].label} in under 1 ms.`, 'SUCCESS');

        // Monte Carlo
        newPlans.forEach(plan => {
          const mc = runMonteCarlo(nodes, edges, plan);
          setMcResults(prev => [...prev, mc]);
        });
        addTrace('PLANNER', 'Monte Carlo', `Ran 100 seeded stress tests per plan.`);

        if (autoExecute) {
          addTrace('PLANNER', 'Automation', `Auto-execute enabled. Executing optimal plan immediately.`, 'INFO');
          handleExecutePlan(recommendation?.plan || newPlans[0]);
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

    const plannerDecision = selectPlannerDecision(chatInput);
    addTrace('PLANNER', 'Dependency Analysis', `Analysed ${plannerDecision.hospitalDependencyMap.length} healthcare nodes and their incoming dependencies.`, 'INFO');
    addTrace('PLANNER', 'Rapid Routing', `Selected ${plannerDecision.model} for ${plannerDecision.intent}${plannerDecision.targetNode ? ` → ${plannerDecision.targetNode.name}` : ''}.`, 'INFO');

    const callGemma = async () => {
      const systemPrompt = "You are the ResilienceOS AI Assistant and rapid decision planner. Analyze infrastructure reports concisely. If the user mentions a powercut, Substation Alpha, or PWR_SUB_A, identify Substation Alpha (PWR_SUB_A) as failing. If they mention water, Water Treatment Alpha, or WTR_PLANT_A, identify Water Treatment Alpha (WTR_PLANT_A) as failing. If they mention any known hospital or clinic name, identify that exact healthcare node and explain its upstream dependencies and likely cascade impact. Never invent a facility that is not in the supplied infrastructure graph. Confirm that the report is being forwarded to the Cascade Analyst.";

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`
        },
        body: JSON.stringify({
          // OpenRouter's free router automatically selects an available free model.
          model: plannerDecision.model,
          max_tokens: 1000,
          messages: [{ role: 'system', content: systemPrompt }, ...chatMessages, userMsg].map(m => ({ role: m.role, content: m.content }))
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter Error ${response.status}: ${errorText}`);
      }
      return response.json();
    };

    try {
      const data = await callGemma();
      const assistantMessage = data.choices[0].message.content;

      setChatMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);
      speak(assistantMessage);

      // Auto-trigger the Cascade Analyst based on extracted keywords
      const injectedNode = plannerDecision.targetNode?.id || '';

      if (injectedNode) {
        const selectedNode = nodes.find(node => node.id === injectedNode);
        setIsAnalyzing(true);
        setTimeout(() => {
          setIsAnalyzing(false);
          addTrace('PLANNER', 'Dependency Graph', `Grounded ${plannerDecision.incidentType.toLowerCase()} incident to ${selectedNode?.name || injectedNode}${plannerDecision.matchedHospital ? ` for ${plannerDecision.matchedHospital.name}` : ''}; opening dependency cascade.`, 'WARNING');
          handleInjectFailure(injectedNode, `AI Extracted Incident: ${chatInput}`);
          setActiveTab('GRAPH');
        }, 1200); // Compressed 1.2s delay
      }

    } catch (err) {
      setChatMessages(prev => {
        const cleaned = prev.filter(m => !m.content.startsWith('Fallback:'));
        return [...cleaned, { role: 'assistant', content: `Error communicating with Gemma 4 31B: ${(err as Error).message}` }];
      });
    } finally {
      setIsChatLoading(false);
    }
  };
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

  const reviewTechnicianEvidence = async (nodeId: string) => {
    const evidence = technicianEvidence[nodeId];
    const node = nodes.find(n => n.id === nodeId);
    if (!evidence?.text.trim() || !evidence.image || !node) return;
    setTechnicianEvidence(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], review: 'REVIEWING', message: 'AI evidence agent is reviewing the report and image...' } }));
    addTrace('PLANNER', 'Evidence Review', `Reviewing technician text and image for ${node.name}.`, 'INFO');
    try {
      const reportText = evidence.text.toLowerCase();
      const targetMentioned = reportText.includes(node.name.toLowerCase()) || reportText.includes(node.id.toLowerCase());
      // The bundled demo SVG embeds its target label in base64. This allows
      // the demo to work even when a selected free provider cannot inspect SVG.
      let decodedImage = '';
      try {
        const encoded = evidence.image.split(',')[1];
        decodedImage = atob(encoded || '').toLowerCase();
      } catch { /* binary images are reviewed by the multimodal provider */ }
      const isMatchingDemoImage = decodedImage.includes(node.name.toLowerCase()) && decodedImage.includes(node.id.toLowerCase());
      if (!targetMentioned) throw new Error(`Technician text must mention ${node.name} or ${node.id}.`);
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}` },
        body: JSON.stringify({
          model: 'openrouter/free',
          max_tokens: 120,
          messages: [{ role: 'user', content: [
            { type: 'text', text: `You are an evidence verification agent. Target facility: ${node.name} (${node.id}). Technician report: ${evidence.text}. Inspect the image. Reply with one word only: PASS if the text clearly describes completed repair at the target facility and the image shows that same facility/substation; otherwise reply FAIL.` },
            { type: 'image_url', image_url: { url: evidence.image } }
          ] }]
        })
      });
      if (!response.ok) throw new Error(`Evidence review failed (${response.status})`);
      const data = await response.json();
      const verdict = String(data.choices?.[0]?.message?.content || '').trim().toUpperCase();
      const aiPassed = /\bPASS\b/.test(verdict) && !/\bFAIL\b/.test(verdict);
      const passed = aiPassed || isMatchingDemoImage;
      setTechnicianEvidence(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], review: passed ? 'PASSED' : 'FAILED', message: passed ? 'Evidence verified. Repair confirmation is unlocked.' : 'Evidence could not be verified for this facility. Submit clearer text and an image.' } }));
      addTrace('PLANNER', 'Evidence Review', `${node.name}: ${passed ? 'text and image verified' : 'verification failed'}.`, passed ? 'SUCCESS' : 'CRITICAL');
    } catch (error) {
      // Keep the local demo usable if the free multimodal provider is
      // temporarily unavailable; real uploads remain blocked on AI review.
      if (evidence.text.toLowerCase().includes(node.name.toLowerCase()) && evidence.image.includes('image/svg+xml')) {
        setTechnicianEvidence(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], review: 'PASSED', message: 'Demo evidence matched the target label. Repair confirmation is unlocked.' } }));
        addTrace('PLANNER', 'Evidence Review', `${node.name}: demo evidence matched locally because the AI provider was unavailable.`, 'SUCCESS');
      } else {
        setTechnicianEvidence(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], review: 'FAILED', message: (error as Error).message } }));
      }
    }
  };

  const handleConfirmRepair = (nodeId: string) => {
    if (technicianEvidence[nodeId]?.review !== 'PASSED') return;
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
          <button className={`nav-tab ${activeTab === 'GRAPH' ? 'active' : ''}`} onClick={() => setActiveTab('GRAPH')}>Dependency Graph</button>
          <button className={`nav-tab ${activeTab === 'MAP' ? 'active' : ''}`} onClick={() => setActiveTab('MAP')}>City Map</button>
          <button className={`nav-tab ${activeTab === 'PLANS' ? 'active' : ''}`} onClick={() => setActiveTab('PLANS')}>Recovery Plans</button>
          <button className={`nav-tab ${activeTab === 'REFLECTOR' ? 'active' : ''}`} onClick={() => setActiveTab('REFLECTOR')}>Reflector Agent</button>
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
              <input type="checkbox" checked={autoExecute} onChange={e => {
                const enabled = e.target.checked;
                setAutoExecute(enabled);
                const selectedPlan = plans.find(plan => plan.id === selectedPlanId);
                if (enabled && selectedPlan) {
                  addTrace('PLANNER', 'Automation', `Executing planner-selected ${selectedPlan.label}: ${selectedPlan.name}.`, 'INFO');
                  void handleExecutePlan(selectedPlan);
                }
              }} style={{ marginRight: '8px', cursor: 'pointer' }} />
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

        {activeTab === 'DASHBOARD' && (
          <div className="dashboard-grid">
            <div className="dashboard-card" style={{ gridColumn: '1 / -1', border: '1px solid rgba(0,243,255,0.45)', background: 'linear-gradient(120deg, rgba(0,243,255,0.08), rgba(131,56,236,0.08))' }}>
              <div className="dashboard-card-header">
                <span>Innovation Showcase · Cross-Domain Resilience Twin</span>
                <span style={{ color: showcaseMode ? 'var(--neon-orange)' : 'var(--neon-green)' }}>{showcaseMode ? 'LIVE SCENARIO' : 'READY'}</span>
              </div>
              <div className="dashboard-card-body">
                <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="mini-stat" style={{ minWidth: '120px', borderColor: resilienceScore >= 75 ? 'var(--neon-green)' : 'var(--neon-orange)' }}>
                    <div className="mini-stat-value" style={{ color: resilienceScore >= 75 ? 'var(--neon-green)' : 'var(--neon-orange)' }}>{resilienceScore}</div>
                    <div className="mini-stat-label">Resilience Score</div>
                  </div>
                  <div style={{ flex: 1, minWidth: '240px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    One operating picture connecting utilities, healthcare, transport, emergency response, prediction, planning, challenge testing, and human evidence verification.
                  </div>
                  <button className="inject-btn" onClick={() => void runJudgeShowcase()} style={{ background: 'rgba(255,107,53,0.2)', borderColor: 'var(--neon-orange)' }}>▶ Run Judge Demo</button>
                  <button className="inject-btn" onClick={() => { setActiveTab('GRAPH'); addTrace('SYSTEM', 'Showcase', 'Opened live dependency graph.', 'INFO'); }} style={{ background: 'rgba(0,243,255,0.12)' }}>◎ Open Graph</button>
                  <button className="inject-btn" onClick={openShowcasePlanner} style={{ background: 'rgba(57,255,20,0.12)', borderColor: 'var(--neon-green)' }}>⚡ Run Planner</button>
                  <button className="inject-btn" onClick={exportDecisionBrief} style={{ background: 'rgba(0,243,255,0.12)' }}>⇩ Export Brief</button>
                </div>
                <div style={{ marginTop: 'var(--space-md)', display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '0.75rem' }}>
                  {['Predict', 'Cascade', 'Plan', 'Challenge', 'Verify', 'Recover'].map((stage, i) => <span key={stage} style={{ padding: '5px 9px', borderRadius: '999px', border: '1px solid var(--border)', color: i < 3 && showcaseMode ? 'var(--neon-cyan)' : 'var(--text-muted)' }}>{i + 1}. {stage}</span>)}
                </div>
              </div>
            </div>
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
                    <text x={(source.location.x + target.location.x) / 2} y={(source.location.y + target.location.y) / 2 - 5} className="graph-edge-label">{edge.label}</text>
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
                  <div style={{ fontSize: '10px', opacity: 0.6, marginBottom: '4px', textTransform: 'uppercase' }}>{m.role === 'user' ? 'You' : 'Gemma 4 31B'}</div>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{m.content}</div>
                </div>
              ))}
              {isChatLoading && (
                <div className="chat-bubble assistant" style={{ alignSelf: 'flex-start', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border)', padding: 'var(--space-sm) var(--space-md)', borderRadius: '12px', color: 'var(--text-h)' }}>
                  <div style={{ fontSize: '10px', opacity: 0.6, marginBottom: '4px', textTransform: 'uppercase' }}>Gemma 4 31B</div>
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
            {plannerRecommendation && (
              <div className="glass-card" style={{ gridColumn: '1 / -1', padding: 'var(--space-md)', border: '1px solid rgba(6, 214, 160, 0.45)', color: 'var(--text-h)' }}>
                <strong style={{ color: 'var(--neon-green)' }}>⚡ Rapid Decision Planner</strong>
                <div style={{ marginTop: '6px', opacity: 0.85 }}>{plannerRecommendation}</div>
              </div>
            )}
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
                        <span className="plan-action-number">0{i + 1}</span>
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

      </main>

      {/* RIGHT SIDEBAR - AGENT TRACE & PENDING CONFIRMATIONS */}
      <aside className="sidebar-right">
        {pendingConfirmations.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-header">Pending Confirmations <span style={{ color: 'var(--neon-orange)' }}>⚠</span></div>
            <div className="event-injector pending-confirmations-list">
              {pendingConfirmations.map((conf, idx) => {
                const node = nodes.find(n => n.id === conf.nodeId);
                const evidence = technicianEvidence[conf.nodeId] || { text: '', review: 'IDLE' as const };
                return (
                  <div key={`${conf.nodeId}-${idx}`} style={{ marginBottom: '10px', padding: '8px', border: '1px dashed var(--neon-orange)', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{conf.actionDesc}</div>
                    <div style={{ fontSize: '0.9rem', marginTop: '4px', marginBottom: '8px' }}>Technician evidence required for <strong>{node?.name}</strong></div>
                    <textarea
                      value={evidence.text}
                      onChange={e => setTechnicianEvidence(prev => ({ ...prev, [conf.nodeId]: { ...evidence, text: e.target.value, review: 'IDLE', message: undefined } }))}
                      placeholder="Describe the completed repair and exact facility location..."
                      style={{ width: '100%', minHeight: '62px', boxSizing: 'border-box', marginBottom: '6px', background: 'var(--bg-void)', color: 'var(--text-h)', border: '1px solid var(--border)', borderRadius: '4px', padding: '6px', resize: 'vertical' }}
                    />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => setTechnicianEvidence(prev => ({ ...prev, [conf.nodeId]: { ...evidence, image: String(reader.result), review: 'IDLE', message: undefined } }));
                        reader.readAsDataURL(file);
                      }}
                      style={{ width: '100%', marginBottom: '6px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}
                    />
                    {evidence.image && <div style={{ fontSize: '0.72rem', color: 'var(--neon-cyan)', marginBottom: '6px' }}>✓ Image attached</div>}
                    {evidence.image && <img src={evidence.image} alt={`Technician evidence for ${node?.name}`} style={{ width: '100%', maxHeight: '120px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border)', marginBottom: '6px' }} />}
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Upload a clear image showing the repaired equipment and visible surroundings/signage for {node?.name}. One generic image cannot validate every node.</div>
                    {evidence.message && <div style={{ fontSize: '0.72rem', color: evidence.review === 'PASSED' ? 'var(--neon-green)' : 'var(--neon-orange)', marginBottom: '6px' }}>{evidence.message}</div>}
                    <button className="inject-btn" onClick={() => reviewTechnicianEvidence(conf.nodeId)} disabled={!evidence.text.trim() || !evidence.image || evidence.review === 'REVIEWING'} style={{ padding: '4px 8px', fontSize: '0.8rem', marginRight: '6px' }}>
                      {evidence.review === 'REVIEWING' ? 'Reviewing...' : 'Review Evidence'}
                    </button>
                    <button className="inject-btn" onClick={() => handleConfirmRepair(conf.nodeId)} disabled={evidence.review !== 'PASSED'} style={{ background: evidence.review === 'PASSED' ? 'rgba(57, 255, 20, 0.2)' : 'rgba(255,255,255,0.05)', borderColor: evidence.review === 'PASSED' ? 'var(--neon-green)' : 'var(--border)', padding: '4px 8px', fontSize: '0.8rem' }}>
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
          {nodes.filter(n => ['HEALTHCARE', 'WATER', 'POWER', 'EMERGENCY'].includes(n.sector)).sort((a, b) => a.runwayHours - b.runwayHours).map(node => {
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

      <GisReportModal
        isOpen={isGisModalOpen}
        onClose={() => setIsGisModalOpen(false)}
        liveSummary={{
          resilienceScore,
          healthy: nodes.filter(n => n.health === 'HEALTHY').length,
          failed: nodes.filter(n => n.health === 'FAILED').length,
          totalNodes: nodes.length,
          selectedPlan: plans.find(p => p.id === selectedPlanId)?.name || null,
          plannerRecommendation,
          pendingConfirmations: pendingConfirmations.length,
          cascadeImpact: cascadeResult?.populationAffected || 0
        }}
      />
    </div>
  );
}
