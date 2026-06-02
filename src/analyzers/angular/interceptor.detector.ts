import { Project, Node } from 'ts-morph';
import * as path from 'path';
import { InterceptorInfo, ServiceInfo } from '../../types';

let _idCounter = 0;
function nextId(): string {
  return `interceptor_${++_idCounter}`;
}

export function detectInterceptors(
  project: Project,
  projectRoot: string,
  services: ServiceInfo[]
): InterceptorInfo[] {
  const interceptors: InterceptorInfo[] = [];
  const serviceNames = new Set(services.map(s => s.name));

  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    // 1. Class-based Interceptors
    for (const cls of file.getClasses()) {
      const implementedInterfaces = cls
        .getImplements()
        .map(impl => impl.getExpression().getText().replace(/<.*>$/, '').trim());

      if (!implementedInterfaces.includes('HttpInterceptor')) continue;

      const filePath = path.relative(projectRoot, file.getFilePath()).replace(/\\/g, '/');
      const injected = new Set<string>();

      // inject() calls
      cls.forEachDescendant(node => {
        if (!Node.isCallExpression(node)) return;
        const exprText = node.getExpression().getText();
        if (exprText === 'inject') {
          const args = node.getArguments();
          if (args.length) {
            const name = args[0].getText().trim();
            if (serviceNames.has(name)) injected.add(name);
          }
        }
      });

      // Constructor parameters
      for (const ctor of cls.getConstructors()) {
        for (const param of ctor.getParameters()) {
          const typeText = (param.getTypeNode()?.getText() ?? '').trim();
          if (serviceNames.has(typeText)) injected.add(typeText);
        }
      }

      interceptors.push({
        id: nextId(),
        name: cls.getName() ?? filePath,
        filePath,
        isUsed: false,
        injectedServices: [...injected],
      });
    }

    // 2. Functional Interceptors
    for (const varDecl of file.getVariableDeclarations()) {
      const typeNode = varDecl.getTypeNode();
      if (!typeNode) continue;

      const typeText = typeNode.getText().trim();
      const baseType = typeText.replace(/<.*>$/, '');
      if (baseType !== 'HttpInterceptorFn') continue;

      const filePath = path.relative(projectRoot, file.getFilePath()).replace(/\\/g, '/');
      const injected = new Set<string>();

      // inject() calls in the function body
      const init = varDecl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        init.forEachDescendant(node => {
          if (!Node.isCallExpression(node)) return;
          const exprText = node.getExpression().getText();
          if (exprText === 'inject') {
            const args = node.getArguments();
            if (args.length) {
              const name = args[0].getText().trim();
              if (serviceNames.has(name)) injected.add(name);
            }
          }
        });
      }

      interceptors.push({
        id: nextId(),
        name: varDecl.getName(),
        filePath,
        isUsed: false,
        injectedServices: [...injected],
      });
    }
  }

  // Cross-reference to see if they are used anywhere
  const interceptorNames = new Set(interceptors.map(i => i.name));
  
  for (const file of project.getSourceFiles().filter(
    f => !f.getFilePath().includes('node_modules') && !f.getFilePath().endsWith('.spec.ts')
  )) {
    file.forEachDescendant(node => {
      if (Node.isIdentifier(node)) {
        const text = node.getText();
        if (interceptorNames.has(text)) {
          // Check if this identifier is an import declaration
          const parent = node.getParent();
          if (parent && Node.isImportSpecifier(parent)) {
            // Found in import, it means it is used in this file
            const interceptor = interceptors.find(i => i.name === text);
            if (interceptor) {
              interceptor.isUsed = true;
            }
          }
        }
      }
    });
  }

  return interceptors;
}
