(function(){
"use strict";
// ════════════════════════════════════════════════════════════════════════════
// DATA
// ════════════════════════════════════════════════════════════════════════════
const GRAPH = __DATA__;

const NODE_W = 180, NODE_H = 64, CORNER = 4;
const COLORS = {
  root:         { bg:'#FA5252', border:'#FA5252', text:'#fafafa' },
  component:    { bg:'#1976D2', border:'#1976D2', text:'#fafafa' },
  module:       { bg:'#D97706', border:'#B45309', text:'#fafafa' },
  'lazy-module':{ bg:'#64748B', border:'#64748B', text:'#fafafa' },
  route:        { bg:'#64748B', border:'#64748B', text:'#fafafa' },
  // legacy lazy-module kept for backward compat but no longer assigned
  service:      { bg:'#FFCA28', border:'#FFCA28', text:'#fafafa' },
  directive:    { bg:'#AB47BC', border:'#AB47BC', text:'#fafafa' },
  pipe:         { bg:'#00897B', border:'#00897B', text:'#fafafa' },
  guard:        { bg:'#43A047', border:'#43A047', text:'#fafafa' },
};
const ROOT_ICON  = '⚡';
const EDGE_COLOR = { uses:'#94A3B8', route:'#3B82F6', 'child-route':'#60A5FA', 'lazy-load':'#64748B', navigate:'#EC4899' };
const EDGE_DASH  = { uses:'none', route:'6,3', 'child-route':'4,2', 'lazy-load':'8,4', navigate:'3,3' };
const EDGE_WIDTH = { uses:1.5, route:2, 'child-route':1.5, 'lazy-load':2, navigate:1.5 };

// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════
const state = {
  nodes: GRAPH.nodes.map(n => Object.assign({}, n)),
  edges: GRAPH.edges,
  nodeMap: null,
  selected: null,
  tx: 0, ty: 0, scale: 1,
  panning: false, panStart: null,
  hasPanned: false,
  dragging: null, dragOffset: null,
  activeFilters: new Set(['root','component','module','route','service','directive','pipe','guard']),
  searchTerm: '',
  routing: 'ortho',
};
state.nodeMap = new Map(state.nodes.map(n => [n.id, n]));

// ════════════════════════════════════════════════════════════════════════════
// DOM refs
// ════════════════════════════════════════════════════════════════════════════
const svg       = document.getElementById('graph');
const defs      = document.getElementById('svg-defs');
const viewport  = document.getElementById('viewport');
const edgesGrp  = document.getElementById('edges-group');
const nodesGrp  = document.getElementById('nodes-group');
const zonesGrp  = document.getElementById('zones-group');
const compList  = document.getElementById('comp-list');
const searchEl  = document.getElementById('search');
const filterRow = document.getElementById('filter-row');
const detailPanel = document.getElementById('detail-panel');
const dpTitle   = document.getElementById('dp-title');
const dpBody    = document.getElementById('dp-body');
const dpClose   = document.getElementById('dp-close');
const legend    = document.getElementById('legend');

// ════════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════════
function init() {
  const m = GRAPH.metadata;
  document.getElementById('proj-name').textContent = m.projectName;
  document.getElementById('badge-comps').textContent = GRAPH.nodes.length + ' nodes';
  document.getElementById('badge-routes').textContent = m.totalRoutes + ' routes';
  document.getElementById('badge-fw').textContent = m.framework.charAt(0).toUpperCase() + m.framework.slice(1);
  document.title = '⚡ Boltflow — ' + m.projectName;

  buildDefs();
  buildFilters();
  buildLegend();
  renderSidebar();
  renderGraph();
  fitToScreen();
  bindEvents();
}

// ════════════════════════════════════════════════════════════════════════════
// SVG DEFS (arrowheads)
// ════════════════════════════════════════════════════════════════════════════
function buildDefs() {
  const types = Object.keys(EDGE_COLOR);
  types.forEach(type => {
    const color = EDGE_COLOR[type];
    const marker = document.createElementNS('http://www.w3.org/2000/svg','marker');
    marker.setAttribute('id','arrow-'+type);
    marker.setAttribute('markerWidth','8');
    marker.setAttribute('markerHeight','6');
    marker.setAttribute('refX','7');
    marker.setAttribute('refY','3');
    marker.setAttribute('orient','auto');
    const poly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
    poly.setAttribute('points','0 0, 8 3, 0 6');
    poly.setAttribute('fill', color);
    marker.appendChild(poly);
    defs.appendChild(marker);
  });

  // Guard arrowhead
  const guardMarker = document.createElementNS('http://www.w3.org/2000/svg','marker');
  guardMarker.setAttribute('id','arrow-guard');
  guardMarker.setAttribute('markerWidth','8');
  guardMarker.setAttribute('markerHeight','6');
  guardMarker.setAttribute('refX','7');
  guardMarker.setAttribute('refY','3');
  guardMarker.setAttribute('orient','auto');
  const guardPoly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
  guardPoly.setAttribute('points','0 0, 8 3, 0 6');
  guardPoly.setAttribute('fill', '#43A047');
  guardMarker.appendChild(guardPoly);
  defs.appendChild(guardMarker);

  // Angular logo symbol (reused for every non-root node)
  const sym = document.createElementNS('http://www.w3.org/2000/svg','symbol');
  sym.setAttribute('id','icon-angular');
  sym.setAttribute('viewBox','0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg','path');
  p.setAttribute('d','M9.87 2.5 3.022 5.666l.645 10.178zm4.26 0 6.202 13.344.645-10.178zM12 7.563l-2.451 5.964h4.906zm-3.73 8.959-.954 2.308L12 21.5l4.683-2.67-.953-2.308z');
  sym.appendChild(p);
  defs.appendChild(sym);
}

// ════════════════════════════════════════════════════════════════════════════
// FILTERS
// ════════════════════════════════════════════════════════════════════════════
const TYPE_LABELS = { root:'Root', component:'Component', module:'Module', route:'Route', service:'Service', directive:'Directive', pipe:'Pipe', guard:'Guard' };
function buildFilters() {
  const types = [...new Set(GRAPH.nodes.map(n => n.type))];
  types.forEach(type => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip active';
    chip.dataset.type = type;
    chip.textContent = TYPE_LABELS[type] || type;
    chip.addEventListener('click', () => toggleFilter(type, chip));
    filterRow.appendChild(chip);
  });
}
function toggleFilter(type, chip) {
  if (state.activeFilters.has(type)) {
    state.activeFilters.delete(type);
    chip.classList.remove('active');
  } else {
    state.activeFilters.add(type);
    chip.classList.add('active');
  }
  renderGraph();
  renderSidebar();
}

// ════════════════════════════════════════════════════════════════════════════
// LEGEND
// ════════════════════════════════════════════════════════════════════════════
function buildLegend() {
  const nodeTypes = [
    { label:'Root',      color:'#FA5252' },
    { label:'Component', color:'#1976d2' },
    { label:'Route',     color:'#64748B' },
    { label:'Service',   color:'#ffca28' },
    { label:'Directive', color:'#ab47bc' },
    { label:'Pipe',      color:'#00897b' },
    { label:'Guard',     color:'#43A047' },
  ];
  const edgeTypes = [
    { label:'Uses',        color:'#94A3B8', dash:false },
    { label:'Route',       color:'#3B82F6', dash:true },
    { label:'Child route', color:'#60A5FA', dash:true },
    { label:'Lazy load',   color:'#64748B', dash:true },
    { label:'Navigate',    color:'#EC4899', dash:true },
  ];
  let html = '<div style="font-size:.7rem;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">Legend</div>';
  nodeTypes.forEach(t => {
    html += '<div class="legend-row"><div class="legend-dot" style="background:'+t.color+'"></div>'+t.label+'</div>';
  });
  html += '<div style="margin:6px 0 4px;border-top:1px solid var(--border)"></div>';
  edgeTypes.forEach(t => {
    const lineStyle = t.dash
      ? 'border-top:2px dashed '+t.color+';width:24px;height:0'
      : 'background:'+t.color+';width:24px;height:2px';
    html += '<div class="legend-row"><div style="'+lineStyle+'"></div>'+t.label+'</div>';
  });
  legend.innerHTML = html;
}

// ════════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════════════════════════════════════════
function renderSidebar() {
  const term = state.searchTerm.toLowerCase();
  const visible = state.nodes.filter(n =>
    state.activeFilters.has(n.type) &&
    (n.label.toLowerCase().includes(term) || (n.selector||'').toLowerCase().includes(term))
  );
  compList.innerHTML = '';
  visible.forEach(node => {
    const item = document.createElement('div');
    item.className = 'comp-item' + (state.selected === node.id ? ' selected' : '');
    item.dataset.id = node.id;
    const c = COLORS[node.type] || COLORS.component;
    item.innerHTML =
      '<div class="comp-item-name"><span class="type-dot" style="background:'+c.bg+'"></span>'+escHtml(node.label)+'</div>'+
      '<div class="comp-item-meta">'+(node.selector ? escHtml(node.selector) : '')+(node.route ? ' · '+escHtml(node.route) : '')+'</div>';
    item.addEventListener('click', () => selectNode(node.id));
    compList.appendChild(item);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// GRAPH RENDER
// ════════════════════════════════════════════════════════════════════════════
function visibleSet() {
  const term = state.searchTerm.toLowerCase();
  return new Set(
    state.nodes
      .filter(n => state.activeFilters.has(n.type) &&
        (n.label.toLowerCase().includes(term) || (n.selector||'').toLowerCase().includes(term)))
      .map(n => n.id)
  );
}

function renderGraph() {
  zonesGrp.innerHTML = '';
  edgesGrp.innerHTML = '';
  nodesGrp.innerHTML = '';
  const vis = visibleSet();

  // Nodes that are targeted by at least one edge (across all edges, not just visible)
  const targetedIds = new Set(state.edges.map(e => e.target));

  // ── Zone backgrounds ──────────────────────────────────────────────────────────
  const flowVis = state.nodes.filter(n => vis.has(n.id) && n.lane !== 'shared');
  const compVis = state.nodes.filter(n => vis.has(n.id) && n.lane === 'shared' && n.type === 'component');
  const svcVis  = state.nodes.filter(n => vis.has(n.id) && n.lane === 'shared' && n.type === 'service');
  const dirVis  = state.nodes.filter(n => vis.has(n.id) && n.lane === 'shared' && n.type === 'directive');
  const pipeVis = state.nodes.filter(n => vis.has(n.id) && n.lane === 'shared' && n.type === 'pipe');
  const ZONE_PAD  = 28;

  function drawZone(zNodes, label, fill, stroke) {
    if (!zNodes.length) return;
    const x1 = Math.min(...zNodes.map(n => n.x)) - NODE_W / 2 - ZONE_PAD;
    const y1 = Math.min(...zNodes.map(n => n.y)) - NODE_H / 2 - ZONE_PAD;
    const x2 = Math.max(...zNodes.map(n => n.x)) + NODE_W / 2 + ZONE_PAD;
    const y2 = Math.max(...zNodes.map(n => n.y)) + NODE_H / 2 + ZONE_PAD;
    const bg = svgEl('rect');
    bg.setAttribute('x', x1); bg.setAttribute('y', y1);
    bg.setAttribute('width', x2 - x1); bg.setAttribute('height', y2 - y1);
    bg.setAttribute('rx', '4');
    bg.setAttribute('fill', fill);
    bg.setAttribute('stroke', stroke); bg.setAttribute('stroke-width', '1');
    bg.setAttribute('pointer-events', 'none');
    zonesGrp.appendChild(bg);
    const lbl = svgEl('text');
    lbl.setAttribute('x', x1 + 12); lbl.setAttribute('y', y1 + 16);
    lbl.setAttribute('font-size', '10'); lbl.setAttribute('font-weight', '700');
    lbl.setAttribute('fill', stroke); lbl.setAttribute('opacity', '0.9');
    lbl.setAttribute('letter-spacing', '0.09em');
    lbl.setAttribute('pointer-events', 'none');
    lbl.textContent = label;
    zonesGrp.appendChild(lbl);
  }

  drawZone(flowVis, 'NAVIGATION FLOW', 'rgba(204, 204, 204, 0.05)',  'rgb(204 204 204)');
  drawZone(compVis, 'COMPONENTS',      'rgba(25, 118, 210, 0.05)',   'rgb(25, 118, 210)');
  drawZone(svcVis,  'SERVICES',        'rgba(255, 202, 40, 0.05)',   'rgb(255, 202, 40)');
  drawZone(dirVis,  'DIRECTIVES',      'rgba(171, 71, 188, 0.05)',   'rgb(171, 71, 188)');
  drawZone(pipeVis, 'PIPES',           'rgba(0, 137, 123, 0.05)',  'rgb(0, 137, 123)');

  const guardVis = state.nodes.filter(n => vis.has(n.id) && n.type === 'guard');
  drawZone(guardVis, 'GUARDS',         'rgba(67, 160, 71, 0.05)',   'rgb(67, 160, 71)');

  // ── Focus set: selected node + its direct neighbours via any edge ────────────
  // Nodes/edges outside this set are dimmed when something is selected.
  const focusedNodes = new Set();
  const focusedEdges = new Set();
  if (state.selected) {
    focusedNodes.add(state.selected);
    state.edges.forEach(edge => {
      if (edge.source === state.selected || edge.target === state.selected) {
        focusedNodes.add(edge.source);
        focusedNodes.add(edge.target);
        focusedEdges.add(edge.id);
      }
    });
  }
  // When a guard node is selected, highlight all route edges that reference it
  if (state.selected) {
    const selNode = state.nodeMap.get(state.selected);
    if (selNode && selNode.type === 'guard') {
      state.edges.forEach(edge => {
        if (edge.guards && edge.guards.includes(selNode.label)) {
          focusedEdges.add(edge.id);
          focusedNodes.add(edge.source);
          focusedNodes.add(edge.target);
        }
      });
    }
    // When any node is selected, also highlight guard nodes referenced by its incoming route edges
    state.edges.forEach(edge => {
      if (edge.target === state.selected && edge.guards && edge.guards.length) {
        const guardNames = new Set(edge.guards);
        state.nodes.forEach(n => {
          if (n.type === 'guard' && guardNames.has(n.label)) focusedNodes.add(n.id);
        });
      }
    });
  }
  const hasFocus = focusedNodes.size > 0;
  const DIM = '0.12'; // opacity for non-focused elements

  // Pre-compute parallel-edge groups so overlapping arrows can be fanned apart
  const parallelMap = new Map();
  state.edges.forEach(edge => {
    if (!vis.has(edge.source) || !vis.has(edge.target)) return;
    const key = edge.source + '\x00' + edge.target;
    if (!parallelMap.has(key)) parallelMap.set(key, []);
    parallelMap.get(key).push(edge);
  });
  const PARALLEL_STEP = 28; // px of extra perpendicular offset per parallel edge

  // ── Guard info pre-computation ─────────────────────────────────────────────
  // Build a map of nodeId → unique guard names from all incoming route edges.
  const GUARD_COLOR = '#43A047';
  const nodeIncomingGuardsMap = new Map();
  state.edges.forEach(edge => {
    if (!edge.guards?.length) return;
    const existing = nodeIncomingGuardsMap.get(edge.target) || [];
    nodeIncomingGuardsMap.set(edge.target, [...new Set([...existing, ...edge.guards])]);
  });

  // Edges
  state.edges.forEach(edge => {
    if (!vis.has(edge.source) || !vis.has(edge.target)) return;
    const src = state.nodeMap.get(edge.source);
    const tgt = state.nodeMap.get(edge.target);
    if (!src || !tgt) return;

    const { sx, sy, tx, ty } = state.routing === 'ortho'
      ? calcEdgePointsOrtho(src, tgt)
      : calcEdgePoints(src, tgt);
    const group   = parallelMap.get(edge.source + '\x00' + edge.target) || [edge];
    const idx     = group.indexOf(edge);
    const pOffset = (idx - (group.length - 1) / 2) * PARALLEL_STEP;

    const color = EDGE_COLOR[edge.type] || '#94A3B8';
    const dash  = EDGE_DASH[edge.type] || 'none';
    const width = EDGE_WIDTH[edge.type] || 1.5;
    const { d, midX, midY } = state.routing === 'ortho'
      ? orthoPath(sx, sy, tx, ty, pOffset)
      : curvePath(sx, sy, tx, ty, pOffset);

    const edgeOpacity = hasFocus ? (focusedEdges.has(edge.id) ? '0.85' : DIM) : '0.75';

    const path = svgEl('path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', width);
    if (dash !== 'none') path.setAttribute('stroke-dasharray', dash);
    path.setAttribute('marker-end', 'url(#arrow-'+edge.type+')');
    path.setAttribute('opacity', edgeOpacity);
    edgesGrp.appendChild(path);

    // Edge label — only shown when the edge is focused (node selected)
    if (edge.label && hasFocus && focusedEdges.has(edge.id)) {
      const lbl = svgEl('text');
      lbl.setAttribute('x', midX); lbl.setAttribute('y', midY - 5);
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('font-size', '10');
      lbl.setAttribute('fill', color);
      lbl.setAttribute('opacity', '0.9');
      lbl.setAttribute('pointer-events', 'none');
      lbl.textContent = edge.label;
      edgesGrp.appendChild(lbl);
    }

  });

  // Nodes
  state.nodes.forEach(node => {
    if (!vis.has(node.id)) return;
    const c = COLORS[node.type] || COLORS.component;
    const nodeGuards = nodeIncomingGuardsMap.get(node.id);
    const nodeH = NODE_H;
    const x = node.x - NODE_W / 2, y = node.y - NODE_H / 2;
    const isSelected = state.selected === node.id;
    const nodeOpacity = hasFocus ? (focusedNodes.has(node.id) ? '1' : DIM) : '1';

    const g = svgEl('g');
    g.setAttribute('transform', 'translate('+x+','+y+')');
    g.setAttribute('cursor', 'pointer');
    g.setAttribute('opacity', nodeOpacity);
    g.dataset.id = node.id;
    g.addEventListener('mousedown', onNodeMouseDown);
    g.addEventListener('click', e => { e.stopPropagation(); selectNode(node.id); });

    // Shadow / selection ring
    if (isSelected) {
      const ring = svgEl('rect');
      ring.setAttribute('x', -3); ring.setAttribute('y', -3);
      ring.setAttribute('width', NODE_W + 6); ring.setAttribute('height', nodeH + 6);
      ring.setAttribute('rx', CORNER + 2); ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', '#38BDF8'); ring.setAttribute('stroke-width', '2');
      g.appendChild(ring);
    }

    // Background rect
    const rect = svgEl('rect');
    rect.setAttribute('width', NODE_W); rect.setAttribute('height', nodeH);
    rect.setAttribute('rx', CORNER);
    // rect.setAttribute('fill', c.bg);
    rect.setAttribute('fill', '#19191a');
    rect.setAttribute('stroke', c.border);
    rect.setAttribute('stroke-width', isSelected ? '2' : '1');
    g.appendChild(rect);

    // Top color bar
    // const bar = svgEl('rect');
    // bar.setAttribute('width', NODE_W); bar.setAttribute('height', '4');
    // bar.setAttribute('rx', CORNER);
    // bar.setAttribute('fill', c.border);
    // bar.setAttribute('opacity', '0.6');
    // g.appendChild(bar);

    // Icon + label
    const icon = svgEl('use');
    icon.setAttribute('href', '#icon-angular');
    icon.setAttribute('x', 6);
    icon.setAttribute('y', 12);
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('pointer-events', 'none');
    icon.setAttribute('fill', c.border);
    g.appendChild(icon);

    const label = svgEl('text');
    label.setAttribute('x', 32);
    label.setAttribute('y', 24);
    label.setAttribute('font-size', '12');
    label.setAttribute('font-weight', '600');
    label.setAttribute('fill', c.border);
    label.setAttribute('pointer-events', 'none');
    label.textContent = truncate(node.label, 18);
    g.appendChild(label);

    // Sub-label (selector or route)
    if (node.route || node.selector) {
      const sub = svgEl('text');
      sub.setAttribute('x', 8);
      sub.setAttribute('y', 40);
      sub.setAttribute('font-size', '10');
      sub.setAttribute('fill', c.text);
      // sub.setAttribute('opacity', '0.65');
      sub.setAttribute('pointer-events', 'none');
      const subText = node.type === 'guard' && node.selector
        ? truncate(node.selector, 26)
        : node.route ? 'route: ' + node.route
        : node.selector === 'app-root' ? 'app-root'
        : 'selector: ' + node.selector;
      sub.textContent = truncate(subText, 26);
      g.appendChild(sub);
    }

    // Guard row — icon + guard name(s) right below the route sub-label
    if (nodeGuards && node.route) {
      const gIcon = svgEl('use');
      gIcon.setAttribute('href', '#icon-angular');
      gIcon.setAttribute('x', 8);
      gIcon.setAttribute('y', 46);
      gIcon.setAttribute('width', '11'); gIcon.setAttribute('height', '11');
      gIcon.setAttribute('fill', GUARD_COLOR);
      gIcon.setAttribute('pointer-events', 'none');
      g.appendChild(gIcon);

      const gTxt = svgEl('text');
      gTxt.setAttribute('x', 23);
      gTxt.setAttribute('y', 56);
      gTxt.setAttribute('font-size', '10');
      gTxt.setAttribute('font-weight', '500');
      gTxt.setAttribute('fill', GUARD_COLOR);
      gTxt.setAttribute('pointer-events', 'none');
      gTxt.textContent = truncate(nodeGuards.join(', '), 25);
      g.appendChild(gTxt);
    }

    // Unused warning — shown when no other node has an edge pointing to this node
    // Guard nodes use a different check: whether any route edge references them by name.
    let extraLabelCount = 0;
    if (node.type === 'guard') {
      const isUsedGuard = state.edges.some(e => e.guards && e.guards.includes(node.label));
      if (!isUsedGuard) {
        const warnY = node.selector ? 56 : 42;
        const warn = svgEl('text');
        warn.setAttribute('x', 8);
        warn.setAttribute('y', warnY);
        warn.setAttribute('font-size', '12');
        warn.setAttribute('fill', '#F97316');
        warn.setAttribute('pointer-events', 'none');
        warn.textContent = '⚠ Unused Guard';
        g.appendChild(warn);
        extraLabelCount++;
      }
    } else if (node.type !== 'root' && node.selector !== 'app-root' && !targetedIds.has(node.id)) {
      const warnY = (node.route || node.selector) ? 56 : 42;
      const warn = svgEl('text');
      warn.setAttribute('x', 8);
      warn.setAttribute('y', warnY);
      warn.setAttribute('font-size', '12');
      warn.setAttribute('fill', '#F97316');
      warn.setAttribute('pointer-events', 'none');
      warn.textContent = '⚠ Unused ' + (TYPE_LABELS[node.type] || node.type);
      g.appendChild(warn);
      extraLabelCount++;
    }

    // Circular dependency warning — shown on service nodes part of a DI cycle
    if (node.hasCircularDep) {
      const baseY = (node.route || node.selector) ? 56 : 42;
      const circY = baseY + extraLabelCount * 14;
      const circ = svgEl('text');
      circ.setAttribute('x', 8);
      circ.setAttribute('y', circY);
      circ.setAttribute('font-size', '12');
      circ.setAttribute('fill', '#EF4444');
      circ.setAttribute('pointer-events', 'none');
      circ.textContent = '⚠ Circular dependency';
      g.appendChild(circ);
    }

    nodesGrp.appendChild(g);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SELECTION & DETAIL PANEL
// ════════════════════════════════════════════════════════════════════════════
function selectNode(id) {
  state.selected = id;
  renderGraph();
  renderSidebar();

  const node = state.nodeMap.get(id);
  if (!node) { closeDetail(); return; }

  detailPanel.classList.remove('hidden');
  dpTitle.textContent = node.label;

  const c = COLORS[node.type] || COLORS.component;
  const typeBadge = '<span class="dp-badge" style="background:'+c.bg+'">'+TYPE_LABELS[node.type]+'</span>';

  let html = '';
  html += '<div class="dp-section">';
  html += '<div class="dp-section-title">Identity</div>';
  html += row('Type', typeBadge);
  if (node.type === 'pipe' && node.selector) html += row('Pipe name', code(node.selector));
  else if (node.type === 'guard' && node.selector) {
    // selector field stores the implemented interfaces for guard nodes
    const ifaces = node.selector.split(', ');
    html += '<div class="dp-section"><div class="dp-section-title">Implements (' + ifaces.length + ')</div>';
    ifaces.forEach(i => {
      html += '<span class="dp-chip" style="border-color:#43A047;color:#43A047">' + escHtml(i) + '</span>';
    });
    html += '</div>';
  } else if (node.selector) html += row('Selector', code(node.selector));
  if (node.route) {
    html += row('Route', code(node.route));
    const incomingGuardEdges = state.edges.filter(e => e.target === id && e.guards && e.guards.length);
    if (incomingGuardEdges.length) {
      const routeGuards = [...new Set(incomingGuardEdges.flatMap(e => e.guards))];
      html += row('Guards', routeGuards.map(g => {
        const guardNode = state.nodes.find(n => n.type === 'guard' && n.label === g);
        const onclick = guardNode ? ' onclick="selectNode(\'' + guardNode.id + '\')"' : '';
        return '<span class="dp-chip"' + onclick + '>' + escHtml(g) + '</span>';
      }).join(' '));
    }
  }
  if (node.isStandalone !== undefined) html += row('Standalone', node.isStandalone ? 'Yes' : 'No');
  html += '</div>';

  if (node.inputs && node.inputs.length) {
    html += '<div class="dp-section"><div class="dp-section-title">Inputs ('+node.inputs.length+')</div>';
    node.inputs.forEach(i => {
      const label = escHtml(i.name) + (i.type ? ': <span style="color:var(--text-muted)">' + escHtml(i.type) + '</span>' : '');
      html += '<span class="dp-chip">' + label + (i.required ? '<sup style="color:#F87171">*</sup>' : '') + '</span>';
    });
    html += '</div>';
  }
  if (node.outputs && node.outputs.length) {
    html += '<div class="dp-section"><div class="dp-section-title">Outputs (' + node.outputs.length + ')</div>';
    node.outputs.forEach(o => {
      const label = escHtml(o.name) + (o.type ? ': <span style="color:var(--text-muted)">' + escHtml(o.type) + '</span>' : '');
      html += '<span class="dp-chip">' + label + '</span>';
    });
    html += '</div>';
  }

  // Guard node: show which routes reference it
  if (node.type === 'guard') {
    const routeEdgesWithGuard = state.edges.filter(e => e.guards && e.guards.includes(node.label));
    if (routeEdgesWithGuard.length) {
      html += '<div class="dp-section"><div class="dp-section-title">Used by routes (' + routeEdgesWithGuard.length + ')</div>';
      routeEdgesWithGuard.forEach(e => {
        const srcNode = state.nodeMap.get(e.source);
        const tgtNode = state.nodeMap.get(e.target);
        const routeLabel = e.label || '(unnamed)';
        if (srcNode && tgtNode) {
          html += '<div class="dp-row"><span class="dp-label">' + escHtml(routeLabel) + '</span><span class="dp-value">'
            + '<span class="dp-chip" onclick="selectNode(\'' + srcNode.id + '\')">' + escHtml(srcNode.label) + '</span>'
            + ' → '
            + '<span class="dp-chip" onclick="selectNode(\'' + tgtNode.id + '\')">' + escHtml(tgtNode.label) + '</span>'
            + '</span></div>';
        }
      });
      html += '</div>';
    } else {
      html += '<div class="dp-section"><div class="dp-section-title" style="color:#F97316">⚠ Unused Guard</div>'
        + '<div style="font-size:.8rem;color:var(--text-muted)">This guard is not referenced by any detected route.</div>'
        + '</div>';
    }
  }

  // Connections
  const usedBy = state.edges.filter(e => e.target === id && e.type === 'uses').map(e => state.nodeMap.get(e.source)).filter(Boolean);
  const uses   = state.edges.filter(e => e.source === id && e.type === 'uses').map(e => state.nodeMap.get(e.target)).filter(Boolean);

  if (uses.length) {
    html += '<div class="dp-section"><div class="dp-section-title">Uses ('+uses.length+')</div>';
    uses.forEach(n => html += '<span class="dp-chip" onclick="selectNode(\''+n.id+'\')">'+escHtml(n.label)+'</span>');
    html += '</div>';
  }
  if (usedBy.length) {
    html += '<div class="dp-section"><div class="dp-section-title">Used by ('+usedBy.length+')</div>';
    usedBy.forEach(n => html += '<span class="dp-chip" onclick="selectNode(\''+n.id+'\')">'+escHtml(n.label)+'</span>');
    html += '</div>';
  }

  html += '<div class="dp-section"><div class="dp-section-title">File</div><div class="dp-filepath">'+escHtml(node.filePath)+'</div></div>';

  dpBody.innerHTML = html;
}

function closeDetail() {
  state.selected = null;
  detailPanel.classList.add('hidden');
  renderGraph();
  renderSidebar();
}

function row(label, value) {
  return '<div class="dp-row"><span class="dp-label">'+escHtml(label)+'</span><span class="dp-value">'+value+'</span></div>';
}
function code(val) { return '<code style="font-size:.78rem;background:var(--surface2);padding:1px 5px;border-radius:3px">'+escHtml(val)+'</code>'; }

// Expose selectNode globally so dp-chip onclick can use it
window.selectNode = selectNode;

// ════════════════════════════════════════════════════════════════════════════
// GEOMETRY
// ════════════════════════════════════════════════════════════════════════════
function calcEdgePoints(src, tgt) {
  const dx = tgt.x - src.x, dy = tgt.y - src.y;
  const angle = Math.atan2(dy, dx);
  const hw = NODE_W / 2 + 2, hh = NODE_H / 2 + 2;

  function borderPt(cx, cy, a) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const t = Math.min(
      Math.abs(ca) < 1e-9 ? Infinity : hw / Math.abs(ca),
      Math.abs(sa) < 1e-9 ? Infinity : hh / Math.abs(sa)
    );
    return { x: cx + ca * t, y: cy + sa * t };
  }

  const s = borderPt(src.x, src.y, angle);
  const t = borderPt(tgt.x, tgt.y, angle + Math.PI);
  return { sx: s.x, sy: s.y, tx: t.x, ty: t.y };
}

function curvePath(sx, sy, tx, ty, pOffset) {
  const dx = tx - sx, dy = ty - sy;
  const dist = Math.sqrt(dx*dx+dy*dy) || 1;
  const bend = Math.min(dist * 0.35, 80) + (pOffset || 0);
  const cpx = (sx+tx)/2 - dy/dist*bend;
  const cpy = (sy+ty)/2 + dx/dist*bend;
  // Midpoint of the quadratic bezier at t=0.5
  const midX = 0.25*sx + 0.5*cpx + 0.25*tx;
  const midY = 0.25*sy + 0.5*cpy + 0.25*ty;
  return { d: 'M'+sx+','+sy+' Q'+cpx+','+cpy+' '+tx+','+ty, midX, midY };
}

function calcEdgePointsOrtho(src, tgt, tgtHalfW) {
  // Exit the right side of source when target is to the right, otherwise left.
  const thw = tgtHalfW !== undefined ? tgtHalfW : NODE_W / 2;
  if (tgt.x >= src.x) {
    return { sx: src.x + NODE_W/2, sy: src.y, tx: tgt.x - thw, ty: tgt.y };
  } else {
    return { sx: src.x - NODE_W/2, sy: src.y, tx: tgt.x + thw, ty: tgt.y };
  }
}

function orthoPath(sx, sy, tx, ty, pOffset) {
  // Offset the vertical pivot segment to separate parallel edges
  const midX = (sx + tx) / 2 + (pOffset || 0);
  return {
    d: 'M'+sx+','+sy+' L'+midX+','+sy+' L'+midX+','+ty+' L'+tx+','+ty,
    midX,
    midY: (sy + ty) / 2,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TRANSFORM / ZOOM / PAN
// ════════════════════════════════════════════════════════════════════════════
function applyTransform() {
  viewport.setAttribute('transform','translate('+state.tx+','+state.ty+') scale('+state.scale+')');
}

function fitToScreen() {
  const vis = visibleSet();
  const visNodes = state.nodes.filter(n => vis.has(n.id));
  if (!visNodes.length) return;

  const rect = svg.getBoundingClientRect();
  const W = rect.width || 800, H = rect.height || 600;
  const pad = 60;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  visNodes.forEach(n => {
    minX = Math.min(minX, n.x - NODE_W/2);
    minY = Math.min(minY, n.y - NODE_H/2);
    maxX = Math.max(maxX, n.x + NODE_W/2);
    maxY = Math.max(maxY, n.y + NODE_H/2);
  });

  const contentW = maxX - minX + pad*2;
  const contentH = maxY - minY + pad*2;
  const scale = Math.min((W/contentW), (H/contentH), 1.5);
  state.scale = scale;
  state.tx = (W - contentW * scale) / 2 - (minX - pad) * scale;
  state.ty = (H - contentH * scale) / 2 - (minY - pad) * scale;
  applyTransform();
}

function zoom(factor, cx, cy) {
  const rect = svg.getBoundingClientRect();
  const ox = (cx !== undefined ? cx : rect.width/2);
  const oy = (cy !== undefined ? cy : rect.height/2);
  state.tx = ox - (ox - state.tx) * factor;
  state.ty = oy - (oy - state.ty) * factor;
  state.scale = Math.max(0.1, Math.min(4, state.scale * factor));
  applyTransform();
}

// ════════════════════════════════════════════════════════════════════════════
// DRAG NODES
// ════════════════════════════════════════════════════════════════════════════
function onNodeMouseDown(e) {
  e.stopPropagation();
  const id = e.currentTarget.dataset.id;
  const node = state.nodeMap.get(id);
  if (!node) return;
  state.dragging = node;
  const svgPt = svgPoint(e.clientX, e.clientY);
  state.dragOffset = { x: svgPt.x - node.x, y: svgPt.y - node.y };
  svg.addEventListener('mousemove', onDragMove);
  svg.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
  if (!state.dragging) return;
  const pt = svgPoint(e.clientX, e.clientY);
  state.dragging.x = pt.x - state.dragOffset.x;
  state.dragging.y = pt.y - state.dragOffset.y;
  renderGraph();
}

function onDragEnd() {
  state.dragging = null;
  svg.removeEventListener('mousemove', onDragMove);
  svg.removeEventListener('mouseup', onDragEnd);
}

function svgPoint(cx, cy) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (cx - rect.left - state.tx) / state.scale,
    y: (cy - rect.top  - state.ty) / state.scale,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EVENTS
// ════════════════════════════════════════════════════════════════════════════
function bindEvents() {
  // Background pan
  const bg = document.getElementById('bg');
  bg.addEventListener('mousedown', e => {
    if (state.dragging) return;
    state.panning = true;
    state.panStart = { x: e.clientX - state.tx, y: e.clientY - state.ty };
    svg.classList.add('panning');
  });
  window.addEventListener('mousemove', e => {
    if (!state.panning) return;
    state.hasPanned = true;
    state.tx = e.clientX - state.panStart.x;
    state.ty = e.clientY - state.panStart.y;
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    state.panning = false;
    svg.classList.remove('panning');
  });

  // Wheel zoom
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  // Zoom buttons
  document.getElementById('btn-zoomin').addEventListener('click', () => zoom(1.2));
  document.getElementById('btn-zoomout').addEventListener('click', () => zoom(0.83));
  document.getElementById('btn-fit').addEventListener('click', fitToScreen);

  // Click on SVG background → deselect (but not after a pan drag)
  svg.addEventListener('click', e => {
    if (e.target === svg || e.target.id === 'bg' || e.target.id === 'graph') {
      if (state.hasPanned) { state.hasPanned = false; return; }
      closeDetail();
    }
  });

  // Detail panel close
  dpClose.addEventListener('click', closeDetail);

  // Search
  searchEl.addEventListener('input', e => {
    state.searchTerm = e.target.value.trim();
    renderSidebar();
    renderGraph();
  });

  // Routing toggle
  document.getElementById('routing-btn').addEventListener('click', () => {
    state.routing = state.routing === 'curve' ? 'ortho' : 'curve';
    document.getElementById('routing-btn').textContent =
      state.routing === 'ortho' ? '⊢ Ortho' : '⌒ Curve';
    renderGraph();
  });

  // Theme toggle
  document.getElementById('theme-btn').addEventListener('click', () => {
    document.body.classList.toggle('light');
    document.getElementById('theme-btn').textContent =
      document.body.classList.contains('light') ? '🌙 Dark' : '☀ Light';
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDetail();
    if ((e.key === '+' || e.key === '=') && !e.target.closest('input')) zoom(1.2);
    if (e.key === '-' && !e.target.closest('input')) zoom(0.83);
    if (e.key === '0' && !e.target.closest('input')) fitToScreen();
  });

  // Touch support (pinch zoom + pan)
  let lastTouches = null;
  svg.addEventListener('touchstart', e => {
    lastTouches = e.touches;
    if (e.touches.length === 1) {
      state.panning = true;
      state.panStart = { x: e.touches[0].clientX - state.tx, y: e.touches[0].clientY - state.ty };
    }
  }, { passive: true });
  svg.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && lastTouches && lastTouches.length === 2) {
      const prevDist = Math.hypot(lastTouches[0].clientX - lastTouches[1].clientX, lastTouches[0].clientY - lastTouches[1].clientY);
      const currDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const rect = svg.getBoundingClientRect();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      zoom(currDist / prevDist, mx, my);
    } else if (e.touches.length === 1 && state.panning) {
      state.tx = e.touches[0].clientX - state.panStart.x;
      state.ty = e.touches[0].clientY - state.panStart.y;
      applyTransform();
    }
    lastTouches = e.touches;
  }, { passive: true });
  svg.addEventListener('touchend', () => { state.panning = false; });
}

// ════════════════════════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════════════════════════
function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function truncate(s, max) { return s.length > max ? s.slice(0, max-1) + '…' : s; }

// ════════════════════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════════════════════
init();
})();
