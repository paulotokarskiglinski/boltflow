import * as fs from 'fs';
import * as path from 'path';
import {
  Project,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
} from 'ts-morph';
import { IAnalyzer } from '../base.analyzer';
import { AnalysisResult, BoltflowOptions, ComponentInfo } from '../../types';
import { detectComponents } from './component.detector';
import { detectRoutes } from './route.detector';
import { analyzeTemplate } from './template.analyzer';
import { detectServices, detectServiceUsages, detectServiceToServiceUsages, detectDynamicComponentUsages } from './service.detector';
import { detectDirectives } from './directive.detector';
import { detectPipes } from './pipe.detector';
import { detectGuards } from './guard.detector';

export class AngularAnalyzer implements IAnalyzer {
  async detect(projectPath: string): Promise<boolean> {
    const pkgPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      const deps = {
        ...((pkg.dependencies as Record<string, unknown>) ?? {}),
        ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
      };
      return '@angular/core' in deps;
    } catch {
      return false;
    }
  }

  async analyze(
    options: BoltflowOptions,
    progress: (msg: string) => void
  ): Promise<AnalysisResult> {
    const { projectPath, tsConfigPath } = options;

    progress('Loading TypeScript project…');

    const project = buildProject(projectPath, tsConfigPath);

    const angularMajor = resolveAngularMajorVersion(projectPath);
    const defaultStandalone = angularMajor >= 19;

    progress('Detecting components…');
    const components = detectComponents(project, projectPath, defaultStandalone);

    progress('Detecting routes…');
    const routes = detectRoutes(project);

    progress('Detecting services…');
    const services = detectServices(project, projectPath);

    progress('Detecting directives…');
    const directives = detectDirectives(project, projectPath);

    progress('Detecting pipes…');
    const pipes = detectPipes(project, projectPath);

    progress('Detecting guards…');
    const guards = detectGuards(project, projectPath);

    progress('Collecting inline templates…');
    const inlineTemplates = collectInlineTemplates(project, components);

    progress('Analyzing templates…');
    const selectorSet = new Set(components.map(c => c.selector.toLowerCase()));

    // Build directive attribute map: lowercased attr name → full selector
    // Handles attribute selectors like [appHighlight] → attr "apphighlight"
    const directiveAttrMap = new Map<string, string>();
    for (const dir of directives) {
      const m = dir.selector.match(/^\[([^\]]+)\]$/);
      if (m) directiveAttrMap.set(m[1].toLowerCase(), dir.selector);
    }

    // Build pipe names set
    const pipeNamesSet = new Set(pipes.map(p => p.pipeName));

    for (const component of components) {
      analyzeTemplate(component, projectPath, selectorSet, inlineTemplates, directiveAttrMap, pipeNamesSet);
    }

    // Populate injectedServices on each component
    detectServiceUsages(project, components, services);

    // Populate injectedServices on each service (service-to-service dependencies)
    detectServiceToServiceUsages(project, services);

    // Detect components that are dynamically instantiated via service calls
    detectDynamicComponentUsages(project, components);

    progress('Cross-referencing routes with components…');
    crossReferenceRoutes(routes, components);

    return {
      framework: 'angular',
      projectRoot: projectPath,
      components,
      routes,
      modules: [],
      services,
      directives,
      pipes,
      guards,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildProject(projectPath: string, tsConfigPath?: string): Project {
  // Build a priority-ordered list of tsconfig candidates.
  // tsconfig.app.json is preferred because root tsconfig.json often has
  // "files": [] with project-references (which would yield 0 source files).
  const seen = new Set<string>();
  const candidates: string[] = [];

  const addCandidate = (p: string) => {
    const abs = path.resolve(p);
    if (!seen.has(abs) && fs.existsSync(abs)) {
      seen.add(abs);
      candidates.push(abs);
    }
  };

  addCandidate(path.join(projectPath, 'tsconfig.app.json'));
  if (tsConfigPath) addCandidate(tsConfigPath);
  const discovered = findTsConfig(projectPath);
  if (discovered) addCandidate(discovered);

  for (const tsconfig of candidates) {
    try {
      const project = new Project({
        tsConfigFilePath: tsconfig,
        skipAddingFilesFromTsConfig: false,
        compilerOptions: { skipLibCheck: true },
      });

      const appFiles = project
        .getSourceFiles()
        .filter(f => !f.getFilePath().includes('node_modules'));

      if (appFiles.length > 0) return project;
    } catch {
      // try next candidate
    }
  }

  // Last resort: glob all .ts files manually
  return scanFilesManually(projectPath);
}

function scanFilesManually(projectPath: string): Project {
  const project = new Project({
    compilerOptions: { allowJs: false, skipLibCheck: true },
  });

  const glob = require('fast-glob') as typeof import('fast-glob');
  const files = glob.sync('**/*.ts', {
    cwd: projectPath,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/*.spec.ts', '**/*.test.ts'],
  });
  project.addSourceFilesAtPaths(files);
  return project;
}

function findTsConfig(projectPath: string): string | undefined {
  const candidates = [
    'tsconfig.app.json',
    'tsconfig.json',
    'tsconfig.base.json',
  ];
  for (const c of candidates) {
    const p = path.join(projectPath, c);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Reads inline `template: \`...\`` strings from @Component decorators and
 * stores them keyed by component id.
 */
function collectInlineTemplates(
  project: Project,
  components: ComponentInfo[]
): Map<string, string> {
  const map = new Map<string, string>();

  // Build lookup: filePath → component
  const byFile = new Map<string, ComponentInfo>();
  for (const c of components) {
    byFile.set(c.filePath.replace(/\\/g, '/'), c);
  }

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    for (const cls of file.getClasses()) {
      const decorator = cls.getDecorator('Component');
      if (!decorator) continue;
      const args = decorator.getArguments();
      if (!args.length || !Node.isObjectLiteralExpression(args[0])) continue;
      const meta = args[0] as ObjectLiteralExpression;

      const templateProp = meta.getProperty('template');
      if (!templateProp || !Node.isPropertyAssignment(templateProp)) continue;

      const init = (templateProp as PropertyAssignment).getInitializer();
      if (!init) continue;

      const rawText = init.getText();
      // Strip surrounding backticks / quotes
      const content = rawText.replace(/^[`'"]|[`'"]$/g, '');

      // Match to component by class name
      const className = cls.getName();
      if (!className) continue;

      const component = components.find(c => c.name === className);
      if (component && content.includes('<')) {
        map.set(component.id, content);
      }
    }
  }

  return map;
}

/**
 * Assigns component IDs to routes by matching the route's componentName
 * against detected components (by class name).
 */
/**
 * Reads the Angular major version from the project's node_modules.
 * Falls back to 0 if it cannot be determined.
 */
function resolveAngularMajorVersion(projectPath: string): number {
  try {
    const corePkg = path.join(projectPath, 'node_modules', '@angular', 'core', 'package.json');
    if (!fs.existsSync(corePkg)) return 0;
    const pkg = JSON.parse(fs.readFileSync(corePkg, 'utf-8')) as { version?: string };
    const major = parseInt((pkg.version ?? '0').split('.')[0], 10);
    return isNaN(major) ? 0 : major;
  } catch {
    return 0;
  }
}

function crossReferenceRoutes(
  routes: Array<import('../../types').RouteInfo>,
  components: ComponentInfo[]
): void {
  const byName = new Map(components.map(c => [c.name, c]));

  function walk(route: import('../../types').RouteInfo): void {
    if (route.componentName) {
      const comp = byName.get(route.componentName);
      if (comp) route.componentId = comp.id;
    }
    for (const child of route.children ?? []) {
      walk(child);
    }
  }

  for (const route of routes) walk(route);
}
