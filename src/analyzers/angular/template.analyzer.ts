import * as fs from 'fs';
import * as path from 'path';
import { parse as parseHtml, HTMLElement } from 'node-html-parser';
import { ComponentInfo } from '../../types';

/**
 * Given a component and the project root, reads its template (external .html
 * or inline template from the decorator) and:
 *  - Populates `component.usedComponents` with all child component selectors
 *    found in the template.
 *  - Populates `component.routerLinks` with all routerLink values found.
 *  - Populates `component.usedDirectives` with full selectors of attribute
 *    directives whose attribute name appears in the template.
 *  - Populates `component.usedPipes` with pipe names used via the `| pipe` syntax.
 */
export function analyzeTemplate(
  component: ComponentInfo,
  projectRoot: string,
  knownSelectors: Set<string>,
  inlineTemplates: Map<string, string>,
  /** Map of lowercased attribute name → full directive selector (e.g. "apphighlight" → "[appHighlight]") */
  knownDirectiveAttrs: Map<string, string> = new Map(),
  /** Set of known pipe names (e.g. "currency", "date", "myCustomPipe") */
  knownPipeNames: Set<string> = new Set()
): void {
  const templateContent = resolveTemplate(component, projectRoot, inlineTemplates);
  if (!templateContent) return;

  parseTemplateContent(component, templateContent, knownSelectors, knownDirectiveAttrs, knownPipeNames);
}

function resolveTemplate(
  component: ComponentInfo,
  projectRoot: string,
  inlineTemplates: Map<string, string>
): string | null {
  // Inline template stored by the angular analyzer
  const inline = inlineTemplates.get(component.id);
  if (inline) return inline;

  if (!component.templatePath) return null;

  const absPath = path.join(projectRoot, component.templatePath);
  if (!fs.existsSync(absPath)) return null;

  try {
    return fs.readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
}

function parseTemplateContent(
  component: ComponentInfo,
  content: string,
  knownSelectors: Set<string>,
  knownDirectiveAttrs: Map<string, string> = new Map(),
  knownPipeNames: Set<string> = new Set()
): void {
  let root: ReturnType<typeof parseHtml>;
  try {
    root = parseHtml(content, { lowerCaseTagName: false });
  } catch {
    // Fall back to regex scan on parse failure
    regexFallback(component, content, knownSelectors, knownDirectiveAttrs, knownPipeNames);
    return;
  }

  const usedSet = new Set<string>();
  const linkSet = new Set<string>();
  const hrefSet = new Set<string>();
  const dirSet  = new Set<string>();

  root.querySelectorAll('*').forEach((el: HTMLElement) => {
    const tag = el.rawTagName;
    if (!tag) return;

    // Angular component selectors contain at least one hyphen
    if (tag.includes('-') && knownSelectors.has(tag.toLowerCase())) {
      usedSet.add(tag.toLowerCase());
    }

    // Directive attribute detection: check every attribute name against the map
    const attrs = el.attributes ?? {};
    Object.keys(attrs).forEach(attrName => {
      // Strip binding syntax: [attrName], (attrName), [(attrName)]
      const bare = attrName.replace(/^[\[\(]+|[\]\)]+$/g, '').toLowerCase();
      const fullSel = knownDirectiveAttrs.get(bare);
      if (fullSel) dirSet.add(fullSel);
    });
    // Also catch directives in rawAttrs for unusual formatting
    if (knownDirectiveAttrs.size > 0) {
      const rawAttrsLower = (el.rawAttrs ?? '').toLowerCase();
      knownDirectiveAttrs.forEach((fullSel, attrLower) => {
        if (rawAttrsLower.includes(attrLower)) dirSet.add(fullSel);
      });
    }

    // routerLink="..." or [routerLink]="..."
    const rl = el.getAttribute('routerLink') ?? el.getAttribute('routerlink');
    if (rl) linkSet.add(rl.replace(/['"]/g, '').trim());

    // Binding form: [routerLink]="'/some/path'"
    const rawAttrs = el.rawAttrs ?? '';
    const bindingMatch = rawAttrs.match(/\[routerLink\]=["']([^"']+)["']/i);
    if (bindingMatch) {
      const val = bindingMatch[1].replace(/['"[\]]/g, '').trim();
      if (val) linkSet.add(val);
    }

    // <a href="/path"> — internal links only
    if (tag.toLowerCase() === 'a') {
      const href = el.getAttribute('href');
      if (href) {
        const h = href.trim();
        if (
          h &&
          !h.startsWith('http://') &&
          !h.startsWith('https://') &&
          !h.startsWith('//') &&
          !h.startsWith('mailto:') &&
          !h.startsWith('tel:') &&
          !h.startsWith('javascript:') &&
          h !== '#' &&
          !h.startsWith('#')
        ) {
          hrefSet.add(h);
        }
      }
    }
  });

  component.usedComponents = [...usedSet];
  component.routerLinks = [...linkSet];
  component.hrefs = [...hrefSet];
  component.usedDirectives = [...dirSet];

  // Detect pipe usage: | pipeName patterns
  if (knownPipeNames.size > 0) {
    const pipeSet = new Set<string>();
    const pipeRegex = /\|\s*([a-zA-Z][a-zA-Z0-9]*)/g;
    let mp: RegExpExecArray | null;
    while ((mp = pipeRegex.exec(content)) !== null) {
      if (knownPipeNames.has(mp[1])) pipeSet.add(mp[1]);
    }
    component.usedPipes = [...pipeSet];
  }
}

function regexFallback(
  component: ComponentInfo,
  content: string,
  knownSelectors: Set<string>,
  knownDirectiveAttrs: Map<string, string> = new Map(),
  knownPipeNames: Set<string> = new Set()
): void {
  const usedSet = new Set<string>();
  const linkSet = new Set<string>();
  const hrefSet = new Set<string>();

  // Match opening tags: <app-something or <my-comp
  const tagRegex = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(content)) !== null) {
    const tag = m[1].toLowerCase();
    if (knownSelectors.has(tag)) usedSet.add(tag);
  }

  // Match routerLink
  const rlRegex = /\[?routerLink\]?=["']([^"']+)["']/gi;
  while ((m = rlRegex.exec(content)) !== null) {
    const val = m[1].replace(/['"[\]]/g, '').trim();
    if (val) linkSet.add(val);
  }

  // Match internal <a href="...">
  const hrefRegex = /<a\s[^>]*href=["']([^"']+)["']/gi;
  while ((m = hrefRegex.exec(content)) !== null) {
    const h = m[1].trim();
    if (
      h &&
      !h.startsWith('http') &&
      !h.startsWith('//') &&
      !h.startsWith('mailto:') &&
      !h.startsWith('tel:') &&
      !h.startsWith('javascript:') &&
      h !== '#' &&
      !h.startsWith('#')
    ) {
      hrefSet.add(h);
    }
  }

  component.usedComponents = [...usedSet];
  component.routerLinks = [...linkSet];
  component.hrefs = [...hrefSet];

  // Directive attrs (regex fallback)
  const dirSet = new Set<string>();
  knownDirectiveAttrs.forEach((fullSel, attrLower) => {
    if (content.toLowerCase().includes(attrLower)) dirSet.add(fullSel);
  });
  component.usedDirectives = [...dirSet];

  // Pipe usage (regex fallback)
  if (knownPipeNames.size > 0) {
    const pipeSet = new Set<string>();
    const pipeRegex = /\|\s*([a-zA-Z][a-zA-Z0-9]*)/g;
    let mp: RegExpExecArray | null;
    while ((mp = pipeRegex.exec(content)) !== null) {
      if (knownPipeNames.has(mp[1])) pipeSet.add(mp[1]);
    }
    component.usedPipes = [...pipeSet];
  }
}
