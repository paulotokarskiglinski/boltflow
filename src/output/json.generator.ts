import * as fs from 'fs';
import { FlowGraph } from '../types';

export function generateJson(graph: FlowGraph, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2), 'utf-8');
}
