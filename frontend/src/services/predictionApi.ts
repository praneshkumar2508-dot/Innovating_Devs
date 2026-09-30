import type { InfraNode } from '../types';

export async function runPredictionBatch(nodes: InfraNode[]): Promise<any[]> {
  const reqs = nodes.map(n => {
    // Generate some mock telemetry for the request (in a real app, this would be fetched from a telemetry service)
    const telemetryHistory = [
      {
        node_id: n.id,
        timestamp: new Date(Date.now() - 300000).toISOString(),
        load_kw: n.currentLoad * 0.9,
        voltage: 230,
        temperature: 55,
      },
      {
        node_id: n.id,
        timestamp: new Date().toISOString(),
        load_kw: n.currentLoad,
        voltage: n.health === 'STRESSED' ? 210 : 230,
        temperature: n.health === 'STRESSED' ? 75 : 56,
      }
    ];

    return {
      node: {
        node_id: n.id,
        name: n.name,
        sector: n.sector,
        node_type: n.sector,
        criticality: n.criticality,
        rated_capacity: n.capacity,
        normal_operating_range: { voltage: 230 },
      },
      telemetry_history: telemetryHistory
    };
  });

  try {
    const res = await fetch('http://localhost:8002/prediction/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqs)
    });
    
    if (!res.ok) throw new Error("Prediction API Failed");
    return await res.json();
  } catch (e) {
    console.error(e);
    return [];
  }
}
