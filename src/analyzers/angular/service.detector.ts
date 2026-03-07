import {
  Project,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
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
  const services: ServiceInfo[] = [];

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    for (const cls of file.getClasses()) {
      const decorator = cls.getDecorator('Injectable');
      if (!decorator) continue;

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
