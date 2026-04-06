import { Project, Node } from 'ts-morph';
import * as path from 'path';
import { GuardInfo } from '../../types';

let _idCounter = 0;
function nextId(): string {
  return `guard_${++_idCounter}`;
}

/**
 * Scans all source files for classes that implement any of Angular's route
 * guard interfaces: CanActivate, CanActivateChild, CanDeactivate, CanMatch,
 * CanLoad, 'CanActivateFn', 'CanActivateChildFn', 'CanDeactivateFn', 'CanMatchFn', 'CanLoadFn'. 
 * Detection is based on the `implements` clause — not file name or
 * class name convention.
 */
export function detectGuards(project: Project, projectRoot: string): GuardInfo[] {
  const GUARD_INTERFACES = new Set([
    'CanActivate',
    'CanActivateChild',
    'CanDeactivate',
    'CanMatch',
    'CanLoad'
  ]);

  const FUNCTIONAL_GUARD_TYPES = new Set([
    'CanActivateFn',
    'CanActivateChildFn',
    'CanDeactivateFn',
    'CanMatchFn',
    'CanLoadFn'
  ]);

  const guards: GuardInfo[] = [];

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    for (const cls of file.getClasses()) {
      const implementedInterfaces = cls
        .getImplements()
        .map(impl => impl.getExpression().getText().trim());

      const matchedInterfaces = implementedInterfaces.filter(i =>
        GUARD_INTERFACES.has(i.replace(/<.*>$/, '')) // strip generic params e.g. CanDeactivate<T>
      );

      if (matchedInterfaces.length === 0) continue;

      const filePath = path.relative(projectRoot, file.getFilePath()).replace(/\\/g, '/');

      guards.push({
        id: nextId(),
        name: cls.getName() ?? filePath,
        filePath,
        interfaces: matchedInterfaces,
      });
    }

    // Functional guards
    for (const varDecl of file.getVariableDeclarations()) {
      const typeNode = varDecl.getTypeNode();
      if (!typeNode) continue;

      const typeText = typeNode.getText().trim();
      const baseType = typeText.replace(/<.*>$/, '');
      if (!FUNCTIONAL_GUARD_TYPES.has(baseType)) continue;

      const filePath = path.relative(projectRoot, file.getFilePath()).replace(/\\/g, '/');

      guards.push({
        id: nextId(),
        name: varDecl.getName(),
        filePath,
        interfaces: [baseType],
      });
    }
  }

  return guards;
}
