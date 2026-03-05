import * as fs from 'fs';
import { FlowGraph } from '../types';
import { buildVisualizationHtml } from './visualization.template';

export function generateHtml(graph: FlowGraph, outputPath: string): void {
  const html = buildVisualizationHtml(graph);
  fs.writeFileSync(outputPath, html, 'utf-8');
}
