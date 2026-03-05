import * as path from 'path';
import * as fs from 'fs';
import { IAnalyzer } from './base.analyzer';
import { AngularAnalyzer } from './angular/angular.analyzer';
import { Framework } from '../types';

/**
 * Registry of framework analyzers.
 * Add React, Vue and others here in the future by implementing IAnalyzer and
 * pushing an instance into the `analyzers` array.
 */
const analyzers: IAnalyzer[] = [
  new AngularAnalyzer(),
  // new ReactAnalyzer(),
  // new VueAnalyzer(),
];

export async function detectFramework(projectPath: string): Promise<Framework> {
  for (const analyzer of analyzers) {
    if (await analyzer.detect(projectPath)) {
      // Derive the framework name from the package name of the analyzer class.
      // The Angular analyzer checks for @angular/core, so we can infer it here.
      return inferFrameworkName(analyzer);
    }
  }
  throw new Error(
    `Could not detect a supported framework in: ${projectPath}\n` +
    'Boltflow currently supports Angular projects. ' +
    'Make sure @angular/core is listed in your package.json.'
  );
}

export async function getAnalyzer(projectPath: string): Promise<IAnalyzer> {
  for (const analyzer of analyzers) {
    if (await analyzer.detect(projectPath)) {
      return analyzer;
    }
  }
  throw new Error(
    `No analyzer found for the project at: ${projectPath}`
  );
}

function inferFrameworkName(analyzer: IAnalyzer): Framework {
  const name = analyzer.constructor.name.toLowerCase();
  if (name.includes('angular')) return 'angular';
  if (name.includes('react')) return 'react';
  if (name.includes('vue')) return 'vue';
  return 'angular';
}
