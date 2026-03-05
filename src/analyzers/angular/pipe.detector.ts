import {
  Project,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
} from 'ts-morph';
import * as path from 'path';
import { PipeInfo } from '../../types';

let _idCounter = 0;
function nextId(): string {
  return `pipe_${++_idCounter}`;
}

/**
 * Scans all source files for classes decorated with @Pipe and returns a list
 * of PipeInfo objects.
 */
export function detectPipes(project: Project, projectRoot: string): PipeInfo[] {
  const pipes: PipeInfo[] = [];

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    for (const cls of file.getClasses()) {
      const decorator = cls.getDecorator('Pipe');
      if (!decorator) continue;

      const args = decorator.getArguments();
      if (!args.length || !Node.isObjectLiteralExpression(args[0])) continue;

      const meta = args[0] as ObjectLiteralExpression;
      const nameProp = meta.getProperty('name');
      if (!nameProp || !Node.isPropertyAssignment(nameProp)) continue;

      const init = (nameProp as PropertyAssignment).getInitializer();
      if (!init) continue;

      const pipeName = init.getText().replace(/^['"`]|['"`]$/g, '');
      const filePath = path.relative(projectRoot, file.getFilePath()).replace(/\\/g, '/');

      pipes.push({
        id: nextId(),
        name: cls.getName() ?? 'UnknownPipe',
        pipeName,
        filePath,
      });
    }
  }

  return pipes;
}
