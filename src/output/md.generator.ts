import * as fs from 'fs';
import { FlowGraph, GraphNode, GraphEdge, NodeType, EdgeType } from '../types';

function nodeShape(node: GraphNode): string {
  const lbl = mermaidLabel(node.label);
  switch (node.type as NodeType) {
    case 'root':       return `([${lbl}])`;
    case 'module':     return `[[${lbl}]]`;
    case 'route':      return `(${lbl})`;
    case 'service':    return `[(${lbl})]`;
    case 'guard':      return `{${lbl}}`;
    case 'directive':  return `[/${lbl}\\]`;
    case 'pipe':       return `[\\${lbl}/]`;
    case 'component':
    default:           return `[${lbl}]`;
  }
}

function mermaidLabel(label: string): string {
  if (/[()[\]{}<>\/\\|"']/.test(label)) {
    return `"${label.replace(/"/g, '#quot;')}"`;
  }
  return label;
}

const CLASS_DEFS: Record<NodeType, string> = {
  root:      'classDef rootStyle      fill:#FA5252,stroke:#c0392b,color:#fff,font-weight:bold',
  component: 'classDef componentStyle fill:#1976D2,stroke:#1565C0,color:#fff',
  module:    'classDef moduleStyle    fill:#FA5252,stroke:#c0392b,color:#fff',
  route:     'classDef routeStyle     fill:#43A047,stroke:#2E7D32,color:#fff',
  service:   'classDef serviceStyle   fill:#FFCA28,stroke:#F9A825,color:#333',
  guard:     'classDef guardStyle     fill:#43A047,stroke:#2E7D32,color:#fff',
  directive: 'classDef directiveStyle fill:#AB47BC,stroke:#7B1FA2,color:#fff',
  pipe:      'classDef pipeStyle      fill:#00897B,stroke:#00695C,color:#fff',
};

const CLASS_NAME: Record<NodeType, string> = {
  root:      'rootStyle',
  component: 'componentStyle',
  module:    'moduleStyle',
  route:     'routeStyle',
  service:   'serviceStyle',
  guard:     'guardStyle',
  directive: 'directiveStyle',
  pipe:      'pipeStyle',
};

function edgeArrow(type: EdgeType): string {
  switch (type) {
    case 'lazy-load':   return '-.->';
    case 'navigate':    return '==>';
    case 'uses':        return '--o';
    case 'route':
    case 'child-route':
    default:            return '-->';
  }
}

function edgeLabel(edge: GraphEdge): string {
  const parts: string[] = [];
  if (edge.label) parts.push(edge.label);
  if (edge.type === 'lazy-load') parts.push('lazy');
  if (edge.type === 'child-route') parts.push('child');
  if (edge.guards && edge.guards.length > 0) {
    parts.push(`canActivate: ${edge.guards.join(', ')}`);
  }
  return parts.length > 0 ? `|"${parts.join(' · ')}"| ` : ' ';
}

export function generateMd(graph: FlowGraph, outputPath: string): void {
  const lines: string[] = [];

  const { projectName, framework, generatedAt } = graph.metadata;

  // ── Markdown header ──
  lines.push('flowchart LR');

  const usedTypes = new Set(graph.nodes.map(n => n.type as NodeType));

  lines.push('');
  for (const type of usedTypes) {
    lines.push(`  ${CLASS_DEFS[type]}`);
  }

  lines.push('');
  for (const node of graph.nodes) {
    lines.push(`  ${node.id}${nodeShape(node)}`);
  }

  lines.push('');
  for (const edge of graph.edges) {
    const arrow = edgeArrow(edge.type as EdgeType);
    const label = edgeLabel(edge);
    lines.push(`  ${edge.source} ${arrow}${label}${edge.target}`);
  }

  lines.push('');
  for (const type of usedTypes) {
    const ids = graph.nodes.filter(n => n.type === type).map(n => n.id).join(',');
    if (ids) {
      lines.push(`  class ${ids} ${CLASS_NAME[type]}`);
    }
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}
