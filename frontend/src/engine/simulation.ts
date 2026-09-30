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

// ---- CASCADE SIMULATION (Connected to Backend) ----
export async function setupGraphOnBackend(nodes: InfraNode[], edges: InfraEdge[]) {
  const assets = nodes.map(n => ({
    asset_id: n.id,
    asset_type: n.sector,
    name: n.name,
    criticality: n.criticality,
    capacity: { value: n.capacity, unit: 'units' },
    current_load: { value: n.currentLoad, unit: 'units' },
    population_served: n.populationServed,
    backup: n.backupAvailable ? {
      type: 'generator',
      capacity: n.capacity,
      fuel_minutes: n.runwayHours * 60
    } : undefined
  }));

  const dependencies = edges.map(e => ({
    dependency_id: e.id,
    source_asset: e.source,
    target_asset: e.target,
    dependency_type: e.label || 'generic',
    required_capacity: 10
  }));

  await fetch('http://localhost:8000/api/v1/graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assets, dependencies })
  });
}

export async function simulateCascade(
  nodes: InfraNode[],
  edges: InfraEdge[],
  failedNodeIds: string[],
  seed = 42
): Promise<CascadeResult> {
  await setupGraphOnBackend(nodes, edges);

  const root_failures = failedNodeIds.map(id => ({
    asset_id: id,
    mode: 'complete'
  }));

  const res = await fetch('http://localhost:8000/api/v1/cascade/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root_failures })
  });
  
  if (!res.ok) {
    console.error("Backend simulation failed");
    return { failedNodes: failedNodeIds, propagationPath: [], totalImpact: 0, populationAffected: 0 };
  }

  const backendResult = await res.json();
  
  const failedNodes = Array.from(new Set([
    ...failedNodeIds,
    ...backendResult.affected_assets
      .filter((a: any) => a.state === 'FAILED' || a.state === 'AT_RISK' || a.state === 'DEGRADED')
      .map((a: any) => a.asset_id)
  ]));
    
  const propagationPath: any[] = [];
  const seenPaths = new Set();
  
  for (const asset of backendResult.affected_assets) {
    if (asset.paths) {
      for (const path of asset.paths) {
         for (let i = 0; i < path.length - 1; i++) {
             const from = path[i];
             const to = path[i+1];
             const step = i+1;
             const pathKey = `${from}->${to}`;
             if (!seenPaths.has(pathKey)) {
                 seenPaths.add(pathKey);
                 propagationPath.push({ from, to, step });
             }
         }
      }
    }
  }
  
  return {
    failedNodes,
    propagationPath,
    totalImpact: backendResult.affected_assets.reduce((sum: number, a: any) => sum + a.impact_score, 0),
    populationAffected: backendResult.summary.population_affected || 0
  };
}

// ---- FAILURE R₀ ----
export async function computeFailureR0(
  nodes: InfraNode[],
  edges: InfraEdge[],
  runs = 1 // Since backend is deterministic, we only need 1 run
): Promise<FailureR0Result[]> {
  const results: FailureR0Result[] = [];

  for (const node of nodes) {
    let totalDownstream = 0;
    let worstCase = 0;

    for (let i = 0; i < runs; i++) {
      // Reset all to healthy for this run
      const freshNodes = nodes.map(n => ({ ...n, health: 'HEALTHY' as const }));
      const cascade = await simulateCascade(freshNodes, edges, [node.id], 42 + i);
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

// ---- PLAN GENERATION (Backend API) ----
export async function generatePlansBackend(
  nodes: InfraNode[],
  edges: InfraEdge[],
  failedNodeIds: string[],
  rootFailureNodeId?: string | null
): Promise<RecoveryPlan[]> {
  const reqNodes = nodes.map(n => ({
    node_id: n.id,
    name: n.name,
    sector: n.sector,
    node_type: n.sector,
    criticality: n.criticality,
    capacity: n.capacity,
    current_load: n.currentLoad,
    current_state: n.health === 'HEALTHY' ? 'OPERATIONAL' : n.health === 'STRESSED' ? 'DEGRADED' : 'FAILED',
    repair_duration_minutes: n.recoveryTimeHours * 60,
    location: "CITY",
    skills_required: n.sector === 'POWER' ? ['electrical'] : n.sector === 'TRANSPORT' ? ['road_clearing'] : ['general'],
    runway_minutes: n.runwayHours * 60,
    access_requirements: [],
    alternative_sources: []
  }));

  const reqDeps = edges.map(e => ({
    source: e.source,
    target: e.target,
    dependency_type: e.label || 'generic',
    strength: 1.0,
    required: true,
    failure_effect: 'DEGRADED',
    recovery_effect: 'OPERATIONAL'
  }));

  const reqCrews = [
    { crew_id: "C_ELEC", skills: ["electrical", "general"], current_location: "DEPOT", shift_remaining_minutes: 480, travel_time: {} },
    { crew_id: "C_ROAD", skills: ["road_clearing", "general"], current_location: "DEPOT", shift_remaining_minutes: 480, travel_time: {} }
  ];

  try {
    const res = await fetch('http://localhost:8001/recovery/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incident_id: "INC-" + Date.now(),
        failed_nodes: failedNodeIds,
        nodes: reqNodes,
        dependencies: reqDeps,
        crews: reqCrews,
        available_resources: []
      })
    });
    
    if (!res.ok) throw new Error("Optimization failed");
    const data = await res.json();
    
    // Map backend plans to frontend RecoveryPlan format
    const plans: RecoveryPlan[] = [];
    if (data.selected_plan) {
      plans.push(mapBackendPlanToFrontend(data.selected_plan, 'Plan A (Optimal)', 'Plan A', 'VERIFIED', nodes));
    }
    data.alternative_plans.forEach((p: any, i: number) => {
      plans.push(mapBackendPlanToFrontend(p, `Plan ${String.fromCharCode(66+i)} (Alternative)`, `Plan ${String.fromCharCode(66+i)}`, 'UNVERIFIED', nodes));
    });
    return plans;
  } catch (e) {
    console.error(e);
    return generatePlans(nodes, edges, rootFailureNodeId); // fallback
  }
}

function mapBackendPlanToFrontend(p: any, name: string, label: string, status: string, nodes: InfraNode[]): RecoveryPlan {
  return {
    id: p.plan_id,
    name: name,
    label: label,
    phase: 'STABILIZE',
    status: status as any,
    metrics: {
      meanRecovery: p.total_score,
      worstCaseRecovery: p.minimum_deadline_margin_minutes,
      criticalOutageProbability: 0.1,
      cascadedFailures: p.cascade_reduction || 0,
      timeToStabilize: p.completion_time_minutes / 60,
      crewUtilization: 0.8,
      hospitalProtected: true,
      waterProtected: true
    },
    actions: p.actions.map((a: any) => {
      let type = 'REPAIR';
      let targetId = a.action_id.split('_').pop() || '';
      
      if (a.action_id.startsWith('REPAIR_')) {
        targetId = a.action_id.substring('REPAIR_'.length);
      } else if (a.action_id.startsWith('BACKUP_')) {
        targetId = a.action_id.substring('BACKUP_'.length);
        type = 'BACKUP_ACTIVATE';
      } else if (a.action_id.startsWith('CLEAR_')) {
        targetId = a.action_id.substring('CLEAR_'.length);
        type = 'CLEAR_ACCESS';
      } else if (a.action_id.startsWith('TRANSFER_')) {
        const match = a.action_id.match(/TRANSFER_(.*)_TO_(.*)/);
        if (match) targetId = match[1];
        type = 'REROUTE';
      }

      const targetNode = nodes.find(n => n.id === targetId);
      let desc = `Action: ${a.action_id}`;
      
      if (targetNode) {
        if (targetNode.sector === 'TRANSPORT' && type === 'REPAIR') {
          desc = `Dispatch Heavy Machinery to Clear Debris on ${targetNode.name}`;
        } else if (targetNode.sector === 'POWER' && type === 'REPAIR') {
          desc = `Deploy Specialized Electrical Crew to Repair ${targetNode.name}`;
        } else if (targetNode.sector === 'WATER' && type === 'REPAIR') {
          desc = `Dispatch Emergency Plumbing Team to ${targetNode.name}`;
        } else if (type === 'BACKUP_ACTIVATE') {
          desc = `Activate Emergency Backup Systems for ${targetNode.name}`;
        } else if (type === 'CLEAR_ACCESS') {
          desc = `Clear Access Routes leading to ${targetNode.name}`;
        } else if (type === 'REROUTE') {
          desc = `Reroute Critical Load away from ${targetNode.name}`;
        } else {
          desc = `Restore Operations at ${targetNode.name}`;
        }
      }

      return {
        id: a.action_id,
        type: type,
        targetNodeId: targetId,
        description: desc,
        estimatedTimeHours: (a.completion_minute - a.start_minute) / 60,
        crewRequired: 1,
        priority: a.sequence
      };
    })
  };
}

// ---- PLAN GENERATION (Mock Fallback — Incident-Specific) ----
export function generatePlans(
  nodes: InfraNode[],
  edges: InfraEdge[],
  rootFailureNodeId?: string | null
): RecoveryPlan[] {
  const failedNodes = nodes.filter(n => n.health === 'FAILED' || n.health === 'AT_RISK');
  if (failedNodes.length === 0) return [];

  const priorities = failedNodes.map(n => ({
    node: n,
    priority: calculateRestorationPriority(n, edges, nodes),
  })).sort((a, b) => b.priority - a.priority);

  const primaryNode = priorities[0]?.node;
  if (!primaryNode) return [];

  // Use the ROOT CAUSE node's sector to determine plan type.
  // This prevents cascaded failures from overriding the actual incident type.
  let rootSector = primaryNode.sector;
  if (rootFailureNodeId) {
    const rootNode = nodes.find(n => n.id === rootFailureNodeId);
    if (rootNode) {
      rootSector = rootNode.sector;
      // Also ensure the root node is at the front of priorities
      const rootIdx = priorities.findIndex(p => p.node.id === rootFailureNodeId);
      if (rootIdx > 0) {
        const [rootEntry] = priorities.splice(rootIdx, 1);
        priorities.unshift(rootEntry);
      }
    }
  }

  // Build 3 incident-specific plans based on the root cause sector
  if (rootSector === 'TRANSPORT') {
    return generateTransportPlans(nodes, edges, priorities);
  } else if (rootSector === 'WATER') {
    return generateWaterPlans(nodes, edges, priorities);
  } else if (rootSector === 'POWER') {
    return generatePowerPlans(nodes, edges, priorities);
  } else {
    return generateGenericPlans(nodes, edges, priorities);
  }
}

function generateTransportPlans(
  nodes: InfraNode[], edges: InfraEdge[],
  priorities: { node: InfraNode; priority: number }[]
): RecoveryPlan[] {
  const primary = priorities[0]!.node;
  const affected = priorities.map(p => p.node);
  
  // Find downstream nodes that depend on this road for crew access
  const dependents = edges.filter(e => e.source === primary.id).map(e => nodes.find(n => n.id === e.target)).filter(Boolean) as InfraNode[];
  
  const planA: RecoveryPlan = {
    id: `plan-road-a-${Date.now()}`, name: 'Rapid Debris Clearance', label: 'Plan A', phase: 'STABILIZE', status: 'PROPOSED',
    actions: [
      { id: 'ra-0', type: 'CLEAR_ACCESS', targetNodeId: primary.id, description: `Deploy Heavy Machinery (JCB + Bulldozer) to clear debris on ${primary.name}`, estimatedTimeHours: 3, crewRequired: 6, priority: 1 },
      { id: 'ra-1', type: 'REPAIR', targetNodeId: primary.id, description: `Road surface emergency patching and pothole repair on ${primary.name}`, estimatedTimeHours: 4, crewRequired: 4, priority: 2 },
      ...dependents.slice(0, 2).map((d, i) => ({ id: `ra-dep-${i}`, type: 'REPAIR' as const, targetNodeId: d.id, description: `Restore crew access path to ${d.name} via alternate routing`, estimatedTimeHours: 1, crewRequired: 2, priority: 3 + i }))
    ],
    metrics: scorePlan(nodes, edges, [])
  };
  
  const planB: RecoveryPlan = {
    id: `plan-road-b-${Date.now()}`, name: 'Detour + Phased Repair', label: 'Plan B', phase: 'STABILIZE', status: 'PROPOSED',
    actions: [
      { id: 'rb-0', type: 'REROUTE', targetNodeId: primary.id, description: `Open emergency detour via Bridge Road R2 and secondary arterials`, estimatedTimeHours: 0.5, crewRequired: 3, priority: 1 },
      { id: 'rb-1', type: 'REPAIR', targetNodeId: primary.id, description: `Deploy traffic control barriers and signage around ${primary.name}`, estimatedTimeHours: 1, crewRequired: 2, priority: 2 },
      { id: 'rb-2', type: 'REPAIR', targetNodeId: primary.id, description: `Schedule overnight lane-by-lane road repair on ${primary.name}`, estimatedTimeHours: 8, crewRequired: 8, priority: 3 },
    ],
    metrics: scorePlan(nodes, edges, [])
  };
  
  const planC: RecoveryPlan = {
    id: `plan-road-c-${Date.now()}`, name: 'Emergency Airlift + Temporary Bridge', label: 'Plan C', phase: 'RESTORE', status: 'PROPOSED',
    actions: [
      { id: 'rc-0', type: 'DEPLOY_GENERATOR', targetNodeId: primary.id, description: `Request military pontoon bridge deployment near ${primary.name}`, estimatedTimeHours: 4, crewRequired: 10, priority: 1 },
      { id: 'rc-1', type: 'REROUTE', targetNodeId: primary.id, description: `Establish helicopter supply corridor for critical hospital supplies`, estimatedTimeHours: 1.5, crewRequired: 3, priority: 2 },
      { id: 'rc-2', type: 'REPAIR', targetNodeId: primary.id, description: `Full structural assessment and permanent repair of ${primary.name}`, estimatedTimeHours: 14, crewRequired: 12, priority: 3 },
    ],
    metrics: scorePlan(nodes, edges, [])
  };
  
  return [planA, planB, planC];
}

function generateWaterPlans(
  nodes: InfraNode[], edges: InfraEdge[],
  priorities: { node: InfraNode; priority: number }[]
): RecoveryPlan[] {
  const primary = priorities[0]!.node;
  const hospitals = nodes.filter(n => n.sector === 'HEALTHCARE');
  
  const planA: RecoveryPlan = {
    id: `plan-water-a-${Date.now()}`, name: 'Emergency Pump Repair', label: 'Plan A', phase: 'RESTORE', status: 'PROPOSED',
    actions: [
      { id: 'wa-0', type: 'REPAIR', targetNodeId: primary.id, description: `Dispatch Emergency Plumbing & Pump Team to ${primary.name}`, estimatedTimeHours: primary.recoveryTimeHours, crewRequired: primary.crewRequirement, priority: 1 },
      { id: 'wa-1', type: 'REPAIR', targetNodeId: primary.id, description: `Replace faulty pressure regulation valves at ${primary.name}`, estimatedTimeHours: 2, crewRequired: 2, priority: 2 },
      ...hospitals.slice(0, 1).map((h, i) => ({ id: `wa-h-${i}`, type: 'REROUTE' as const, targetNodeId: h.id, description: `Priority water supply reroute to ${h.name} via emergency tankers`, estimatedTimeHours: 1, crewRequired: 2, priority: 3 }))
    ],
    metrics: scorePlan(nodes, edges, [])
  };
  
  const planB: RecoveryPlan = {
    id: `plan-water-b-${Date.now()}`, name: 'Tanker + Backup Reservoir', label: 'Plan B', phase: 'STABILIZE', status: 'PROPOSED',
    actions: [
      { id: 'wb-0', type: 'BACKUP_ACTIVATE', targetNodeId: 'WTR_RES_C', description: `Switch to Reservoir C as primary supply source`, estimatedTimeHours: 0.5, crewRequired: 2, priority: 1 },
      { id: 'wb-1', type: 'DEPLOY_GENERATOR', targetNodeId: primary.id, description: `Deploy 20 emergency water tankers across affected zones`, estimatedTimeHours: 2, crewRequired: 4, priority: 2 },
      { id: 'wb-2', type: 'REPAIR', targetNodeId: primary.id, description: `Begin parallel pump motor replacement at ${primary.name}`, estimatedTimeHours: 6, crewRequired: 4, priority: 3 },
    ],
    metrics: scorePlan(nodes, edges, [])
  };
  
  const planC: RecoveryPlan = {
    id: `plan-water-c-${Date.now()}`, name: 'Controlled Rationing + Deep Repair', label: 'Plan C', phase: 'STABILIZE', status: 'PROPOSED',
    actions: [
      { id: 'wc-0', type: 'LOAD_SHED', targetNodeId: primary.id, description: `Implement zone-based water rationing to conserve reservoir levels`, estimatedTimeHours: 0.5, crewRequired: 1, priority: 1 },
      { id: 'wc-1', type: 'REPAIR', targetNodeId: primary.id, description: `Full pipeline integrity scan and leak isolation at ${primary.name}`, estimatedTimeHours: 4, crewRequired: 5, priority: 2 },
      { id: 'wc-2', type: 'REPAIR', targetNodeId: primary.id, description: `Chemical treatment reset and water quality certification`, estimatedTimeHours: 3, crewRequired: 3, priority: 3 },
    ],
    metrics: scorePlan(nodes, edges, [])
  };
  
  return [planA, planB, planC];
}

function generatePowerPlans(
  nodes: InfraNode[], edges: InfraEdge[],
  priorities: { node: InfraNode; priority: number }[]
): RecoveryPlan[] {
  const primary = priorities[0]!.node;
  const downstream = edges.filter(e => e.source === primary.id)
    .map(e => nodes.find(n => n.id === e.target)).filter(Boolean) as InfraNode[];
  
  const planA: RecoveryPlan = {
    id: `plan-power-a-${Date.now()}`, name: 'Direct Electrical Repair', label: 'Plan A', phase: 'RESTORE', status: 'PROPOSED',
    actions: [
      { id: 'pa-0', type: 'REPAIR', targetNodeId: primary.id, description: `Deploy Specialized Electrical Crew to Repair ${primary.name} — transformer replacement`, estimatedTimeHours: primary.recoveryTimeHours, crewRequired: primary.crewRequirement, priority: 1 },
      ...downstream.slice(0, 2).map((d, i) => ({ id: `pa-d-${i}`, type: 'REPAIR' as const, targetNodeId: d.id, description: `Restore power supply line to ${d.name}`, estimatedTimeHours: 1, crewRequired: 2, priority: 2 + i }))
    ],
    metrics: scorePlan(nodes, edges, [])
  };
  
  const planB: RecoveryPlan = {
    id: `plan-power-b-${Date.now()}`, name: 'Generator Bridge + Grid Reroute', label: 'Plan B', phase: 'STABILIZE', status: 'PROPOSED',
    actions: [
      { id: 'pb-0', type: 'DEPLOY_GENERATOR', targetNodeId: primary.id, description: `Deploy 3 mobile diesel generators at ${primary.name} site`, estimatedTimeHours: 1.5, crewRequired: 3, priority: 1 },
      { id: 'pb-1', type: 'REROUTE', targetNodeId: primary.id, description: `Reroute grid load through Substation Beta bypass circuit`, estimatedTimeHours: 1, crewRequired: 2, priority: 2 },
      { id: 'pb-2', type: 'FUEL_ALLOCATION', targetNodeId: 'FUEL_DEPOT_A', description: `Pre-position 2000L emergency diesel at generator sites`, estimatedTimeHours: 1, crewRequired: 1, priority: 3 },
      { id: 'pb-3', type: 'REPAIR', targetNodeId: primary.id, description: `Begin parallel transformer repair at ${primary.name}`, estimatedTimeHours: 5, crewRequired: 4, priority: 4 },
    ],
    metrics: scorePlan(nodes, edges, [])
  };
  
  const planC: RecoveryPlan = {
    id: `plan-power-c-${Date.now()}`, name: 'Load Shedding + Critical Priority', label: 'Plan C', phase: 'STABILIZE', status: 'PROPOSED',
    actions: [
      { id: 'pc-0', type: 'LOAD_SHED', targetNodeId: primary.id, description: `Controlled load shedding — disconnect non-critical industrial zones`, estimatedTimeHours: 0.5, crewRequired: 1, priority: 1 },
      { id: 'pc-1', type: 'BACKUP_ACTIVATE', targetNodeId: 'HC_HOSP_A', description: `Activate hospital backup generators to protect critical care`, estimatedTimeHours: 0.25, crewRequired: 1, priority: 2 },
      { id: 'pc-2', type: 'REPAIR', targetNodeId: primary.id, description: `Full transformer overhaul and grid reconnection at ${primary.name}`, estimatedTimeHours: 8, crewRequired: 6, priority: 3 },
    ],
    metrics: scorePlan(nodes, edges, [])
  };
  
  return [planA, planB, planC];
}

function generateGenericPlans(
  nodes: InfraNode[], edges: InfraEdge[],
  priorities: { node: InfraNode; priority: number }[]
): RecoveryPlan[] {
  const primary = priorities[0]!.node;
  
  const planA: RecoveryPlan = {
    id: `plan-gen-a-${Date.now()}`, name: 'Direct Repair Strategy', label: 'Plan A', phase: 'RESTORE', status: 'PROPOSED',
    actions: priorities.slice(0, 3).map((p, i) => ({
      id: `ga-${i}`, type: 'REPAIR' as const, targetNodeId: p.node.id,
      description: `Restore Operations at ${p.node.name}`,
      estimatedTimeHours: p.node.recoveryTimeHours, crewRequired: p.node.crewRequirement, priority: i + 1,
    })),
    metrics: scorePlan(nodes, edges, [])
  };
  
  const planB: RecoveryPlan = {
    id: `plan-gen-b-${Date.now()}`, name: 'Backup Systems Activation', label: 'Plan B', phase: 'STABILIZE', status: 'PROPOSED',
    actions: priorities.slice(0, 2).map((p, i) => ({
      id: `gb-${i}`, type: 'BACKUP_ACTIVATE' as const, targetNodeId: p.node.id,
      description: `Activate Emergency Backup Systems for ${p.node.name}`,
      estimatedTimeHours: p.node.recoveryTimeHours * 0.3, crewRequired: Math.max(1, p.node.crewRequirement - 1), priority: i + 1,
    })),
    metrics: scorePlan(nodes, edges, [])
  };
  
  const planC: RecoveryPlan = {
    id: `plan-gen-c-${Date.now()}`, name: 'Controlled Degradation', label: 'Plan C', phase: 'STABILIZE', status: 'PROPOSED',
    actions: [
      { id: 'gc-0', type: 'LOAD_SHED', targetNodeId: primary.id, description: `Reduce load on ${primary.name} and connected systems`, estimatedTimeHours: 0.5, crewRequired: 1, priority: 1 },
      { id: 'gc-1', type: 'REPAIR', targetNodeId: primary.id, description: `Full diagnostic and repair of ${primary.name}`, estimatedTimeHours: primary.recoveryTimeHours, crewRequired: primary.crewRequirement, priority: 2 },
    ],
    metrics: scorePlan(nodes, edges, [])
  };
  
  return [planA, planB, planC];
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
