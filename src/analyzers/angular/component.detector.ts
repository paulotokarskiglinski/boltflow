import {
  SourceFile,
  ClassDeclaration,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
  Project,
  CallExpression,
} from 'ts-morph';
import * as path from 'path';
import { ComponentInfo, InputInfo, OutputInfo } from '../../types';

let _idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${++_idCounter}`;
}

/**
 * Scans all source files in the ts-morph Project and returns every class
 * decorated with @Component.
 */
export function detectComponents(
  project: Project,
  projectRoot: string
): ComponentInfo[] {
  const components: ComponentInfo[] = [];

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    for (const cls of file.getClasses()) {
      const decorator = cls.getDecorator('Component');
      if (!decorator) continue;

      const args = decorator.getArguments();
      if (!args.length || !Node.isObjectLiteralExpression(args[0])) continue;

      const meta = args[0] as ObjectLiteralExpression;

      const selector = getStringProp(meta, 'selector') ?? toSelector(cls.getName() ?? 'unknown');
      const templateUrl = getStringProp(meta, 'templateUrl');
      const isStandalone = getBoolProp(meta, 'standalone') ?? false;

      const filePath = path.relative(projectRoot, file.getFilePath()).replace(/\\/g, '/');
      const templatePath = templateUrl
        ? resolveTemplatePath(filePath, templateUrl)
        : undefined;

      const inputs: InputInfo[] = [];
      const outputs: OutputInfo[] = [];

      collectInputsOutputs(cls, inputs, outputs);
      // Also handle the new `inputs: []` / `outputs: []` array in @Component decorator
      collectDecoratorInputsOutputs(meta, inputs, outputs);

      const lifecycleHooks = collectLifecycleHooks(cls);

      components.push({
        id: nextId('cmp'),
        name: cls.getName() ?? selector,
        selector,
        filePath,
        templatePath,
        isStandalone,
        inputs,
        outputs,
        lifecycleHooks: lifecycleHooks.length ? lifecycleHooks : undefined,
        usedComponents: [],            // filled later by template analyzer
        routerLinks: [],               // filled later by template analyzer
        hrefs: [],                     // filled later by template analyzer
        navigateCalls: collectNavigationCalls(cls),
        injectedServices: [],          // filled later by angular analyzer
        usedDirectives: [],            // filled later by template analyzer
        usedPipes: [],                 // filled later by template analyzer
      });
    }
  }

  return components;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStringProp(obj: ObjectLiteralExpression, key: string): string | undefined {
  const prop = obj.getProperty(key);
  if (!prop || !Node.isPropertyAssignment(prop)) return undefined;
  const init = (prop as PropertyAssignment).getInitializer();
  if (!init) return undefined;
  // Strip surrounding quotes
  return init.getText().replace(/^['"`]|['"`]$/g, '');
}

function getBoolProp(obj: ObjectLiteralExpression, key: string): boolean | undefined {
  const prop = obj.getProperty(key);
  if (!prop || !Node.isPropertyAssignment(prop)) return undefined;
  const text = (prop as PropertyAssignment).getInitializer()?.getText();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return undefined;
}

function collectInputsOutputs(
  cls: ClassDeclaration,
  inputs: InputInfo[],
  outputs: OutputInfo[]
): void {
  for (const prop of cls.getProperties()) {
    const inputDec = prop.getDecorator('Input');
    const outputDec = prop.getDecorator('Output');

    if (inputDec) {
      const args = inputDec.getArguments();
      // @Input() can take an alias string or { alias, required }
      const required = args.length > 0
        ? extractRequiredFromInputArgs(args[0])
        : false;

      inputs.push({
        name: prop.getName(),
        type: safeTypeText(prop.getType().getText()),
        required,
      });
    }

    if (outputDec) {
      outputs.push({
        name: prop.getName(),
        type: safeTypeText(prop.getType().getText()),
      });
    }
  }

  // Support signal-based inputs: input() / input.required()
  for (const prop of cls.getProperties()) {
    const initializer = prop.getInitializer();
    if (!initializer) continue;
    const text = initializer.getText();
    const isSignalInput         = /^input\s*(<[^>]*>)?\s*\(/.test(text);
    const isSignalInputRequired = /^input\.required\s*(<[^>]*>)?\s*\(/.test(text);
    const isSignalOutput        = /^output\s*(<[^>]*>)?\s*\(/.test(text);
    const isSignalModel         = /^model\s*(<[^>]*>)?\s*\(/.test(text);
    const isSignalModelRequired = /^model\.required\s*(<[^>]*>)?\s*\(/.test(text);

    if (isSignalInput || isSignalInputRequired) {
      const alreadyAdded = inputs.some(i => i.name === prop.getName());
      if (!alreadyAdded) {
        inputs.push({
          name: prop.getName(),
          type: safeTypeText(prop.getType().getText()),
          required: isSignalInputRequired,
        });
      }
    }
    if (isSignalOutput) {
      const alreadyAdded = outputs.some(o => o.name === prop.getName());
      if (!alreadyAdded) {
        outputs.push({
          name: prop.getName(),
          type: safeTypeText(prop.getType().getText()),
        });
      }
    }

    // Support signal-based model(): model() / model.required() — two-way binding
    if (isSignalModel || isSignalModelRequired) {
      const alreadyAddedInput = inputs.some(i => i.name === prop.getName());
      if (!alreadyAddedInput) {
        inputs.push({
          name: prop.getName(),
          type: safeTypeText(prop.getType().getText()),
          required: isSignalModelRequired,
        });
      }
      const alreadyAddedOutput = outputs.some(o => o.name === prop.getName() + 'Change');
      if (!alreadyAddedOutput) {
        outputs.push({
          name: prop.getName() + 'Change',
          type: safeTypeText(prop.getType().getText()),
        });
      }
    }
  }
}

function collectLifecycleHooks(cls: ClassDeclaration): string[] {
  const HOOK_INTERFACES = [
    'OnInit', 'OnDestroy', 'OnChanges', 'DoCheck',
    'AfterContentInit', 'AfterContentChecked',
    'AfterViewInit', 'AfterViewChecked',
  ];
  const HOOK_METHODS: Record<string, string> = {
    OnInit: 'ngOnInit', OnDestroy: 'ngOnDestroy', OnChanges: 'ngOnChanges',
    DoCheck: 'ngDoCheck', AfterContentInit: 'ngAfterContentInit',
    AfterContentChecked: 'ngAfterContentChecked', AfterViewInit: 'ngAfterViewInit',
    AfterViewChecked: 'ngAfterViewChecked',
  };

  const found = new Set<string>();

  // Via implements clause
  for (const impl of cls.getImplements()) {
    const name = impl.getExpression().getText().replace(/<.*>$/, '').trim();
    if (HOOK_INTERFACES.includes(name)) found.add(name);
  }

  // Via method presence (covers classes that skip the implements clause)
  for (const [iface, method] of Object.entries(HOOK_METHODS)) {
    if (!found.has(iface) && cls.getMethod(method)) found.add(iface);
  }

  return HOOK_INTERFACES.filter(h => found.has(h));
}

function extractRequiredFromInputArgs(arg: Node): boolean {
  if (Node.isObjectLiteralExpression(arg)) {
    const reqProp = arg.getProperty('required');
    if (reqProp && Node.isPropertyAssignment(reqProp)) {
      return (reqProp as PropertyAssignment).getInitializer()?.getText() === 'true';
    }
  }
  return false;
}

function collectDecoratorInputsOutputs(
  meta: ObjectLiteralExpression,
  inputs: InputInfo[],
  outputs: OutputInfo[]
): void {
  // @Component({ inputs: ['foo', 'bar'] })
  const inputsProp = meta.getProperty('inputs');
  if (inputsProp && Node.isPropertyAssignment(inputsProp)) {
    const arr = (inputsProp as PropertyAssignment).getInitializer();
    if (arr && Node.isArrayLiteralExpression(arr)) {
      for (const el of arr.getElements()) {
        const name = el.getText().replace(/^['"`]|['"`]$/g, '').split(':')[0].trim();
        if (name && !inputs.some(i => i.name === name)) {
          inputs.push({ name });
        }
      }
    }
  }

  const outputsProp = meta.getProperty('outputs');
  if (outputsProp && Node.isPropertyAssignment(outputsProp)) {
    const arr = (outputsProp as PropertyAssignment).getInitializer();
    if (arr && Node.isArrayLiteralExpression(arr)) {
      for (const el of arr.getElements()) {
        const name = el.getText().replace(/^['"`]|['"`]$/g, '').split(':')[0].trim();
        if (name && !outputs.some(o => o.name === name)) {
          outputs.push({ name });
        }
      }
    }
  }
}

function resolveTemplatePath(componentFilePath: string, templateUrl: string): string {
  const dir = path.posix.dirname(componentFilePath);
  return path.posix.normalize(path.posix.join(dir, templateUrl));
}

/** Convert "AppHeaderComponent" → "app-header" */
function toSelector(className: string): string {
  return className
    .replace(/Component$/, '')
    .replace(/([A-Z])/g, (_, c) => `-${c.toLowerCase()}`)
    .replace(/^-/, '');
}

/**
 * Scans a component class body for:
 *   • this.router.navigate(['/path'])
 *   • this.router.navigateByUrl('/path')
 * and returns the unique route strings found.
 */
function collectNavigationCalls(cls: ClassDeclaration): string[] {
  const paths: string[] = [];

  cls.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const exprText = (node as CallExpression).getExpression().getText();

    // *.navigate(['/path', ...])
    if (/\.navigate$/.test(exprText)) {
      const args = (node as CallExpression).getArguments();
      if (args.length && Node.isArrayLiteralExpression(args[0])) {
        const first = args[0].getElements()[0];
        if (first && Node.isStringLiteral(first)) {
          const val = first.getLiteralValue();
          if (val) paths.push(val);
        }
      }
    }

    // *.navigateByUrl('/path')
    if (/\.navigateByUrl$/.test(exprText)) {
      const args = (node as CallExpression).getArguments();
      if (args.length && Node.isStringLiteral(args[0])) {
        const val = args[0].getLiteralValue();
        if (val) paths.push(val);
      }
    }
  });

  return [...new Set(paths)];
}

/** Trim overly long type strings to keep output readable */
function safeTypeText(text: string): string {
  const unwrapped = unwrapSignalType(text);
  if (unwrapped.length > 80) return unwrapped.slice(0, 77) + '\u2026';
  return unwrapped;
}

/**
 * Strips Angular signal/emitter wrapper types to expose the inner value type.
 * e.g. InputSignal<string> → string
 *      OutputEmitterRef<void> → void
 *      ModelSignal<boolean> → boolean
 *      EventEmitter<MyEvent> → MyEvent
 */
function unwrapSignalType(text: string): string {
  // First strip ts-morph import() references: import("path/to/file").TypeName → TypeName
  // Also handles nested: import("...").Ns.TypeName → Ns.TypeName
  let cleaned = text.replace(/import\([^)]+\)\./g, '');

  const wrappers = [
    'InputSignal', 'InputSignalWithTransform',
    'OutputEmitterRef', 'OutputRef',
    'ModelSignal',
    'EventEmitter', 'Subject',
  ];
  for (const wrapper of wrappers) {
    if (!cleaned.startsWith(wrapper + '<') || !cleaned.endsWith('>')) continue;
    const inner = cleaned.slice(wrapper.length + 1, -1);
    // Return only the first type argument (handles nested generics)
    let depth = 0;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '<') depth++;
      else if (inner[i] === '>') depth--;
      else if (inner[i] === ',' && depth === 0) return inner.slice(0, i).trim();
    }
    return inner.trim();
  }
  return cleaned;
}
