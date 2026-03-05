import {
  Project,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
} from 'ts-morph';
import * as path from 'path';
import { DirectiveInfo } from '../../types';

let _idCounter = 0;
function nextId(): string {
  return `dir_${++_idCounter}`;
}

/**
 * Scans all source files for classes decorated with @Directive (but NOT
 * @Component, since Angular components have both) and returns a list of
 * DirectiveInfo objects.
 */
export function detectDirectives(project: Project, projectRoot: string): DirectiveInfo[] {
  const directives: DirectiveInfo[] = [];

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    for (const cls of file.getClasses()) {
      // Skip @Component classes — they also technically have @Directive semantics
      if (cls.getDecorator('Component')) continue;

      const decorator = cls.getDecorator('Directive');
      if (!decorator) continue;

      const args = decorator.getArguments();
      if (!args.length || !Node.isObjectLiteralExpression(args[0])) continue;

      const meta = args[0] as ObjectLiteralExpression;
      const selectorProp = meta.getProperty('selector');
      if (!selectorProp || !Node.isPropertyAssignment(selectorProp)) continue;

      const init = (selectorProp as PropertyAssignment).getInitializer();
      if (!init) continue;

      const selector = init.getText().replace(/^['"`]|['"`]$/g, '');
      const filePath = path.relative(projectRoot, file.getFilePath()).replace(/\\/g, '/');

      directives.push({
        id: nextId(),
        name: cls.getName() ?? 'UnknownDirective',
        selector,
        filePath,
      });
    }
  }

  return directives;
}
