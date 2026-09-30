// ============================================================
// ResilienceOS — Core Type Definitions
// ============================================================

export type Sector = 'POWER' | 'WATER' | 'HEALTHCARE' | 'TRANSPORT' | 'TELECOM' | 'FUEL' | 'EMERGENCY';

export type HealthStatus = 'HEALTHY' | 'STRESSED' | 'AT_RISK' | 'FAILED' | 'RECOVERING';

export type EdgeType = 'SUPPLIES' | 'DEPENDS_ON' | 'TRANSPORTS' | 'COMMUNICATES_WITH' | 'PROTECTS';

export interface InfraNode {
  id: string;
  name: string;
  sector: Sector;
  location: { x: number; y: number; lat?: number; lng?: number };
  health: HealthStatus;
  capacity: number;
  currentLoad: number;
  criticality: number;        // 0–1
  populationServed: number;
  backupAvailable: boolean;
  runwayHours: number;         // hours remaining before failure
  maxRunwayHours: number;      // max possible runway
  recoveryTimeHours: number;
  crewRequirement: number;
  accessible: boolean;
  icon: string;
}

export interface InfraEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  propagationProbability: number;  // 0–1
  label?: string;
}

export interface CascadeResult {
  failedNodes: string[];
  propagationPath: Array<{ from: string; to: string; step: number }>;
  totalImpact: number;
  populationAffected: number;
}

export interface FailureR0Result {
  nodeId: string;
  r0: number;
  rank: number;
  avgDownstream: number;
  worstCase: number;
}

export interface PlanAction {
  id: string;
  type: 'REPAIR' | 'REROUTE' | 'DEPLOY_GENERATOR' | 'FUEL_ALLOCATION' | 'LOAD_SHED' | 'BACKUP_ACTIVATE' | 'CREW_DISPATCH' | 'CLEAR_ACCESS';
  targetNodeId: string;
  description: string;
  estimatedTimeHours: number;
  crewRequired: number;
  priority: number;
}

export interface RecoveryPlan {
  id: string;
  name: string;
  label: string;          // "Plan A", "Plan B", "Plan C"
  phase: 'STABILIZE' | 'RESTORE';
  actions: PlanAction[];
  metrics: PlanMetrics;
  status: 'PROPOSED' | 'TESTING' | 'VERIFIED' | 'REJECTED' | 'ACTIVE';
  rejectionReason?: string;
}

export interface PlanMetrics {
  meanRecovery: number;
  worstCaseRecovery: number;
  criticalOutageProbability: number;
  cascadedFailures: number;
  timeToStabilize: number;
  crewUtilization: number;
  hospitalProtected: boolean;
  waterProtected: boolean;
}

export interface ChallengerAttack {
  id: string;
  type: 'COMPONENT_FAILURE' | 'LOGISTICS_BLOCK' | 'DEMAND_SURGE' | 'COMMS_FAILURE' | 'FUEL_SHORTAGE' | 'HIDDEN_DEPENDENCY';
  description: string;
  targetNodeId: string;
  result: 'PLAN_SURVIVES' | 'PLAN_BREAKS';
  impact?: string;
}

export interface ReflectorLesson {
  id: string;
  timestamp: number;
  pattern: string;
  weakness: string;
  lesson: string;
  regressionTest: RegressionTest;
}

export interface RegressionTest {
  id: string;
  description: string;
  failureToInject: string;
  expectedOutcome: string;
  status: 'PENDING' | 'PASSED' | 'FAILED';
}

export interface AgentTraceEntry {
  id: string;
  timestamp: number;
  agent: 'PLANNER' | 'CHALLENGER' | 'REFLECTOR' | 'SYSTEM' | 'PREDICTIVE_ANALYST';
  action: string;
  detail: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
}

export interface SimulationEvent {
  id: string;
  timestamp: number;
  type: 'FAILURE' | 'REPAIR' | 'WEATHER' | 'DEMAND_SURGE' | 'ROAD_BLOCK' | 'ROAD_CLEAR';
  description: string;
  affectedNodes: string[];
  processed: boolean;
}

export interface MonteCarloRun {
  planId: string;
  runs: number;
  meanRecovery: number;
  p5Recovery: number;
  p95Recovery: number;
  hospitalOutageProb: number;
  cascadeCount: number;
  distribution: number[];
}

export interface AppState {
  nodes: InfraNode[];
  edges: InfraEdge[];
  cascadeResult: CascadeResult | null;
  failureR0: FailureR0Result[];
  plans: RecoveryPlan[];
  selectedPlanId: string | null;
  attacks: ChallengerAttack[];
  lessons: ReflectorLesson[];
  agentTrace: AgentTraceEntry[];
  events: SimulationEvent[];
  monteCarloResults: MonteCarloRun[];
  simulationTick: number;
  isRunning: boolean;
  activeView: 'DASHBOARD' | 'GRAPH' | 'PLANS' | 'MEMORY';
}
