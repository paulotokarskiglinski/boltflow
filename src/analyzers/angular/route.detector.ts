import {
  Project,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
  ArrayLiteralExpression,
  SourceFile,
  CallExpression,
} from 'ts-morph';
import { RouteInfo } from '../../types';

/**
 * Scans all source files for Angular route definitions and returns a flat list
 * of top-level RouteInfo trees.
 *
 * Handles the most common patterns:
 *   • const routes: Routes = [...]
 *   • RouterModule.forRoot([...]) / RouterModule.forChild([...])
 *   • provideRouter([...])  (standalone apps)
 */
export function detectRoutes(project: Project): RouteInfo[] {
  const allRoutes: RouteInfo[] = [];

  for (const file of project.getSourceFiles().filter(f => {
    const p = f.getFilePath();
    return !p.includes('node_modules') && !/\.(spec|test)\.ts$/.test(p);
  })) {

    // 1. Variables typed as Routes or having 'routes' in their name
    for (const varDecl of file.getVariableDeclarations()) {
      const name = varDecl.getName().toLowerCase();
      const typeText = varDecl.getType().getText().toLowerCase();
      if (
        typeText.includes('route[]') ||
        typeText.includes('routes') ||
        name === 'routes' ||
        name.endsWith('routes')
      ) {
        const init = varDecl.getInitializer();
        if (init && Node.isArrayLiteralExpression(init)) {
          const routes = extractRoutesFromArray(init as ArrayLiteralExpression, file.getFilePath());
          allRoutes.push(...routes);
        }
      }
    }

    // 2. RouterModule.forRoot([...]) / RouterModule.forChild([...])
    const routerModuleCalls = findCallExpressions(
      file,
      expr =>
        expr.getExpression().getText() === 'RouterModule.forRoot' ||
        expr.getExpression().getText() === 'RouterModule.forChild'
    );
    for (const call of routerModuleCalls) {
      const args = call.getArguments();
      if (args.length && Node.isArrayLiteralExpression(args[0])) {
        const routes = extractRoutesFromArray(args[0] as ArrayLiteralExpression, file.getFilePath());
        allRoutes.push(...routes);
      }
    }

    // 3. provideRouter([...])
    const provideRouterCalls = findCallExpressions(
      file,
      expr => expr.getExpression().getText() === 'provideRouter'
    );
    for (const call of provideRouterCalls) {
      const args = call.getArguments();
      if (args.length && Node.isArrayLiteralExpression(args[0])) {
        const routes = extractRoutesFromArray(args[0] as ArrayLiteralExpression, file.getFilePath());
        allRoutes.push(...routes);
      }
    }
  }

  return deduplicateRoutes(allRoutes);
}

// ─── Route extraction from AST ───────────────────────────────────────────────

function extractRoutesFromArray(arr: ArrayLiteralExpression, sourceFilePath: string): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const element of arr.getElements()) {
    if (!Node.isObjectLiteralExpression(element)) continue;
    const route = extractRouteFromObject(element as ObjectLiteralExpression, sourceFilePath);
    if (route) routes.push(route);
  }

  return routes;
}

function extractRouteFromObject(obj: ObjectLiteralExpression, sourceFilePath: string): RouteInfo | null {
  const pathValue = getStringProp(obj, 'path');
  // A route must at least have a path (even if it's an empty string)
  if (pathValue === undefined) return null;

  const route: RouteInfo = { path: pathValue };

  // component
  const componentProp = obj.getProperty('component');
  if (componentProp && Node.isPropertyAssignment(componentProp)) {
    const init = (componentProp as PropertyAssignment).getInitializer();
    if (init) route.componentName = init.getText().trim();
  }

  // redirectTo
  const redirectTo = getStringProp(obj, 'redirectTo');
  if (redirectTo !== undefined) route.redirectTo = redirectTo;

  // title
  const title = getStringProp(obj, 'title');
  if (title !== undefined) route.title = title;

  // loadChildren / loadComponent
  const loadChildrenProp = obj.getProperty('loadChildren');
  if (loadChildrenProp && Node.isPropertyAssignment(loadChildrenProp)) {
    const loadChildrenText = (loadChildrenProp as PropertyAssignment)
      .getInitializer()?.getText().trim() ?? '';
    // () => DirectIdentifier — static reference to a component used as a lazy route
    const directRef = loadChildrenText.match(/^\(\)\s*=>\s*([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (directRef) route.componentName = directRef[1];
    route.loadChildren = loadChildrenText;
  }

  const loadComponentProp = obj.getProperty('loadComponent');
  if (loadComponentProp && Node.isPropertyAssignment(loadComponentProp)) {
    const loadCompText = (loadComponentProp as PropertyAssignment)
      .getInitializer()?.getText().trim() ?? '';
    // () => DirectComponent — static reference, lazily loaded
    const directRef = loadCompText.match(/^\(\)\s*=>\s*([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (directRef) {
      route.componentName = directRef[1];
    } else {
      // () => import('...').then(m => m.ComponentName) — lazily loaded via dynamic import
      // Handles both single-line `.then(m => m.Foo)` and multi-line `.then(\n  (m) => m.Foo\n)`
      const thenRef = loadCompText.match(/\.then\(\s*\(?\w+\)?\s*=>\s*\w+\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/);
      if (thenRef) route.componentName = thenRef[1];
    }
    // Always mark as lazy (loadComponent is always deferred by Angular)
    route.loadChildren = loadCompText;
  }

  route.sourceFilePath = sourceFilePath;

  // Guards: canActivate, canActivateChild, canDeactivate, canMatch, canLoad,'canActivateFn', 'canActivateChildFn', 'canDeactivateFn', 'canMatchFn', 'canLoadFn'
  const guardKeys = [
    'canActivate',
    'canActivateChild',
    'canDeactivate',
    'canMatch',
    'canLoad',
    'canActivateFn', 
    'canActivateChildFn', 
    'canDeactivateFn', 
    'canMatchFn', 
    'canLoadFn'
  ];

  const allGuards: string[] = [];

  for (const guardKey of guardKeys) {
    const guardPropNode = obj.getProperty(guardKey);
    if (!guardPropNode || !Node.isPropertyAssignment(guardPropNode)) continue;
    const guardInit = (guardPropNode as PropertyAssignment).getInitializer();
    if (!guardInit || !Node.isArrayLiteralExpression(guardInit)) continue;
    for (const el of (guardInit as ArrayLiteralExpression).getElements()) {
      const name = el.getText().trim();
      // Accept only simple identifiers (class names or function references)
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !allGuards.includes(name)) {
        allGuards.push(name);
      }
    }
  }
  if (allGuards.length) route.guards = allGuards;

  // children
  const childrenProp = obj.getProperty('children');
  if (childrenProp && Node.isPropertyAssignment(childrenProp)) {
    const init = (childrenProp as PropertyAssignment).getInitializer();
    if (init && Node.isArrayLiteralExpression(init)) {
      route.children = extractRoutesFromArray(init as ArrayLiteralExpression, sourceFilePath);
    }
  }

  return route;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function getStringProp(obj: ObjectLiteralExpression, key: string): string | undefined {
  const prop = obj.getProperty(key);
  if (!prop || !Node.isPropertyAssignment(prop)) return undefined;
  const init = (prop as PropertyAssignment).getInitializer();
  if (!init) return undefined;
  return init.getText().replace(/^['"`]|['"`]$/g, '');
}

/** Walk *all* nodes in a source file and collect call expressions matching predicate */
function findCallExpressions(
  file: SourceFile,
  predicate: (expr: CallExpression) => boolean
): CallExpression[] {
  const results: CallExpression[] = [];
  file.forEachDescendant(node => {
    if (Node.isCallExpression(node) && predicate(node as CallExpression)) {
      results.push(node as CallExpression);
    }
  });
  return results;
}

/**
 * Deduplicate routes that appear in multiple modules (e.g., forRoot and the
 * variable declaration in the same file are both detected).
 */
function deduplicateRoutes(routes: RouteInfo[]): RouteInfo[] {
  const seen = new Set<string>();
  return routes.filter(r => {
    const key = routeKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function routeKey(route: RouteInfo): string {
  return `${route.path}|${route.componentName ?? ''}`;
}
