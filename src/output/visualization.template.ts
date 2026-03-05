import * as fs from 'fs';
import * as path from 'path';
import { FlowGraph } from '../types';

/** Returns a complete, self-contained HTML string for the given graph. */
export function buildVisualizationHtml(graph: FlowGraph): string {
  // Escape </script> inside JSON to prevent XSS via malicious project data
  const safeJson = JSON.stringify(graph).replace(/<\/script>/gi, '<\\/script>');

  const templatePath = path.join(__dirname, 'visualization.template.html');
  const cssPath      = path.join(__dirname, 'visualization.template.css');
  const jsPath       = path.join(__dirname, 'visualization.template.browser.js');
  let html = fs.readFileSync(templatePath, 'utf-8');
  const css  = fs.readFileSync(cssPath, 'utf-8');
  const js   = fs.readFileSync(jsPath, 'utf-8');
  // Use function callbacks so $ characters inside the JSON/title don't trigger
  // special replacement patterns in String.replace
  html = html.replace('__CSS__',   () => `<style>${css}</style>`);
  html = html.replace('__JS__',    () => `<script>${js}</script>`);
  html = html.replace('__TITLE__', () => escapeHtml(graph.metadata.projectName));
  html = html.replace('__DATA__',  () => safeJson);
  return html;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
