import { AnalysisResult, BoltflowOptions } from '../types';

export interface IAnalyzer {
  /** Returns true if this analyzer can handle the project at the given path */
  detect(projectPath: string): Promise<boolean>;
  /** Run the analysis and return structured results */
  analyze(options: BoltflowOptions, progress: (msg: string) => void): Promise<AnalysisResult>;
}
