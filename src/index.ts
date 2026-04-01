import * as path from 'path';
import * as fs from 'fs';
import { getAnalyzer } from './analyzers/framework-registry';
import { buildGraph } from './graph/graph.builder';
import { generateHtml } from './output/html.generator';
import { generateJson } from './output/json.generator';
import { generateMd } from './output/md.generator';
import { BoltflowOptions, BoltflowResult } from './types';

export async function analyze(
  options: BoltflowOptions,
  progress: (msg: string) => void = () => undefined
): Promise<BoltflowResult> {
  const {
    projectPath,
    output = path.join(process.cwd(), 'boltflow-output'),
    format = 'html',
  } = options;

  // Resolve the project name from package.json if available
  const projectName = resolveProjectName(projectPath);

  progress('Detecting framework…');
  const analyzer = await getAnalyzer(projectPath);

  progress('Analyzing project…');
  const analysisResult = await analyzer.analyze(options, progress);

  progress('Building graph…');
  const graph = buildGraph(analysisResult, projectName);

  progress('Writing output…');
  let outputPath: string;
  let mdPath: string | undefined;

  if (format === 'html' || format === 'both' || format === 'all') {
    const htmlPath = ensureExtension(output, '.html');
    ensureDir(htmlPath);
    generateHtml(graph, htmlPath);
    outputPath = htmlPath;
  }

  if (format === 'json' || format === 'both' || format === 'all') {
    const jsonPath = ensureExtension(output, '.json');
    ensureDir(jsonPath);
    generateJson(graph, jsonPath);
    outputPath = jsonPath;
  }

  if (format === 'md' || format === 'all') {
    const mdFilePath = ensureExtension(output, '.md');
    ensureDir(mdFilePath);
    generateMd(graph, mdFilePath);
    mdPath = mdFilePath;
    outputPath = mdFilePath;
  }

  // Default primary outputPath
  if (format === 'both') {
    outputPath = ensureExtension(output, '.html');
  }
  if (format === 'all') {
    outputPath = ensureExtension(output, '.html');
  }

  return {
    outputPath: outputPath!,
    mdPath,
    totalComponents: graph.nodes.filter(n => n.type === 'root' || n.type === 'component').length,
    totalSharedComponents: graph.nodes.filter(n => (n.type === 'root' || n.type === 'component') && n.lane === 'shared').length,
    totalServices: graph.nodes.filter(n => n.type === 'service').length,
    totalDirectives: graph.nodes.filter(n => n.type === 'directive').length,
    totalPipes: graph.nodes.filter(n => n.type === 'pipe').length,
    totalRoutes: graph.metadata.totalRoutes,
    totalGuards: graph.nodes.filter(n => n.type === 'guard').length,
    totalModules: graph.nodes.filter(n => n.type === 'module').length,
    graph,
  };
}

// ─── Re-exports for programmatic use ─────────────────────────────────────────

export { buildGraph } from './graph/graph.builder';
export { generateHtml } from './output/html.generator';
export { generateJson } from './output/json.generator';
export { generateMd } from './output/md.generator';
export type { BoltflowOptions, BoltflowResult, FlowGraph } from './types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveProjectName(projectPath: string): string {
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name?: string };
      if (pkg.name) return pkg.name;
    }
  } catch {
    // ignore
  }
  return path.basename(projectPath);
}

function ensureExtension(filePath: string, ext: string): string {
  return filePath.endsWith(ext) ? filePath : filePath + ext;
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
