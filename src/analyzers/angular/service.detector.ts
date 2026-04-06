import {
  Project,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
  NewExpression,
} from 'ts-morph';
import * as path from 'path';
import { ServiceInfo } from '../../types';

let _idCounter = 0;
function nextId(): string {
  return `svc_${++_idCounter}`;
}

/**
 * Scans all source files for classes decorated with @Injectable and returns
 * a list of ServiceInfo objects.
 */
export function detectServices(project: Project, projectRoot: string): ServiceInfo[] {
  const GUARD_INTERFACES = new Set([
    'CanActivate',
    'CanActivateChild',
    'CanDeactivate',
    'CanMatch',
    'CanLoad',
    'CanActivateFn', 
    'CanActivateChildFn', 
    'CanDeactivateFn', 
    'CanMatchFn', 
    'CanLoadFn'
  ]);

  const services: ServiceInfo[] = [];

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    for (const cls of file.getClasses()) {
      const decorator = cls.getDecorator('Injectable');
      if (!decorator) continue;

      // Skip classes that are guards — they're handled separately
      const implementedInterfaces = cls.getImplements().map(i => i.getExpression().getText().replace(/<.*>$/, '').trim());
      if (implementedInterfaces.some(i => GUARD_INTERFACES.has(i))) continue;

      const filePath = path.relative(projectRoot, file.getFilePath()).replace(/\\/g, '/');

      let providedIn: string | undefined;
      const args = decorator.getArguments();
      if (args.length && Node.isObjectLiteralExpression(args[0])) {
        const meta = args[0] as ObjectLiteralExpression;
        const prop = meta.getProperty('providedIn');
        if (prop && Node.isPropertyAssignment(prop)) {
          const init = (prop as PropertyAssignment).getInitializer();
          if (init) providedIn = init.getText().replace(/^['"`]|['"`]$/g, '');
        }
      }

      services.push({
        id: nextId(),
        name: cls.getName() ?? 'UnknownService',
        filePath,
        providedIn,
      });
    }
  }

  return services;
}

/**
 * Post-processing: for each component, detect which services it injects via
 * inject(ServiceClass) calls or constructor parameters typed as a known service.
 * Populates component.injectedServices in place.
 */
export function detectServiceUsages(
  project: Project,
  components: import('../../types').ComponentInfo[],
  services: ServiceInfo[]
): void {
  const serviceNames = new Set(services.map(s => s.name));

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    for (const cls of file.getClasses()) {
      const comp = components.find(c => c.name === cls.getName());
      if (!comp) continue;

      const injected = new Set<string>();

      // inject(ServiceClass) calls anywhere in the class
      cls.forEachDescendant(node => {
        if (!Node.isCallExpression(node)) return;
        const exprText = node.getExpression().getText();
        if (exprText === 'inject') {
          const args = node.getArguments();
          if (args.length) {
            const name = args[0].getText().trim();
            if (serviceNames.has(name)) injected.add(name);
          }
        }
      });

      // Constructor parameter types
      for (const ctor of cls.getConstructors()) {
        for (const param of ctor.getParameters()) {
          // Text-based match on the type annotation (reliable without full type resolution)
          const typeText = (param.getTypeNode()?.getText() ?? '').trim();
          if (serviceNames.has(typeText)) injected.add(typeText);
        }
      }

      comp.injectedServices = [...injected];
    }
  }
}

/**
 * Post-processing: scan all class bodies for call expressions whose first argument
 * is a component class reference (e.g. `this.dialog.open(MyDialogComponent, ...)` or
 * `this.vcr.createComponent(DynamicComponent)`). Populates component.dynamicCallers
 * in place so the graph can emit "uses" edges from the caller to the component.
 *
 * Only method names commonly associated with dynamic instantiation are matched to
 * reduce false positives from unrelated calls like console.log(SomeComponent).
 */
export function detectDynamicComponentUsages(
  project: Project,
  components: import('../../types').ComponentInfo[]
): void {
  const DYNAMIC_METHODS = new Set([
    'open', 'create', 'createComponent', 'show', 'present',
    'launch', 'render', 'display', 'push', 'attach', 'load',
  ]);

  /** CDK / common portal wrapper constructors whose first arg is the component class. */
  const PORTAL_CTORS = new Set([
    'ComponentPortal', 'TemplatePortal', 'DomPortal',
  ]);

  /**
   * Given a call/new-expression argument, returns the component class name if:
   *  - the argument is a direct identifier: `MyComponent`
   *  - the argument is a portal new-expression: `new ComponentPortal(MyComponent, ...)`
   */
  function resolveComponentArg(arg: Node): string | undefined {
    if (Node.isIdentifier(arg)) return arg.getText();
    if (Node.isNewExpression(arg)) {
      const ctorName = (arg as NewExpression).getExpression().getText();
      if (PORTAL_CTORS.has(ctorName)) {
        const innerArgs = (arg as NewExpression).getArguments();
        if (innerArgs.length && Node.isIdentifier(innerArgs[0])) {
          return innerArgs[0].getText();
        }
      }
    }
    return undefined;
  }

  const componentByName = new Map(components.map(c => [c.name, c]));

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    for (const cls of file.getClasses()) {
      const callerName = cls.getName();
      if (!callerName) continue;

      cls.forEachDescendant(node => {
        // ── Pattern 1: someMethod(ComponentClass) ────────────────────────────
        // e.g. this.modalSvc.open(MyComponent, opts)
        if (Node.isCallExpression(node)) {
          const args = node.getArguments();
          if (!args.length) return;

          const expr = node.getExpression();
          let methodName: string;
          if (Node.isPropertyAccessExpression(expr)) {
            methodName = expr.getName();
          } else if (Node.isIdentifier(expr)) {
            methodName = expr.getText();
          } else {
            return;
          }
          if (!DYNAMIC_METHODS.has(methodName)) return;

          // Resolve the component name from either a direct identifier or a
          // portal wrapper: new ComponentPortal(X) / new TemplatePortal(X)
          const compName = resolveComponentArg(args[0]);
          if (!compName || compName === callerName) return;
          const comp = componentByName.get(compName);
          if (!comp) return;

          if (!comp.dynamicCallers) comp.dynamicCallers = [];
          if (!comp.dynamicCallers.includes(callerName)) {
            comp.dynamicCallers.push(callerName);
          }
          return;
        }

        // ── Pattern 2: new ComponentPortal(ComponentClass) ───────────────────
        // Catches portal creation even when assigned to a variable before attach.
        // e.g. const portal = new ComponentPortal(MyComponent);
        if (Node.isNewExpression(node)) {
          const ctorName = (node as NewExpression).getExpression().getText();
          if (!PORTAL_CTORS.has(ctorName)) return;
          const portalArgs = (node as NewExpression).getArguments();
          if (!portalArgs.length) return;
          const compName = resolveComponentArg(portalArgs[0]);
          if (!compName || compName === callerName) return;
          const comp = componentByName.get(compName);
          if (!comp) return;

          if (!comp.dynamicCallers) comp.dynamicCallers = [];
          if (!comp.dynamicCallers.includes(callerName)) {
            comp.dynamicCallers.push(callerName);
          }
        }
      });
    }
  }
}

/**
 * Post-processing: for each service, detect which other services it injects via
 * inject(ServiceClass) calls or constructor parameters typed as a known service.
 * Populates service.injectedServices in place.
 */
export function detectServiceToServiceUsages(
  project: Project,
  services: ServiceInfo[]
): void {
  const serviceNames = new Set(services.map(s => s.name));

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    for (const cls of file.getClasses()) {
      const svc = services.find(s => s.name === cls.getName());
      if (!svc) continue;

      const injected = new Set<string>();

      // inject(OtherService) calls anywhere in the class body
      cls.forEachDescendant(node => {
        if (!Node.isCallExpression(node)) return;
        const exprText = node.getExpression().getText();
        if (exprText === 'inject') {
          const args = node.getArguments();
          if (args.length) {
            const name = args[0].getText().trim();
            if (serviceNames.has(name) && name !== cls.getName()) injected.add(name);
          }
        }
      });

      // Constructor parameter types
      for (const ctor of cls.getConstructors()) {
        for (const param of ctor.getParameters()) {
          const typeText = (param.getTypeNode()?.getText() ?? '').trim();
          if (serviceNames.has(typeText) && typeText !== cls.getName()) injected.add(typeText);
        }
      }

      svc.injectedServices = [...injected];
    }
  }
}
