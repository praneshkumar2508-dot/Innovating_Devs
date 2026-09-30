import React, { useState, useEffect } from 'react';

// Interfaces for backend graphs
interface BNode { id: string; name: string; description: string; type?: string; }
interface BEdge { source: string; target: string; }
interface BGraph { graph_id: string; nodes: BNode[]; edges: BEdge[]; generations: string[][]; }

export function BackendGraphEngine() {
  const [graphs, setGraphs] = useState<any[]>([]);
  const [selectedGraphId, setSelectedGraphId] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<BGraph | null>(null);

  useEffect(() => {
    fetch('http://localhost:8000/api/graphs')
      .then(res => res.json())
      .then(data => { setGraphs(data); if (data.length > 0) setSelectedGraphId(data[0].graph_id); })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (selectedGraphId) {
      fetch(`http://localhost:8000/api/graphs/${selectedGraphId}`)
        .then(res => res.json())
        .then(data => setGraphData(data))
        .catch(console.error);
    }
  }, [selectedGraphId]);

  // Compute node locations using generations
  const nodeLocations = new Map<string, {x: number, y: number}>();
  if (graphData && graphData.generations) {
    const startX = 150;
    const spacingX = 250;
    const startY = 300;
    const spacingY = 150;

    graphData.generations.forEach((gen, i) => {
      const x = startX + i * spacingX;
      gen.forEach((nodeId, j) => {
        const y = startY + j * spacingY - (gen.length * spacingY) / 2;
        nodeLocations.set(nodeId, { x, y });
      });
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', overflowX: 'auto', padding: '10px 0' }}>
        {graphs.map(g => (
          <button 
            key={g.graph_id} 
            style={{ 
              padding: '8px 16px', 
              borderRadius: '8px', 
              border: '1px solid var(--border)', 
              background: selectedGraphId === g.graph_id ? 'var(--accent)' : 'transparent', 
              color: selectedGraphId === g.graph_id ? '#fff' : 'var(--text-h)', 
              cursor: 'pointer',
              fontWeight: 600,
              flexShrink: 0
            }}
            onClick={() => setSelectedGraphId(g.graph_id)}
          >
            {g.name || g.graph_id}
          </button>
        ))}
      </div>
      
      <div className="graph-container" style={{ flex: 1, position: 'relative', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <svg className="graph-svg" viewBox="0 0 1000 600" style={{ width: '100%', height: '100%' }}>
          <pattern id="grid-engine" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" className="grid-pattern" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid-engine)" />
          
          {graphData && graphData.edges.map((edge, idx) => {
            const source = nodeLocations.get(edge.source);
            const target = nodeLocations.get(edge.target);
            if (!source || !target) return null;
            return (
              <g key={`edge-${idx}`}>
                <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="graph-edge" />
                <circle cx={(source.x + target.x)/2} cy={(source.y + target.y)/2} r="4" fill="var(--accent)" />
              </g>
            );
          })}

          {graphData && graphData.nodes.map(node => {
            const loc = nodeLocations.get(node.id);
            if (!loc) return null;

            // Assign suitable emojis based on node ID/name
            let emoji = '⚙️';
            const nameLower = (node.name || node.id).toLowerCase();
            if (nameLower.includes('cascade')) emoji = '🌊';
            else if (nameLower.includes('plan')) emoji = '📋';
            else if (nameLower.includes('monte') || nameLower.includes('score')) emoji = '🎲';
            else if (nameLower.includes('fetch') || nameLower.includes('http') || nameLower.includes('api')) emoji = '🌐';
            else if (nameLower.includes('db') || nameLower.includes('data') || nameLower.includes('extract')) emoji = '💾';
            else if (nameLower.includes('branch') || nameLower.includes('condition')) emoji = '🔀';
            else if (nameLower.includes('email') || nameLower.includes('notify')) emoji = '📧';
            else if (nameLower.includes('model') || nameLower.includes('predict')) emoji = '🧠';
            else if (nameLower.includes('validate') || nameLower.includes('check')) emoji = '✅';

            return (
              <g key={node.id} className="graph-node" transform={`translate(${loc.x}, ${loc.y})`}>
                <circle r="30" className="node-ring HEALTHY" />
                <text className="node-emoji">{emoji}</text>
                <text y="45" className="node-label" style={{ fill: 'var(--text-h)', fontSize: '14px', textAnchor: 'middle', fontWeight: 'bold' }}>{node.name || node.id}</text>
                {node.description && (
                  <text y="60" style={{ fill: 'var(--text)', fontSize: '11px', textAnchor: 'middle' }}>
                    {node.description.length > 30 ? node.description.substring(0, 27) + '...' : node.description}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
