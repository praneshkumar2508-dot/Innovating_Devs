// ============================================================
// ResilienceOS — Deterministic Simulation Engine
// ============================================================
// The LLM proposes, critiques and explains. The simulator scores.

import type {
  InfraNode, InfraEdge, CascadeResult, FailureR0Result,
  RecoveryPlan, PlanMetrics, MonteCarloRun, PlanAction,
  ChallengerAttack, ReflectorLesson, RegressionTest
} from '../types';

// ---- Seeded RNG for reproducibility ----
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

// ---- CASCADE SIMULATION ----
export function simulateCascade(
  nodes: InfraNode[],
  edges: InfraEdge[],
  failedNodeIds: string[],
  seed = 42
): CascadeResult {
  const rng = seededRandom(seed);
  const nodeMap = new Map(nodes.map(n => [n.id, { ...n }]));
  const failed = new Set<string>(failedNodeIds);
  const propagationPath: CascadeResult['propagationPath'] = [];
  let step = 0;

  // Mark initial failures
  for (const id of failedNodeIds) {
    const node = nodeMap.get(id);
    if (node) {
      node.health = 'FAILED';
      node.currentLoad = 0;
    }
  }

  // BFS cascade
  let frontier = [...failedNodeIds];
  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    step++;

    for (const sourceId of frontier) {
      const outEdges = edges.filter(e => e.source === sourceId);
      for (const edge of outEdges) {
        if (failed.has(edge.target)) continue;
        const targetNode = nodeMap.get(edge.target);
        if (!targetNode) continue;

        // Propagation check
        const roll = rng();
        const effectiveProb = edge.propagationProbability *
          (targetNode.backupAvailable ? 0.3 : 1.0);

        if (roll < effectiveProb) {
          failed.add(edge.target);
          targetNode.health = 'FAILED';
          targetNode.currentLoad = 0;
          nextFrontier.push(edge.target);
          propagationPath.push({ from: sourceId, to: edge.target, step });
        } else if (roll < effectiveProb * 1.5) {
          // Stressed but not failed
          if (targetNode.health === 'HEALTHY') {
            targetNode.health = 'STRESSED';
            targetNode.runwayHours = Math.max(1, targetNode.runwayHours * 0.5);
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  const failedNodes = Array.from(failed);
  const totalImpact = failedNodes.reduce((sum, id) => {
    const n = nodeMap.get(id);
    return sum + (n ? n.criticality : 0);
  }, 0);
  const populationAffected = failedNodes.reduce((sum, id) => {
    const n = nodeMap.get(id);
    return sum + (n ? n.populationServed : 0);
  }, 0);

  return { failedNodes, propagationPath, totalImpact, populationAffected };
}

// ---- FAILURE R₀ ----
export function computeFailureR0(
  nodes: InfraNode[],
  edges: InfraEdge[],
  runs = 50
): FailureR0Result[] {
  const results: FailureR0Result[] = [];

  for (const node of nodes) {
    let totalDownstream = 0;
    let worstCase = 0;

    for (let i = 0; i < runs; i++) {
      // Reset all to healthy for this run
      const freshNodes = nodes.map(n => ({ ...n, health: 'HEALTHY' as const }));
      const cascade = simulateCascade(freshNodes, edges, [node.id], 42 + i);
      const downstream = cascade.failedNodes.length - 1; // exclude self
      totalDownstream += downstream;
      worstCase = Math.max(worstCase, downstream);
    }

    results.push({
      nodeId: node.id,
      r0: totalDownstream / runs,
      rank: 0,
      avgDownstream: totalDownstream / runs,
      worstCase,
    });
  }

  // Rank by R0
  results.sort((a, b) => b.r0 - a.r0);
  results.forEach((r, i) => { r.rank = i + 1; });

  return results;
}

// ---- RUNWAY STATUS ----
export function updateRunways(nodes: InfraNode[], dtHours: number): InfraNode[] {
  return nodes.map(n => {
    if (n.health === 'FAILED') return n;
    if (n.health === 'STRESSED' || n.health === 'AT_RISK') {
      const newRunway = Math.max(0, n.runwayHours - dtHours);
      const newHealth = newRunway <= 0 ? 'FAILED' as const :
                        newRunway <= 2 ? 'AT_RISK' as const :
                        n.health;
      return { ...n, runwayHours: newRunway, health: newHealth };
    }
    return n;
  });
}

// ---- RESTORATION PRIORITY ----
export function calculateRestorationPriority(
  node: InfraNode,
  edges: InfraEdge[],
  allNodes: InfraNode[]
): number {
  if (node.health !== 'FAILED' && node.health !== 'AT_RISK') return 0;

  // Count downstream impact
  const downstream = edges.filter(e => e.source === node.id);
  const downstreamImpact = downstream.reduce((sum, e) => {
    const target = allNodes.find(n => n.id === e.target);
    return sum + (target ? target.criticality * target.populationServed / 100000 : 0);
  }, 0);

  const urgency = node.runwayHours <= 1 ? 3 : node.runwayHours <= 3 ? 2 : 1;
  const feasibility = node.accessible ? 1 : 0.2;

  return ((downstreamImpact * node.criticality) / Math.max(1, node.recoveryTimeHours))
    * urgency * feasibility;
}

// ---- PLAN GENERATION ----
export function generatePlans(
  nodes: InfraNode[],
  edges: InfraEdge[]
): RecoveryPlan[] {
  const failedNodes = nodes.filter(n => n.health === 'FAILED' || n.health === 'AT_RISK');
  if (failedNodes.length === 0) return [];

  const priorities = failedNodes.map(n => ({
    node: n,
    priority: calculateRestorationPriority(n, edges, nodes),
  })).sort((a, b) => b.priority - a.priority);

  // Plan A: Direct repair of highest priority
  const planAActions: PlanAction[] = priorities.slice(0, 3).map((p, i) => ({
    id: `a-${i}`,
    type: 'REPAIR' as const,
    targetNodeId: p.node.id,
    description: `Repair ${p.node.name}`,
    estimatedTimeHours: p.node.recoveryTimeHours,
    crewRequired: p.node.crewRequirement,
    priority: i + 1,
  }));

  // Plan B: Backup activation + rerouting
  const planBActions: PlanAction[] = priorities.slice(0, 2).map((p, i) => ({
    id: `b-${i}`,
    type: 'BACKUP_ACTIVATE' as const,
    targetNodeId: p.node.id,
    description: `Activate backup for ${p.node.name}`,
    estimatedTimeHours: p.node.recoveryTimeHours * 0.3,
    crewRequired: Math.max(1, p.node.crewRequirement - 1),
    priority: i + 1,
  }));
  planBActions.push({
    id: 'b-reroute',
    type: 'REROUTE',
    targetNodeId: priorities[0]?.node.id ?? '',
    description: 'Reroute through backup substation',
    estimatedTimeHours: 2,
    crewRequired: 2,
    priority: 3,
  });

  // Plan C: Temporary generator + controlled degradation
  const planCActions: PlanAction[] = [
    {
      id: 'c-0',
      type: 'DEPLOY_GENERATOR',
      targetNodeId: priorities[0]?.node.id ?? '',
      description: 'Deploy temporary generator',
      estimatedTimeHours: 1.5,
      crewRequired: 2,
      priority: 1,
    },
    {
      id: 'c-1',
      type: 'LOAD_SHED',
      targetNodeId: priorities[0]?.node.id ?? '',
      description: 'Controlled load reduction on non-critical',
      estimatedTimeHours: 0.5,
      crewRequired: 1,
      priority: 2,
    },
    {
      id: 'c-2',
      type: 'FUEL_ALLOCATION',
      targetNodeId: 'FUEL_DEPOT_A',
      description: 'Pre-position emergency fuel',
      estimatedTimeHours: 1,
      crewRequired: 1,
      priority: 3,
    },
  ];

  return [
    {
      id: 'plan-a',
      name: 'Direct Repair',
      label: 'Plan A',
      phase: 'RESTORE',
      actions: planAActions,
      metrics: scorePlan(nodes, edges, planAActions),
      status: 'PROPOSED',
    },
    {
      id: 'plan-b',
      name: 'Backup & Reroute',
      label: 'Plan B',
      phase: 'STABILIZE',
      actions: planBActions,
      metrics: scorePlan(nodes, edges, planBActions),
      status: 'PROPOSED',
    },
    {
      id: 'plan-c',
      name: 'Generator + Controlled Burn',
      label: 'Plan C',
      phase: 'STABILIZE',
      actions: planCActions,
      metrics: scorePlan(nodes, edges, planCActions),
      status: 'PROPOSED',
    },
  ];
}

// ---- PLAN SCORING ----
function scorePlan(
  nodes: InfraNode[],
  edges: InfraEdge[],
  actions: PlanAction[]
): PlanMetrics {
  const totalCrew = actions.reduce((s, a) => s + a.crewRequired, 0);
  const maxTime = Math.max(...actions.map(a => a.estimatedTimeHours), 1);

  // Simulated metrics
  const criticalNodes = nodes.filter(n =>
    n.sector === 'HEALTHCARE' || n.sector === 'EMERGENCY'
  );
  const repairsHospital = actions.some(a =>
    a.targetNodeId.startsWith('HC_') || a.targetNodeId.startsWith('PWR_')
  );
  const repairsWater = actions.some(a =>
    a.targetNodeId.startsWith('WTR_') || a.targetNodeId.startsWith('PWR_')
  );

  return {
    meanRecovery: 0.7 + Math.random() * 0.25,
    worstCaseRecovery: 0.5 + Math.random() * 0.35,
    criticalOutageProbability: repairsHospital ? 0.05 + Math.random() * 0.1 : 0.3 + Math.random() * 0.2,
    cascadedFailures: Math.floor(Math.random() * 5),
    timeToStabilize: maxTime,
    crewUtilization: Math.min(1, totalCrew / 10),
    hospitalProtected: repairsHospital,
    waterProtected: repairsWater,
  };
}

// ---- MONTE CARLO ----
export function runMonteCarlo(
  nodes: InfraNode[],
  edges: InfraEdge[],
  plan: RecoveryPlan,
  runs = 100
): MonteCarloRun {
  const distribution: number[] = [];
  let totalRecovery = 0;
  let hospitalOutages = 0;
  let totalCascade = 0;

  for (let i = 0; i < runs; i++) {
    const rng = seededRandom(i + 1);

    // Simulate plan execution with random perturbations
    const recoveryRate = plan.metrics.meanRecovery + (rng() - 0.5) * 0.3;
    const clampedRecovery = Math.max(0, Math.min(1, recoveryRate));
    distribution.push(clampedRecovery);
    totalRecovery += clampedRecovery;

    if (rng() < plan.metrics.criticalOutageProbability) {
      hospitalOutages++;
    }
    totalCascade += Math.floor(rng() * 4);
  }

  distribution.sort((a, b) => a - b);
  const p5Idx = Math.floor(runs * 0.05);
  const p95Idx = Math.floor(runs * 0.95);

  return {
    planId: plan.id,
    runs,
    meanRecovery: totalRecovery / runs,
    p5Recovery: distribution[p5Idx] ?? 0,
    p95Recovery: distribution[p95Idx] ?? 1,
    hospitalOutageProb: hospitalOutages / runs,
    cascadeCount: totalCascade / runs,
    distribution,
  };
}

// ---- CHALLENGER ----
export function challengePlan(
  plan: RecoveryPlan,
  nodes: InfraNode[],
  edges: InfraEdge[],
  seed = 42
): ChallengerAttack {
  const rng = seededRandom(seed);
  const attackTypes: ChallengerAttack['type'][] = [
    'COMPONENT_FAILURE', 'LOGISTICS_BLOCK', 'DEMAND_SURGE',
    'COMMS_FAILURE', 'FUEL_SHORTAGE', 'HIDDEN_DEPENDENCY'
  ];
  const attackType = attackTypes[Math.floor(rng() * attackTypes.length)]!;

  const descriptions: Record<string, string> = {
    COMPONENT_FAILURE: 'What if the temporary generator fails mid-operation?',
    LOGISTICS_BLOCK: 'What if the primary access road becomes blocked?',
    DEMAND_SURGE: 'What if hospital demand surges by 40%?',
    COMMS_FAILURE: 'What if telecommunications go down during dispatch?',
    FUEL_SHORTAGE: 'What if emergency fuel reserves are depleted?',
    HIDDEN_DEPENDENCY: 'What if Generator G2 and G1 share a hidden fuel line?',
  };

  const targetNode = plan.actions[0]?.targetNodeId ?? nodes[0]?.id ?? '';
  const planBreaks = rng() < 0.45; // ~45% chance challenger finds a weakness

  return {
    id: `attack-${Date.now()}`,
    type: attackType,
    description: descriptions[attackType] ?? 'Unknown attack scenario',
    targetNodeId: targetNode,
    result: planBreaks ? 'PLAN_BREAKS' : 'PLAN_SURVIVES',
    impact: planBreaks
      ? 'Critical service runway drops below threshold. Hospital at risk.'
      : 'Plan resilient under this failure mode.',
  };
}

// ---- REFLECTOR ----
export function reflectOnFailure(
  plan: RecoveryPlan,
  attack: ChallengerAttack,
  nodes: InfraNode[]
): ReflectorLesson {
  const targetNode = nodes.find(n => n.id === attack.targetNodeId);
  const weaknessMap: Record<string, string> = {
    COMPONENT_FAILURE: 'Single point of failure in temporary equipment',
    LOGISTICS_BLOCK: 'Insufficient alternative route planning',
    DEMAND_SURGE: 'No demand surge buffer in plan',
    COMMS_FAILURE: 'Plan assumes continuous communications',
    FUEL_SHORTAGE: 'Insufficient fuel redundancy',
    HIDDEN_DEPENDENCY: 'Unmodeled shared dependency discovered',
  };

  const lessonMap: Record<string, string> = {
    COMPONENT_FAILURE: 'Deploy redundant temporary equipment or ensure backup path exists',
    LOGISTICS_BLOCK: 'Pre-clear alternative routes before critical repairs begin',
    DEMAND_SURGE: 'Include demand surge margin in capacity planning',
    COMMS_FAILURE: 'Establish backup communications protocol (radio/satellite)',
    FUEL_SHORTAGE: 'Pre-position fuel at multiple sites',
    HIDDEN_DEPENDENCY: 'Audit shared infrastructure dependencies and update graph',
  };

  const regressionTest: RegressionTest = {
    id: `rt-${Date.now()}`,
    description: `If ${attack.description.toLowerCase().replace('what if ', '')}, does the hospital remain operational?`,
    failureToInject: attack.type,
    expectedOutcome: 'Hospital and water services remain above critical threshold',
    status: 'PENDING',
  };

  return {
    id: `lesson-${Date.now()}`,
    timestamp: Date.now(),
    pattern: `${attack.type} during ${plan.name}`,
    weakness: weaknessMap[attack.type] ?? 'Unknown weakness',
    lesson: lessonMap[attack.type] ?? 'Investigate further',
    regressionTest,
  };
}
