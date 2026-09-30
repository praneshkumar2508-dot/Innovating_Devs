/**
 * GraphEngine Studio - Interactive DAG Canvas & Real-time Runner
 */

(function () {
  'use strict';

  // Application State
  const state = {
    graphs: [],
    currentGraphId: null,
    graphData: null,
    nodePositions: new Map(),
    selectedNodeId: null,
    eventSource: null,
    zoomLevel: 1.0,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    nodeResults: new Map(),
    eventCount: 0,
  };

  // DOM Elements
  const el = {
    graphSelect: document.getElementById('graph-select'),
    btnStreamRun: document.getElementById('btn-stream-run'),
    btnRunGraph: document.getElementById('btn-run-graph'),
    btnResetGraph: document.getElementById('btn-reset-graph'),
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnFitView: document.getElementById('btn-fit-view'),
    btnFormatJson: document.getElementById('btn-format-json'),
    btnClearLogs: document.getElementById('btn-clear-logs'),
    btnCopyOutput: document.getElementById('btn-copy-output'),

    liveStatusPill: document.getElementById('live-status-pill'),
    liveStatusText: document.getElementById('live-status-text'),
    graphBadgeDag: document.getElementById('graph-badge-dag'),
    graphDescription: document.getElementById('graph-description'),

    metricNodeCount: document.getElementById('metric-node-count'),
    metricEdgeCount: document.getElementById('metric-edge-count'),
    metricGenCount: document.getElementById('metric-gen-count'),
    metricLastDuration: document.getElementById('metric-last-duration'),

    generationsContainer: document.getElementById('generations-container'),
    inputStateEditor: document.getElementById('input-state-editor'),

    canvasContainer: document.getElementById('canvas-container'),
    graphSurface: document.getElementById('graph-surface'),
    graphSvg: document.getElementById('graph-svg'),
    svgEdgesGroup: document.getElementById('svg-edges-group'),
    nodesOverlay: document.getElementById('nodes-overlay'),

    inspectorEmpty: document.getElementById('inspector-empty'),
    inspectorContent: document.getElementById('inspector-content'),
    inspectorNodeName: document.getElementById('inspector-node-name'),
    inspectorNodeId: document.getElementById('inspector-node-id'),
    inspectorNodeDesc: document.getElementById('inspector-node-desc'),
    inspectorNodeStatus: document.getElementById('inspector-node-status'),
    inspectorNodeTime: document.getElementById('inspector-node-time'),
    inspectorNodeAsync: document.getElementById('inspector-node-async'),
    inspectorNodeCacheable: document.getElementById('inspector-node-cacheable'),
    inspectorNodeOutkey: document.getElementById('inspector-node-outkey'),
    inspectorNodeInputs: document.getElementById('inspector-node-inputs'),
    inspectorOutputJson: document.getElementById('inspector-output-json'),

    eventConsole: document.getElementById('event-console'),
    eventCountBadge: document.getElementById('event-count-badge'),
  };

  // Sample initial states for built-in workflows
  const sampleStates = {
    customer_churn_pipeline: { batch_size: 4 },
    loan_approval_workflow: {
      applicant_id: 'applicant_902',
      credit_score: 780,
      loan_amount: 18000.0,
    },
    crypto_market_aggregator: {},
  };

  // ---------------------------------------------------------------------------
  // API Fetching & Lifecycle
  // ---------------------------------------------------------------------------

  async function init() {
    bindEvents();
    await fetchGraphs();
  }

  async function fetchGraphs() {
    try {
      const res = await fetch('/api/graphs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.graphs = await res.json();

      el.graphSelect.innerHTML = '';
      state.graphs.forEach((g, idx) => {
        const opt = document.createElement('option');
        opt.value = g.graph_id;
        opt.textContent = `${g.name} (${g.node_count} nodes)`;
        if (idx === 0) opt.selected = true;
        el.graphSelect.appendChild(opt);
      });

      if (state.graphs.length > 0) {
        loadGraph(state.graphs[0].graph_id);
      }
    } catch (err) {
      logEvent('error', `Failed to load graphs: ${err.message}`);
    }
  }

  async function loadGraph(graphId) {
    try {
      setLiveStatus('idle', 'Loading...');
      const res = await fetch(`/api/graphs/${graphId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.graphData = await res.json();
      state.currentGraphId = graphId;

      // Populate metadata
      el.graphDescription.textContent = state.graphData.description || 'No description provided.';
      el.metricNodeCount.textContent = state.graphData.node_count;
      el.metricEdgeCount.textContent = state.graphData.edge_count;
      el.metricGenCount.textContent = (state.graphData.generations || []).length;
      el.metricLastDuration.textContent = '-';

      // Update Sample JSON editor
      const defaultState = sampleStates[graphId] || {};
      el.inputStateEditor.value = JSON.stringify(defaultState, null, 2);

      // Render Generations
      renderGenerations(state.graphData.generations || []);

      // Render Graph Layout
      renderGraphLayout();

      // Reset selection and results
      resetResults();
      setLiveStatus('idle', 'Ready');
      logEvent('info', `Loaded workflow: "${state.graphData.name}"`);
    } catch (err) {
      logEvent('error', `Error loading graph ${graphId}: ${err.message}`);
      setLiveStatus('failed', 'Error');
    }
  }

  // ---------------------------------------------------------------------------
  // Graph Canvas & Layout Engine
  // ---------------------------------------------------------------------------

  function renderGenerations(generations) {
    el.generationsContainer.innerHTML = '';
    generations.forEach((gen, idx) => {
      const item = document.createElement('div');
      item.className = 'gen-layer-item';
      item.innerHTML = `
        <span class="gen-layer-title">Layer ${idx + 1}</span>
        <div class="gen-layer-nodes">
          ${gen.map(nid => `<span class="gen-node-tag">${nid}</span>`).join('')}
        </div>
      `;
      el.generationsContainer.appendChild(item);
    });
  }

  function renderGraphLayout() {
    el.nodesOverlay.innerHTML = '';
    el.svgEdgesGroup.innerHTML = '';
    state.nodePositions.clear();

    if (!state.graphData || !state.graphData.nodes) return;

    const generations = state.graphData.generations || [];
    const nodeMap = new Map(state.graphData.nodes.map(n => [n.id, n]));

    const cardWidth = 190;
    const cardHeight = 75;
    const colSpacing = 280;
    const rowSpacing = 100;
    const startX = 60;
    const startY = 60;

    // 1. Calculate Positions
    generations.forEach((gen, colIdx) => {
      const colX = startX + colIdx * colSpacing;
      const totalGenHeight = (gen.length - 1) * rowSpacing;
      const colStartY = Math.max(startY, startY + (180 - totalGenHeight / 2));

      gen.forEach((nid, rowIdx) => {
        const y = colStartY + rowIdx * rowSpacing;
        state.nodePositions.set(nid, { x: colX, y });
      });
    });

    // Handle any nodes not in generations (fallback)
    let extraIdx = 0;
    state.graphData.nodes.forEach(n => {
      if (!state.nodePositions.has(n.id)) {
        state.nodePositions.set(n.id, {
          x: startX + extraIdx * colSpacing,
          y: startY + 300,
        });
        extraIdx++;
      }
    });

    // 2. Render Node Cards
    state.graphData.nodes.forEach(n => {
      const pos = state.nodePositions.get(n.id);
      const card = document.createElement('div');
      card.id = `node-card-${n.id}`;
      card.className = 'node-card status-PENDING';
      card.style.left = `${pos.x}px`;
      card.style.top = `${pos.y}px`;

      card.innerHTML = `
        <div class="node-card-header">
          <span class="node-card-id">${n.id}</span>
          <span class="node-card-badge" id="badge-${n.id}"></span>
        </div>
        <div class="node-card-title" title="${n.name}">${n.name}</div>
        <div class="node-card-footer">
          <span>${n.is_async ? 'async' : 'sync'}</span>
          <span class="node-duration-tag" id="duration-${n.id}">-</span>
        </div>
      `;

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        selectNode(n.id);
      });

      el.nodesOverlay.appendChild(card);
    });

    // 3. Render Edge Connections
    renderEdges();
  }

  function renderEdges() {
    el.svgEdgesGroup.innerHTML = '';
    const edges = state.graphData.edges || [];
    const cardWidth = 190;
    const cardHeight = 70;

    edges.forEach(e => {
      const srcPos = state.nodePositions.get(e.source);
      const tgtPos = state.nodePositions.get(e.target);
      if (!srcPos || !tgtPos) return;

      const x1 = srcPos.x + cardWidth;
      const y1 = srcPos.y + cardHeight / 2;
      const x2 = tgtPos.x;
      const y2 = tgtPos.y + cardHeight / 2;

      // Cubic Bezier curve for smooth flow
      const dx = Math.max(40, (x2 - x1) * 0.5);
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'svg-edge-path');
      path.setAttribute('id', `edge-${e.source}-${e.target}`);
      path.setAttribute('marker-end', 'url(#arrowhead)');

      el.svgEdgesGroup.appendChild(path);
    });
  }

  function applyTransform() {
    const transformStr = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoomLevel})`;
    el.graphSvg.style.transform = transformStr;
    el.graphSvg.style.transformOrigin = '0 0';
    el.nodesOverlay.style.transform = transformStr;
    el.nodesOverlay.style.transformOrigin = '0 0';
  }

  function fitToView() {
    state.zoomLevel = 1.0;
    state.panX = 20;
    state.panY = 20;
    applyTransform();
  }

  // ---------------------------------------------------------------------------
  // Execution & Live Stream Runner
  // ---------------------------------------------------------------------------

  function getParsedInitialState() {
    try {
      const raw = el.inputStateEditor.value.trim();
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      logEvent('error', `Invalid JSON in initial state editor: ${err.message}`);
      return null;
    }
  }

  function setLiveStatus(status, text) {
    el.liveStatusPill.className = `status-pill ${status}`;
    el.liveStatusText.textContent = text;
  }

  function updateNodeVisual(nodeId, status, durationMs, output) {
    const card = document.getElementById(`node-card-${nodeId}`);
    if (!card) return;

    card.className = `node-card status-${status} ${state.selectedNodeId === nodeId ? 'selected' : ''}`;

    const durEl = document.getElementById(`duration-${nodeId}`);
    if (durEl && durationMs !== undefined) {
      durEl.textContent = `${durationMs}ms`;
    }

    // Save in nodeResults
    state.nodeResults.set(nodeId, { status, durationMs, output });

    // If currently selected, refresh inspector
    if (state.selectedNodeId === nodeId) {
      renderInspector(nodeId);
    }
  }

  function resetResults() {
    state.nodeResults.clear();
    const cards = document.querySelectorAll('.node-card');
    cards.forEach(c => {
      c.className = 'node-card status-PENDING';
      const dur = c.querySelector('.node-duration-tag');
      if (dur) dur.textContent = '-';
    });
    const paths = document.querySelectorAll('.svg-edge-path');
    paths.forEach(p => p.classList.remove('active'));

    if (state.selectedNodeId) {
      renderInspector(state.selectedNodeId);
    }
  }

  async function executeLiveStream() {
    if (!state.currentGraphId) return;
    const initialState = getParsedInitialState();
    if (initialState === null) return;

    resetResults();
    setLiveStatus('running', 'Executing');
    logEvent('info', `Starting live stream execution for "${state.currentGraphId}"...`);

    // Close any previous event source
    if (state.eventSource) {
      state.eventSource.close();
    }

    const stateParam = encodeURIComponent(JSON.stringify(initialState));
    const url = `/api/graphs/${state.currentGraphId}/stream?state=${stateParam}`;
    state.eventSource = new EventSource(url);

    state.eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        handleStreamEvent(event);
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    state.eventSource.onerror = (e) => {
      if (state.eventSource.readyState === EventSource.CLOSED) {
        // Normal completion
      } else {
        logEvent('error', 'Live stream connection closed.');
        state.eventSource.close();
      }
    };
  }

  function handleStreamEvent(event) {
    const { event_type, node_id, data, message } = event;

    switch (event_type) {
      case 'graph:start':
        logEvent('start', message || 'Graph execution started.');
        break;

      case 'node:start':
        updateNodeVisual(node_id, 'RUNNING');
        logEvent('start', message || `Node ${node_id} running...`);
        break;

      case 'node:success':
        updateNodeVisual(node_id, 'COMPLETED', data?.duration_ms, data?.output);
        logEvent('success', message || `Node ${node_id} completed.`);
        break;

      case 'node:failed':
        updateNodeVisual(node_id, 'FAILED', data?.duration_ms, { error: data?.error });
        logEvent('fail', message || `Node ${node_id} failed!`);
        break;

      case 'node:skipped':
        updateNodeVisual(node_id, 'SKIPPED');
        logEvent('skip', message || `Node ${node_id} skipped.`);
        break;

      case 'graph:complete':
        setLiveStatus('completed', 'Success');
        if (data?.total_duration_ms) {
          el.metricLastDuration.textContent = `${data.total_duration_ms}ms`;
        }
        logEvent('success', `DAG Execution Finished in ${data?.total_duration_ms}ms!`);
        if (state.eventSource) state.eventSource.close();
        break;

      case 'graph:failed':
        setLiveStatus('failed', 'Failed');
        logEvent('fail', `DAG Execution Failed: ${data?.error || 'Unknown error'}`);
        if (state.eventSource) state.eventSource.close();
        break;
    }
  }

  async function executeFastRun() {
    if (!state.currentGraphId) return;
    const initialState = getParsedInitialState();
    if (initialState === null) return;

    resetResults();
    setLiveStatus('running', 'Running');
    logEvent('info', `Running ${state.currentGraphId} via POST /run...`);

    try {
      const res = await fetch(`/api/graphs/${state.currentGraphId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initial_state: initialState }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Apply results to all nodes
      Object.entries(data.node_details || {}).forEach(([nid, detail]) => {
        updateNodeVisual(nid, detail.status, detail.execution_time_ms, detail.output || detail.error);
      });

      el.metricLastDuration.textContent = `${data.total_duration_ms}ms`;
      if (data.status === 'COMPLETED') {
        setLiveStatus('completed', 'Done');
        logEvent('success', `Fast Run completed successfully in ${data.total_duration_ms}ms.`);
      } else {
        setLiveStatus('failed', 'Failed');
        logEvent('fail', `Fast Run finished with failure: ${data.error}`);
      }
    } catch (err) {
      setLiveStatus('failed', 'Error');
      logEvent('error', `Fast Run error: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Node Inspector
  // ---------------------------------------------------------------------------

  function selectNode(nodeId) {
    state.selectedNodeId = nodeId;

    // Highlight card
    document.querySelectorAll('.node-card').forEach(c => c.classList.remove('selected'));
    const card = document.getElementById(`node-card-${nodeId}`);
    if (card) card.classList.add('selected');

    renderInspector(nodeId);
  }

  function renderInspector(nodeId) {
    if (!state.graphData || !state.graphData.nodes) return;
    const node = state.graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    el.inspectorEmpty.classList.add('hidden');
    el.inspectorContent.classList.remove('hidden');

    el.inspectorNodeName.textContent = node.name;
    el.inspectorNodeId.textContent = node.id;
    el.inspectorNodeDesc.textContent = node.description || 'No description available for this node.';
    el.inspectorNodeAsync.textContent = node.is_async ? 'True (asyncio)' : 'False (sync/thread)';
    el.inspectorNodeCacheable.textContent = node.cacheable ? 'Enabled' : 'Disabled';
    el.inspectorNodeOutkey.textContent = node.output_key || node.id;
    el.inspectorNodeInputs.textContent = (node.inputs || []).join(', ') || 'Auto-wired';

    const result = state.nodeResults.get(nodeId);
    if (result) {
      el.inspectorNodeStatus.className = `status-tag ${result.status.toLowerCase()}`;
      el.inspectorNodeStatus.textContent = result.status;
      el.inspectorNodeTime.textContent = result.durationMs ? `${result.durationMs}ms` : '-';
      el.inspectorOutputJson.textContent = result.output !== undefined
        ? JSON.stringify(result.output, null, 2)
        : 'None';
    } else {
      el.inspectorNodeStatus.className = 'status-tag pending';
      el.inspectorNodeStatus.textContent = 'Pending';
      el.inspectorNodeTime.textContent = '-';
      el.inspectorOutputJson.textContent = 'Node has not been executed yet.';
    }
  }

  // ---------------------------------------------------------------------------
  // Console Logging
  // ---------------------------------------------------------------------------

  function logEvent(type, message) {
    state.eventCount++;
    el.eventCountBadge.textContent = `${state.eventCount} events`;

    const row = document.createElement('div');
    row.className = `log-entry ${type}`;
    const timeStr = new Date().toLocaleTimeString();
    row.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="log-msg">${escapeHtml(message)}</span>
    `;

    el.eventConsole.appendChild(row);
    el.eventConsole.scrollTop = el.eventConsole.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  // ---------------------------------------------------------------------------
  // Canvas Pan & Drag
  // ---------------------------------------------------------------------------

  function setupCanvasInteractions() {
    el.canvasContainer.addEventListener('mousedown', (e) => {
      // Only drag if left click on empty canvas
      if (e.target === el.canvasContainer || e.target === el.graphSurface || e.target.tagName === 'svg') {
        state.isDragging = true;
        state.dragStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!state.isDragging) return;
      state.panX = e.clientX - state.dragStart.x;
      state.panY = e.clientY - state.dragStart.y;
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      state.isDragging = false;
    });

    el.canvasContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      state.zoomLevel = Math.min(2.5, Math.max(0.4, state.zoomLevel * zoomFactor));
      applyTransform();
    }, { passive: false });
  }

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------

  function bindEvents() {
    el.graphSelect.addEventListener('change', (e) => {
      loadGraph(e.target.value);
    });

    el.btnStreamRun.addEventListener('click', executeLiveStream);
    el.btnRunGraph.addEventListener('click', executeFastRun);
    el.btnResetGraph.addEventListener('click', () => {
      resetResults();
      setLiveStatus('idle', 'Reset');
      logEvent('info', 'Workflow states reset.');
    });

    el.btnZoomIn.addEventListener('click', () => {
      state.zoomLevel = Math.min(2.5, state.zoomLevel + 0.15);
      applyTransform();
    });

    el.btnZoomOut.addEventListener('click', () => {
      state.zoomLevel = Math.max(0.4, state.zoomLevel - 0.15);
      applyTransform();
    });

    el.btnFitView.addEventListener('click', fitToView);

    el.btnFormatJson.addEventListener('click', () => {
      try {
        const val = JSON.parse(el.inputStateEditor.value);
        el.inputStateEditor.value = JSON.stringify(val, null, 2);
      } catch (err) {
        logEvent('error', `Cannot format JSON: ${err.message}`);
      }
    });

    el.btnClearLogs.addEventListener('click', () => {
      el.eventConsole.innerHTML = '';
      state.eventCount = 0;
      el.eventCountBadge.textContent = '0 events';
    });

    el.btnCopyOutput.addEventListener('click', () => {
      const text = el.inspectorOutputJson.textContent;
      navigator.clipboard.writeText(text).then(() => {
        el.btnCopyOutput.textContent = 'Copied!';
        setTimeout(() => { el.btnCopyOutput.textContent = 'Copy'; }, 1500);
      });
    });

    setupCanvasInteractions();
  }

  // Initialize on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
