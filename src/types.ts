export type Framework = 'angular' | 'react' | 'vue';

export interface InputInfo {
  name: string;
  type?: string;
  required?: boolean;
}

export interface OutputInfo {
  name: string;
  type?: string;
}

export interface ComponentInfo {
  id: string;
  /** Class name, e.g. "HomeComponent" */
  name: string;
  /** HTML selector, e.g. "app-home" */
  selector: string;
  /** Relative path to the .ts file */
  filePath: string;
  /** Relative path to the .html template file, if external */
  templatePath?: string;
  isStandalone: boolean;
  inputs: InputInfo[];
  outputs: OutputInfo[];
  /** Selectors of components found used in this component's template */
  usedComponents: string[];
  /** routerLink values found in this component's template */
  routerLinks: string[];
  /** href values of internal <a> tags found in the template */
  hrefs: string[];
  /** Route paths from router.navigate() / router.navigateByUrl() calls in the class */
  navigateCalls: string[];
  /** Class names of @Injectable services injected via inject() or constructor */
  injectedServices: string[];
  /** Full selectors of @Directive directives used in this component's template */
  usedDirectives: string[];
  /** Pipe names (@Pipe({ name }) used in this component's template */
  usedPipes: string[];
  /** Angular lifecycle hook interfaces implemented by this component */
  lifecycleHooks?: string[];
}

export interface RouteInfo {
  path: string;
  /** Angular component class name (resolved from the route config) */
  componentName?: string;
  /** Reference to a ComponentInfo id after cross-referencing */
  componentId?: string;
  children?: RouteInfo[];
  /** Raw loadChildren / loadComponent expression text */
  loadChildren?: string;
  /** Absolute path of the source file where this route was defined (used to resolve relative imports) */
  sourceFilePath?: string;
  redirectTo?: string;
  title?: string;
  /** Guard class/function names protecting this route (canActivate, canDeactivate, canMatch, etc.) */
  guards?: string[];
}

export interface ModuleInfo {
  id: string;
  name: string;
  filePath: string;
  declarations: string[];
  imports: string[];
  exports: string[];
  routes: RouteInfo[];
}

export interface ServiceInfo {
  id: string;
  name: string;
  filePath: string;
  providedIn?: string;
  /** Names of other services this service injects (service-to-service dependencies). */
  injectedServices?: string[];
}

export interface DirectiveInfo {
  id: string;
  name: string;
  selector: string;
  filePath: string;
}

export interface PipeInfo {
  id: string;
  name: string;
  pipeName: string;
  filePath: string;
}

export interface GuardInfo {
  id: string;
  name: string;
  filePath: string;
  /** Guard interfaces this class implements, e.g. ['CanActivate', 'CanDeactivate<T>'] */
  interfaces: string[];
}

export interface AnalysisResult {
  framework: Framework;
  projectRoot: string;
  components: ComponentInfo[];
  routes: RouteInfo[];
  modules: ModuleInfo[];
  services: ServiceInfo[];
  directives: DirectiveInfo[];
  pipes: PipeInfo[];
  guards: GuardInfo[];
}

// ─── Graph model ─────────────────────────────────────────────────────────────

export type NodeType = 'root' | 'component' | 'module' | 'lazy-module' | 'route' | 'service' | 'directive' | 'pipe' | 'guard';


export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  filePath: string;
  selector?: string;
  route?: string;
  inputs?: InputInfo[];
  outputs?: OutputInfo[];
  isStandalone?: boolean;
  /** Angular lifecycle hooks implemented (e.g. OnInit, OnDestroy) */
  lifecycleHooks?: string[];
  /** Layout lane: 'flow' = routed hierarchy, 'shared' = reusable components */
  lane?: 'flow' | 'shared';
  /** Pre-computed layout position (pixels) */
  x: number;
  y: number;
  /** True when this service node is part of a circular dependency cycle. */
  hasCircularDep?: boolean;
}

export type EdgeType = 'uses' | 'route' | 'child-route' | 'lazy-load' | 'navigate';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  /** Guard names on the route edge (populated from RouteInfo.guards) */
  guards?: string[];
}

export interface FlowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    framework: Framework;
    projectName: string;
    generatedAt: string;
    projectRoot: string;
    totalComponents?: number;
    totalRoutes?: number;
    totalSharedComponents?: number;
    totalSharedServices?: number;
    totalSharedDirectives?: number;
    totalSharedPipes?: number;
  };
}

// ─── CLI / API options ────────────────────────────────────────────────────────

export interface BoltflowOptions {
  /** Absolute path to the project root */
  projectPath: string;
  /** Absolute path to tsconfig.json (defaults to <projectPath>/tsconfig.json) */
  tsConfigPath?: string;
  /** Absolute path for the output file (without extension) */
  output?: string;
  /** Output format */
  format?: 'html' | 'json' | 'both';
  /** Open the HTML output in the browser after generation */
  open?: boolean;
}

export interface BoltflowResult {
  outputPath: string;
  totalComponents?: number;
  totalSharedComponents?: number;
  totalServices?: number;
  totalDirectives?: number;
  totalPipes?: number;
  totalRoutes?: number;
  graph: FlowGraph;
}
