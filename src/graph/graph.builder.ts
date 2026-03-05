import { AnalysisResult, ComponentInfo, DirectiveInfo, FlowGraph, GraphEdge, GraphNode, NodeType, PipeInfo, RouteInfo, ServiceInfo } from '../types';


const NODE_W = 180;
const NODE_H = 64;
const CANVAS_W = 1400;
const CANVAS_H = 900;

let _edgeCounter = 0;
function edgeId(): string {
  return `e${++_edgeCounter}`;
}

// ─── Public entry ─────────────────────────────────────────────────────────────

export function buildGraph(result: AnalysisResult, projectName: string): FlowGraph {
  _edgeCounter = 0;

  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // 1. Create a node for every detected component
  for (const comp of result.components) {
    const node: GraphNode = {
      id: comp.id,
      label: comp.name,
      type: isRootComponent(comp) ? 'root' : 'component',
      filePath: comp.filePath,
      selector: comp.selector,
      inputs: comp.inputs,
      outputs: comp.outputs,
      isStandalone: comp.isStandalone,
      x: 0,
      y: 0,
    };
    nodeMap.set(comp.id, node);
  }

  // 2. Create nodes for services
  for (const svc of (result.services ?? [])) {
    nodeMap.set(svc.id, {
      id: svc.id,
      label: svc.name,
      type: 'service',
      filePath: svc.filePath,
      x: 0,
      y: 0,
    });
  }

  // 3. Create nodes for directives
  for (const dir of (result.directives ?? [])) {
    nodeMap.set(dir.id, {
      id: dir.id,
      label: dir.name,
      type: 'directive',
      filePath: dir.filePath,
      selector: dir.selector,
      x: 0,
      y: 0,
    });
  }

  // 4. Create nodes for pipes
  for (const pipe of (result.pipes ?? [])) {
    nodeMap.set(pipe.id, {
      id: pipe.id,
      label: pipe.name,
      type: 'pipe',
      filePath: pipe.filePath,
      selector: pipe.pipeName, // reuse selector field to store the pipe name
      x: 0,
      y: 0,
    });
  }

  // 5. Attach route paths to nodes
  attachRoutePaths(result.routes, nodeMap, result.components);

  // 6. Build edges from route tree
  buildRouteEdges(result.routes, null, nodeMap, edges, result.components);

  // 7. Build "uses" edges from template analysis (component → child component)
  buildUsesEdges(result.components, nodeMap, edges);

  // 8. Build "navigate" edges (routerLink, href, router.navigate calls)
  buildNavigateEdges(result.components, nodeMap, edges);

  // 9. Build "uses" edges from components to their injected services
  buildServiceEdges(result.components, result.services ?? [], nodeMap, edges);

  // 10. Build "uses" edges from components to directives used in templates
  buildDirectiveEdges(result.components, result.directives ?? [], nodeMap, edges);

  // 11. Build "uses" edges from components to pipes used in templates
  buildPipeEdges(result.components, result.pipes ?? [], nodeMap, edges);

  // 12. Ensure there are no duplicate edges
  const uniqueEdges = deduplicateEdges(edges);

  // 13. Compute 2-D layout
  const nodes = [...nodeMap.values()];
  computeLayout(nodes, uniqueEdges);

  const totalRoutes = countRoutes(result.routes);

  return {
    nodes,
    edges: uniqueEdges,
    metadata: {
      framework: result.framework,
      projectName,
      generatedAt: new Date().toISOString(),
      projectRoot: result.projectRoot,
      totalComponents: nodes.length,
      totalRoutes,
    },
  };
}

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * A component is the "root" when its selector is "app-root" or its class name
 * is "App" / "AppComponent" (any casing). Everything else is just a component.
 */
function isRootComponent(comp: ComponentInfo): boolean {
  const name = comp.name.toLowerCase();
  const selector = comp.selector.toLowerCase();
  return name === 'app' || name === 'appcomponent' || selector === 'app-root';
}

// ─── Route path attachment ────────────────────────────────────────────────────

function attachRoutePaths(
  routes: RouteInfo[],
  nodeMap: Map<string, GraphNode>,
  components: ComponentInfo[],
  parentPath = ''
): void {
  for (const route of routes) {
    const fullPath = joinPaths(parentPath, route.path);

    if (route.componentId) {
      const node = nodeMap.get(route.componentId);
      if (node && !node.route) node.route = fullPath || '/';
    } else if (route.componentName) {
      const comp = components.find(c => c.name === route.componentName);
      if (comp) {
        const node = nodeMap.get(comp.id);
        if (node && !node.route) node.route = fullPath || '/';
      }
    }

    if (route.children) {
      attachRoutePaths(route.children, nodeMap, components, fullPath);
    }
  }
}

function joinPaths(parent: string, segment: string): string {
  if (!segment) return parent;
  if (segment.startsWith('/')) return segment;
  return parent ? `${parent}/${segment}` : `/${segment}`;
}

// ─── Route edges ──────────────────────────────────────────────────────────────

function buildRouteEdges(
  routes: RouteInfo[],
  parentComponentId: string | null,
  nodeMap: Map<string, GraphNode>,
  edges: GraphEdge[],
  components: ComponentInfo[]
): void {
  for (const route of routes) {
    const targetId = resolveRouteComponentId(route, components);

    if (targetId && nodeMap.has(targetId)) {
      if (parentComponentId) {
        edges.push({
          id: edgeId(),
          source: parentComponentId,
          target: targetId,
          type: 'child-route',
          label: route.path ? `/${route.path}` : '',
        });
      } else {
        // Top-level route: try to connect from AppComponent if it exists
        const appNode = findAppComponentNode(nodeMap);
        if (appNode && appNode.id !== targetId) {
          edges.push({
            id: edgeId(),
            source: appNode.id,
            target: targetId,
            type: 'route',
            label: route.path ? `/${route.path}` : '/',
          });
        }
      }

      if (route.children) {
        buildRouteEdges(route.children, targetId, nodeMap, edges, components);
      }
    } else if (route.loadChildren) {
      // Lazy-loaded module/component — represent as a virtual node.
      // Works for both top-level routes (parentComponentId is null → use AppComponent)
      // and nested routes (parentComponentId is set).
      const sourceId = parentComponentId ?? findAppComponentNode(nodeMap)?.id ?? null;
      if (sourceId) {
        const lazyId = `lazy_${route.path}`;
        if (!nodeMap.has(lazyId)) {
          nodeMap.set(lazyId, {
            id: lazyId,
            label: `${route.path} (lazy)`,
            type: 'lazy-module',
            filePath: '',
            route: `/${route.path}`,
            x: 0,
            y: 0,
          });
        }
        edges.push({
          id: edgeId(),
          source: sourceId,
          target: lazyId,
          type: 'lazy-load',
          label: `/${route.path}`,
        });
      }
    } else if (route.children && targetId) {
      buildRouteEdges(route.children, targetId, nodeMap, edges, components);
    }
  }
}

function resolveRouteComponentId(
  route: RouteInfo,
  components: ComponentInfo[]
): string | undefined {
  if (route.componentId) return route.componentId;
  if (route.componentName) {
    const comp = components.find(c => c.name === route.componentName);
    return comp?.id;
  }
  return undefined;
}

function findAppComponentNode(nodeMap: Map<string, GraphNode>): GraphNode | null {
  for (const node of nodeMap.values()) {
    if (node.type === 'root') return node;
  }
  // Fall back to any node labelled "AppComponent"
  for (const node of nodeMap.values()) {
    if (node.label === 'AppComponent') return node;
  }
  return null;
}

// ─── Uses edges ───────────────────────────────────────────────────────────────

function buildUsesEdges(
  components: ComponentInfo[],
  nodeMap: Map<string, GraphNode>,
  edges: GraphEdge[]
): void {
  const selectorToId = new Map(
    components.map(c => [c.selector.toLowerCase(), c.id])
  );

  for (const comp of components) {
    for (const usedSelector of comp.usedComponents) {
      const targetId = selectorToId.get(usedSelector);
      if (!targetId || targetId === comp.id) continue;
      if (!nodeMap.has(targetId)) continue;

      edges.push({
        id: edgeId(),
        source: comp.id,
        target: targetId,
        type: 'uses',
      });
    }
  }
}

// ─── Navigate edges ─────────────────────────────────────────────────────────

/** Normalise a route string so '/about', 'about', and '/about/' all match. */
function normalizeRoute(route: string): string {
  let r = route.trim().replace(/['"\[\]]/g, '');
  if (!r.startsWith('/')) r = '/' + r;
  r = r.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  return r;
}

function buildNavigateEdges(
  components: ComponentInfo[],
  nodeMap: Map<string, GraphNode>,
  edges: GraphEdge[]
): void {
  // Build route-path → node-id lookup
  const routeToId = new Map<string, string>();
  for (const node of nodeMap.values()) {
    if (node.route) {
      routeToId.set(normalizeRoute(node.route), node.id);
    }
  }

  for (const comp of components) {
    if (!nodeMap.has(comp.id)) continue;

    const allTargets = [
      ...comp.routerLinks,
      ...(comp.hrefs ?? []),
      ...(comp.navigateCalls ?? []),
    ];

    const seen = new Set<string>();
    for (const target of allTargets) {
      const normalized = normalizeRoute(target);
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const targetId = routeToId.get(normalized);
      if (!targetId || targetId === comp.id || !nodeMap.has(targetId)) continue;

      edges.push({
        id: edgeId(),
        source: comp.id,
        target: targetId,
        type: 'navigate',
        label: normalized,
      });
    }
  }
}

// ─── Service / Directive / Pipe edges ────────────────────────────────────────

function buildServiceEdges(
  components: ComponentInfo[],
  services: ServiceInfo[],
  nodeMap: Map<string, GraphNode>,
  edges: GraphEdge[]
): void {
  const serviceByName = new Map(services.map(s => [s.name, s.id]));
  for (const comp of components) {
    if (!nodeMap.has(comp.id)) continue;
    for (const svcName of (comp.injectedServices ?? [])) {
      const targetId = serviceByName.get(svcName);
      if (!targetId || !nodeMap.has(targetId)) continue;
      edges.push({ id: edgeId(), source: comp.id, target: targetId, type: 'uses' });
    }
  }
}

function buildDirectiveEdges(
  components: ComponentInfo[],
  directives: DirectiveInfo[],
  nodeMap: Map<string, GraphNode>,
  edges: GraphEdge[]
): void {
  const dirBySelector = new Map(directives.map(d => [d.selector, d.id]));
  for (const comp of components) {
    if (!nodeMap.has(comp.id)) continue;
    for (const sel of (comp.usedDirectives ?? [])) {
      const targetId = dirBySelector.get(sel);
      if (!targetId || !nodeMap.has(targetId)) continue;
      edges.push({ id: edgeId(), source: comp.id, target: targetId, type: 'uses' });
    }
  }
}

function buildPipeEdges(
  components: ComponentInfo[],
  pipes: PipeInfo[],
  nodeMap: Map<string, GraphNode>,
  edges: GraphEdge[]
): void {
  const pipeByName = new Map(pipes.map(p => [p.pipeName, p.id]));
  for (const comp of components) {
    if (!nodeMap.has(comp.id)) continue;
    for (const pipeName of (comp.usedPipes ?? [])) {
      const targetId = pipeByName.get(pipeName);
      if (!targetId || !nodeMap.has(targetId)) continue;
      edges.push({ id: edgeId(), source: comp.id, target: targetId, type: 'uses' });
    }
  }
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function deduplicateEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  return edges.filter(e => {
    const key = `${e.source}→${e.target}:${e.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Layout: left-to-right hierarchy (flow) + shared row below ───────────────

function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): void {
  if (nodes.length === 0) return;

  const HGAP      = 100;
  const VGAP      = 50;
  const COL_W     = NODE_W + HGAP;
  const ROW_H     = NODE_H + VGAP;
  const LEFT_PAD  = NODE_W / 2 + 50;
  const ZONE_GAP  = 100; // vertical gap between flow and shared zones

  // ── Classify nodes ──────────────────────────────────────────────────────
  // A node is "flow" if it is the root OR is targeted by a routing edge.
  // Everything else (only reached by 'uses') is "shared".
  const routeTargets = new Set<string>();
  edges.forEach(e => {
    if (e.type !== 'uses' && e.type !== 'navigate') routeTargets.add(e.target);
  });
  nodes.forEach(n => {
    n.lane = (n.type === 'root' || routeTargets.has(n.id)) ? 'flow' : 'shared';
  });

  const flowNodes   = nodes.filter(n => n.lane === 'flow');
  const sharedNodes = nodes.filter(n => n.lane === 'shared');

  // ── BFS depth assignment for flow nodes ─────────────────────────────────
  const levels = new Map<string, number>();
  if (flowNodes.length > 0) {
    // Build adjacency restricted to flow→flow edges
    const flowIds = new Set(flowNodes.map(n => n.id));
    const adj = new Map<string, string[]>();
    flowNodes.forEach(n => adj.set(n.id, []));
    edges.forEach(e => {
      if (flowIds.has(e.source) && flowIds.has(e.target)) {
        adj.get(e.source)!.push(e.target);
      }
    });

    const root = flowNodes.find(n => n.type === 'root') ?? flowNodes[0];
    levels.set(root.id, 0);
    const queue: string[] = [root.id];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const curLevel = levels.get(cur)!;
      for (const childId of (adj.get(cur) ?? [])) {
        if (!levels.has(childId)) {
          levels.set(childId, curLevel + 1);
          queue.push(childId);
        }
      }
    }
    // Unreachable flow nodes go to their own rightmost column
    const maxLevel = levels.size > 0 ? Math.max(...levels.values()) : 0;
    flowNodes.forEach(n => { if (!levels.has(n.id)) levels.set(n.id, maxLevel + 1); });

    // Group by level and assign x/y
    const byLevel = new Map<number, GraphNode[]>();
    flowNodes.forEach(n => {
      const lvl = levels.get(n.id)!;
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl)!.push(n);
    });

    let maxColSize = 0;
    byLevel.forEach(col => { maxColSize = Math.max(maxColSize, col.length); });
    const flowZoneH = Math.max(CANVAS_H * 0.55, maxColSize * ROW_H + 2 * ROW_H);

    byLevel.forEach((levelNodes, lvl) => {
      const x = LEFT_PAD + lvl * COL_W;
      const colH = levelNodes.length * ROW_H - VGAP;
      const startY = flowZoneH / 2 - colH / 2 + NODE_H / 2;
      levelNodes.forEach((n, i) => {
        n.x = x;
        n.y = startY + i * ROW_H;
      });
    });
  }

  // ── Shared nodes: 4 separate vertical columns, one per type ─────────────
  if (sharedNodes.length > 0) {
    const sharedGroupOrder: NodeType[] = ['component', 'service', 'directive', 'pipe'];

    // Y: below the bottom of the flow zone
    const maxFlowY = flowNodes.length
      ? Math.max(...flowNodes.map(n => n.y))
      : NODE_H / 2 + 40;
    const sharedStartY = maxFlowY + NODE_H / 2 + ZONE_GAP;

    let colIndex = 0;
    for (const typeName of sharedGroupOrder) {
      const group = sharedNodes.filter(n => n.type === typeName);
      if (group.length === 0) continue;
      const groupX = LEFT_PAD + colIndex * COL_W;
      group.forEach((n, i) => {
        n.x = groupX;
        n.y = sharedStartY + i * ROW_H;
      });
      colIndex++;
    }
    // Any types not in the explicit order fall into extra columns
    const handled = new Set<string>(sharedGroupOrder);
    sharedNodes.filter(n => !handled.has(n.type)).forEach((n, i) => {
      n.x = LEFT_PAD + colIndex * COL_W;
      n.y = sharedStartY + i * ROW_H;
    });
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function countRoutes(routes: RouteInfo[]): number {
  let count = routes.length;
  for (const r of routes) {
    if (r.children) count += countRoutes(r.children);
  }
  return count;
}
