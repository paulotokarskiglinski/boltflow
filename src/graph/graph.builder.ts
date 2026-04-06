import * as path from 'path';
import { AnalysisResult, ComponentInfo, DirectiveInfo, FlowGraph, GraphEdge, GraphNode, GuardInfo, NodeType, PipeInfo, RouteInfo, ServiceInfo } from '../types';


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
      lifecycleHooks: comp.lifecycleHooks,
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

  // 4b. Create nodes for guards
  // Collect all guard names referenced in any route so we can mark unused ones.
  const usedGuardNames = new Set<string>();
  function collectGuardNames(routes: RouteInfo[]): void {
    for (const r of routes) {
      if (r.guards) r.guards.forEach(g => usedGuardNames.add(g));
      if (r.children) collectGuardNames(r.children);
    }
  }
  collectGuardNames(result.routes);

  for (const guard of (result.guards ?? [])) {
    nodeMap.set(guard.id, {
      id: guard.id,
      label: guard.name,
      type: 'guard',
      filePath: guard.filePath,
      selector: guard.interfaces.join(', '),
      x: 0,
      y: 0,
    });
  }

  // 5. Inject routes from lazy-loaded files into their parent lazy route entries,
  //    then attach route paths (full /parent/child paths) to component nodes.
  const processedRoutes = injectLazyChildRoutes(result.routes);
  attachRoutePaths(processedRoutes, nodeMap, result.components);

  // 6. Build edges from route tree
  buildRouteEdges(processedRoutes, null, nodeMap, edges, result.components, result.projectRoot);

  // 6b. Build guard edges: protected node → guard node
  buildGuardEdges(edges, nodeMap, result.guards ?? []);

  // 7. Build "uses" edges from template analysis (component → child component)
  buildUsesEdges(result.components, nodeMap, edges);

  // 8. Build "navigate" edges (routerLink, href, router.navigate calls)
  buildNavigateEdges(result.components, nodeMap, edges);

  // 9. Build "uses" edges from components to their injected services,
  //    and service-to-service "uses" edges
  buildServiceEdges(result.components, result.services ?? [], nodeMap, edges);

  // 9b. Build "uses" edges for components dynamically instantiated via service calls
  //     (e.g. dialog.open(MyComponent), vcr.createComponent(MyComponent))
  buildDynamicUsageEdges(result.components, result.services ?? [], nodeMap, edges);

  // 10. Mark service nodes involved in circular dependency cycles
  markCircularServiceEdges(result.services ?? [], edges, nodeMap);

  // 11. Build "uses" edges from components to directives used in templates
  buildDirectiveEdges(result.components, result.directives ?? [], nodeMap, edges);

  // 12. Build "uses" edges from components to pipes used in templates
  buildPipeEdges(result.components, result.pipes ?? [], nodeMap, edges);

  // 13. Ensure there are no duplicate edges
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
  components: ComponentInfo[],
  projectRoot: string
): void {
  for (const route of routes) {
    const targetId = resolveRouteComponentId(route, components);

    if (targetId && nodeMap.has(targetId)) {
      // Use lazy-load edge type when the route is lazily loaded (loadComponent with import())
      const edgeType = route.loadChildren
        ? 'lazy-load'
        : parentComponentId ? 'child-route' : 'route';

      if (parentComponentId) {
        edges.push({
          id: edgeId(),
          source: parentComponentId,
          target: targetId,
          type: edgeType,
          label: route.path ? `/${route.path}` : '',
          guards: route.guards?.length ? route.guards : undefined,
        });
      } else {
        // Top-level route: try to connect from AppComponent if it exists
        const appNode = findAppComponentNode(nodeMap);
        if (appNode && appNode.id !== targetId) {
          edges.push({
            id: edgeId(),
            source: appNode.id,
            target: targetId,
            type: edgeType,
            label: route.path ? `/${route.path}` : '/',
            guards: route.guards?.length ? route.guards : undefined,
          });
        }
      }

      if (route.children) {
        buildRouteEdges(route.children, targetId, nodeMap, edges, components, projectRoot);
      }
    } else if (route.loadChildren) {
      // Lazy-loaded module — represent as a virtual module node.
      const sourceId = parentComponentId ?? findAppComponentNode(nodeMap)?.id ?? null;
      if (sourceId) {
        const lazyId = `lazy_${route.path}`;
        if (!nodeMap.has(lazyId)) {
          const filePath = route.sourceFilePath
            ? resolveLoadChildrenPath(route.loadChildren, route.sourceFilePath, projectRoot)
            : '';
          // Extract the exported name from the .then(m => m.ExportedName) expression.
          // If the name ends with 'Module' it is an NgModule; otherwise it is a plain
          // Routes array and the node should stay as a 'route' pivot.
          const moduleNameMatch = route.loadChildren.match(/\.then\(\s*\(?\w+\)?\s*=>\s*\w+\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/);
          const exportedName = moduleNameMatch ? moduleNameMatch[1] : null;
          const isNgModule = exportedName ? /module$/i.test(exportedName) : false;
          const nodeLabel = isNgModule ? exportedName! : route.path;
          const nodeType  = isNgModule ? 'module' : 'route';
          nodeMap.set(lazyId, {
            id: lazyId,
            label: nodeLabel,
            type: nodeType,
            filePath,
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
          guards: route.guards?.length ? route.guards : undefined,
        });
        // Recurse into injected children (routes from the lazy file)
        if (route.children?.length) {
          buildRouteEdges(route.children, lazyId, nodeMap, edges, components, projectRoot);
        }
      }
    } else if (route.children && targetId) {
      buildRouteEdges(route.children, targetId, nodeMap, edges, components, projectRoot);
    }
  }
}

/**
 * Resolves the absolute file path of a lazy-loaded module from the raw
 * loadChildren expression. Returns '' if the path cannot be determined.
 */
function resolveLoadChildrenAbsPath(loadChildren: string, sourceFilePath: string): string {
  const m = loadChildren.match(/import\(['"`]([^'"`]+)['"`]\)/);
  if (!m) return '';
  const importSpecifier = m[1];
  if (!importSpecifier.startsWith('.')) return '';
  const sourceDir = path.dirname(sourceFilePath);
  let resolved = path.resolve(sourceDir, importSpecifier);
  // path.extname returns '.routes' for 'admin.routes' — always ensure the .ts extension
  if (!resolved.endsWith('.ts') && !resolved.endsWith('.tsx')) resolved += '.ts';
  return resolved;
}

/**
 * For every lazy-loaded route whose loadChildren expression points to a
 * separate routes file, inject the routes from that file as children of the
 * lazy route, then remove those routes from the top-level list so they are
 * not also connected directly from AppComponent.
 */
function injectLazyChildRoutes(routes: RouteInfo[]): RouteInfo[] {
  // Build a map: normalised absolute file path → routes originating from that file
  const routesByFile = new Map<string, RouteInfo[]>();
  for (const route of routes) {
    if (!route.sourceFilePath) continue;
    const key = path.normalize(route.sourceFilePath).toLowerCase();
    if (!routesByFile.has(key)) routesByFile.set(key, []);
    routesByFile.get(key)!.push(route);
  }

  // Track which files we consumed so we can filter them from the top level
  const lazyFileKeys = new Set<string>();

  /**
   * Given the absolute path of a lazy-loaded MODULE file (e.g. catalog.module.ts),
   * find the routes that belong to it. Returns the matching key and routes, or null.
   *
   * Two strategies are tried in order:
   *   1. Exact match: routes were defined inline inside the module file itself.
   *   2. Same-directory fallback: routes live in a co-located file such as
   *      catalog.routes.ts or catalog-routing.module.ts. This handles the common
   *      Angular pattern where loadChildren points to the NgModule file but the
   *      actual Routes array is declared in a separate file in the same folder.
   */
  function findRoutesForModule(moduleAbsPath: string): { key: string; routes: RouteInfo[] } | null {
    const moduleKey = path.normalize(moduleAbsPath).toLowerCase();

    // 1. Exact match
    const direct = routesByFile.get(moduleKey);
    if (direct?.length) return { key: moduleKey, routes: direct };

    // 2. Same-directory fallback
    const moduleDir = path.normalize(path.dirname(moduleAbsPath)).toLowerCase();
    for (const [fileKey, fileRoutes] of routesByFile) {
      if (fileKey === moduleKey) continue;
      const fileDir = path.normalize(path.dirname(fileKey)).toLowerCase();
      if (fileDir === moduleDir && fileRoutes.length) {
        return { key: fileKey, routes: fileRoutes };
      }
    }

    return null;
  }

  function processRoute(route: RouteInfo): RouteInfo {
    // Discover children from the lazily loaded file (loadChildren only, not loadComponent)
    let extraChildren: RouteInfo[] = [];
    if (route.loadChildren && route.sourceFilePath && !route.componentName) {
      const absPath = resolveLoadChildrenAbsPath(route.loadChildren, route.sourceFilePath);
      if (absPath) {
        const found = findRoutesForModule(absPath);
        if (found) {
          lazyFileKeys.add(found.key);
          extraChildren = found.routes.map(r => processRoute(r));
        }
      }
    }
    // Recursively process existing children
    const processedChildren = route.children ? route.children.map(processRoute) : [];
    const allChildren = [...processedChildren, ...extraChildren];
    return allChildren.length > 0 ? { ...route, children: allChildren } : route;
  }

  const injected = routes.map(r => processRoute(r));

  // Remove top-level routes that were injected as lazy children
  return injected.filter(r => {
    if (!r.sourceFilePath) return true;
    const key = path.normalize(r.sourceFilePath).toLowerCase();
    return !lazyFileKeys.has(key);
  });
}

/**
 * Resolves the file path of a lazy-loaded module/component from the raw
 * loadChildren/loadComponent expression text.
 * e.g. `() => import('./features/home/home.component').then(m => m.HomeComponent)`
 *      → 'features/home/home.component.ts'
 */
function resolveLoadChildrenPath(
  loadChildren: string,
  sourceFilePath: string,
  projectRoot: string
): string {
  const m = loadChildren.match(/import\(['"\`]([^'"\`]+)['"\`]\)/);
  if (!m) return '';
  const importSpecifier = m[1];
  if (!importSpecifier.startsWith('.')) return importSpecifier; // bare module, can't resolve
  const sourceDir = path.dirname(sourceFilePath);
  let resolved = path.resolve(sourceDir, importSpecifier);
  if (!resolved.endsWith('.ts') && !resolved.endsWith('.tsx')) resolved += '.ts';
  return path.relative(projectRoot, resolved).replace(/\\/g, '/');
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

  // Component → service edges
  for (const comp of components) {
    if (!nodeMap.has(comp.id)) continue;
    for (const svcName of (comp.injectedServices ?? [])) {
      const targetId = serviceByName.get(svcName);
      if (!targetId || !nodeMap.has(targetId)) continue;
      edges.push({ id: edgeId(), source: comp.id, target: targetId, type: 'uses' });
    }
  }

  // Service → service edges
  for (const svc of services) {
    if (!nodeMap.has(svc.id)) continue;
    for (const depName of (svc.injectedServices ?? [])) {
      const targetId = serviceByName.get(depName);
      if (!targetId || !nodeMap.has(targetId)) continue;
      edges.push({ id: edgeId(), source: svc.id, target: targetId, type: 'uses' });
    }
  }
}

/**
 * Emit "uses" edges from any class (service or component) that dynamically
 * instantiates a component via patterns like `service.open(MyComponent)` or
 * `vcr.createComponent(MyComponent)`. Relies on component.dynamicCallers being
 * populated by detectDynamicComponentUsages().
 */
function buildDynamicUsageEdges(
  components: ComponentInfo[],
  services: ServiceInfo[],
  nodeMap: Map<string, GraphNode>,
  edges: GraphEdge[]
): void {
  // Build a name → id lookup for all possible callers (components + services)
  const callerIds = new Map<string, string>();
  for (const comp of components) callerIds.set(comp.name, comp.id);
  for (const svc of services) callerIds.set(svc.name, svc.id);

  for (const comp of components) {
    if (!comp.dynamicCallers?.length) continue;
    const targetId = comp.id;
    if (!nodeMap.has(targetId)) continue;

    for (const callerName of comp.dynamicCallers) {
      const sourceId = callerIds.get(callerName);
      if (!sourceId || sourceId === targetId || !nodeMap.has(sourceId)) continue;
      edges.push({ id: edgeId(), source: sourceId, target: targetId, type: 'uses' });
    }
  }
}

/**
 * DFS over the service dependency graph to detect cycles.
 * Every service node involved in a cycle gets hasCircularDep = true.
 * Edges are left as normal 'uses' so layout/lanes are unaffected.
 */
function markCircularServiceEdges(
  services: ServiceInfo[],
  edges: GraphEdge[],
  nodeMap: Map<string, GraphNode>
): void {
  const serviceIds = new Set(services.map(s => s.id));

  // Build adjacency list for service→service edges only
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!serviceIds.has(edge.source) || !serviceIds.has(edge.target)) continue;
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source)!.push(edge.target);
  }

  // Three-color DFS: WHITE=0 (unvisited), GRAY=1 (in stack), BLACK=2 (done)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of serviceIds) color.set(id, WHITE);

  // Track DFS stack to mark all nodes in a cycle, not just the back-edge endpoints
  const stack: string[] = [];

  function dfs(nodeId: string): void {
    color.set(nodeId, GRAY);
    stack.push(nodeId);
    for (const targetId of (adj.get(nodeId) ?? [])) {
      if (color.get(targetId) === GRAY) {
        // Back edge — mark every node from the cycle entry point to the current node
        const cycleStart = stack.indexOf(targetId);
        for (let i = cycleStart; i < stack.length; i++) {
          const n = nodeMap.get(stack[i]);
          if (n) n.hasCircularDep = true;
        }
        const targetNode = nodeMap.get(targetId);
        if (targetNode) targetNode.hasCircularDep = true;
      } else if (color.get(targetId) === WHITE) {
        dfs(targetId);
      }
    }
    stack.pop();
    color.set(nodeId, BLACK);
  }

  for (const id of serviceIds) {
    if (color.get(id) === WHITE) dfs(id);
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

// ─── Guard edges ─────────────────────────────────────────────────────────────

/**
 * For every route edge that carries guard names, emit a `guard` edge from the
 * target node (the protected component/route) to each referenced guard node.
 */
function buildGuardEdges(
  edges: GraphEdge[],
  nodeMap: Map<string, GraphNode>,
  guards: GuardInfo[]
): void {
  const guardByName = new Map(guards.map(g => [g.name, g.id]));
  // Snapshot the existing edges — we only look at route/lazy-load/child-route edges with guards
  const routeEdges = edges.filter(e => e.guards?.length);
  for (const edge of routeEdges) {
    const protectedId = edge.target;
    if (!nodeMap.has(protectedId)) continue;
    for (const guardName of edge.guards!) {
      const guardId = guardByName.get(guardName);
      if (!guardId || !nodeMap.has(guardId)) continue;
      edges.push({ id: edgeId(), source: protectedId, target: guardId, type: 'uses' });
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

  // ── Subtree-aware layout for flow nodes ─────────────────────────────────
  // Children are grouped vertically near their parent by allocating each
  // subtree a vertical slot proportional to its number of leaf nodes.
  if (flowNodes.length > 0) {
    const flowIds = new Set(flowNodes.map(n => n.id));
    const nodeById = new Map(nodes.map(n => [n.id, n]));

    // Build routing tree adjacency — routing edges only (no navigate, no uses)
    // so that navigate short-circuits don't distort the tree structure.
    const treeAdj = new Map<string, string[]>();
    flowNodes.forEach(n => treeAdj.set(n.id, []));
    edges.forEach(e => {
      if (!flowIds.has(e.source) || !flowIds.has(e.target)) return;
      if (e.type === 'navigate' || e.type === 'uses') return;
      const children = treeAdj.get(e.source)!;
      if (!children.includes(e.target)) children.push(e.target);
    });

    // BFS on the routing tree for depth → x column assignment
    const levels = new Map<string, number>();
    const root = flowNodes.find(n => n.type === 'root') ?? flowNodes[0];
    levels.set(root.id, 0);
    const bfsQueue: string[] = [root.id];
    let head = 0;
    while (head < bfsQueue.length) {
      const cur = bfsQueue[head++];
      const curLevel = levels.get(cur)!;
      for (const childId of (treeAdj.get(cur) ?? [])) {
        if (!levels.has(childId)) {
          levels.set(childId, curLevel + 1);
          bfsQueue.push(childId);
        }
      }
    }
    const bfsVisited = new Set(bfsQueue);
    const maxLevel = levels.size > 0 ? Math.max(...levels.values()) : 0;
    // Unreachable flow nodes (shouldn't happen in practice) get an extra column
    flowNodes.forEach(n => { if (!levels.has(n.id)) levels.set(n.id, maxLevel + 1); });

    // Assign x based on BFS depth
    flowNodes.forEach(n => { n.x = LEFT_PAD + levels.get(n.id)! * COL_W; });

    // Compute subtree leaf counts (memoised)
    const leafCache = new Map<string, number>();
    function countLeaves(id: string): number {
      if (leafCache.has(id)) return leafCache.get(id)!;
      const children = treeAdj.get(id) ?? [];
      const count = children.length === 0
        ? 1
        : children.reduce((s, c) => s + countLeaves(c), 0);
      leafCache.set(id, count);
      return count;
    }

    // DFS to assign y: each node is centred in a vertical slot sized by its
    // subtree's total leaf count, so siblings cluster around their parent.
    const totalLeaves = countLeaves(root.id);
    const flowZoneH = Math.max(CANVAS_H * 0.55, totalLeaves * ROW_H + 2 * ROW_H);
    const topY = NODE_H / 2 + ROW_H;

    function assignY(id: string, slotTop: number, slotBottom: number): void {
      const node = nodeById.get(id);
      if (!node) return;
      node.y = (slotTop + slotBottom) / 2;
      const children = treeAdj.get(id) ?? [];
      if (children.length === 0) return;
      const myLeaves = countLeaves(id);
      let cursor = slotTop;
      for (const childId of children) {
        const childSlotH = (countLeaves(childId) / myLeaves) * (slotBottom - slotTop);
        assignY(childId, cursor, cursor + childSlotH);
        cursor += childSlotH;
      }
    }

    assignY(root.id, topY, topY + flowZoneH - ROW_H);

    // Place any unreachable flow nodes in a spare column
    const unreachable = flowNodes.filter(n => !bfsVisited.has(n.id));
    unreachable.forEach((n, i) => {
      n.x = LEFT_PAD + (maxLevel + 1) * COL_W;
      n.y = topY + i * ROW_H;
    });
  }

  // ── Shared nodes: 4 separate vertical columns, one per type ─────────────
  if (sharedNodes.length > 0) {
    const sharedGroupOrder: NodeType[] = ['component', 'service', 'directive', 'pipe', 'guard'];

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
