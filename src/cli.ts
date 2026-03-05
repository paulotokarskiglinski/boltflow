#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { analyze } from './index';
import { BoltflowOptions } from './types';

const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('boltflow')
  .description("Generate interactive flow visualizations of your application's component architecture")
  .version(pkg.version);

program
  .command('analyze [projectPath]')
  .alias('a')
  .description('Analyze an Angular project and generate a flow visualization')
  .option('-c, --config <path>', 'Path to tsconfig.json (relative to project root)', 'tsconfig.json')
  .option('-o, --output <path>', 'Output file path (without extension)', 'boltflow-output')
  .option(
    '-f, --format <format>',
    'Output format: html | json | both',
    'html'
  )
  .option('--open', 'Open the HTML output in the browser after generation', false)
  .action(async (projectPath: string | undefined, options: Record<string, string | boolean>) => {
    const resolvedProject = path.resolve(projectPath ?? process.cwd());

    console.log(chalk.bold.cyan('\n⚡ Boltflow'));
    console.log(chalk.gray(`  Analyzing: ${resolvedProject}\n`));

    const format = (options.format ?? 'html') as 'html' | 'json' | 'both';

    const opts: BoltflowOptions = {
      projectPath: resolvedProject,
      tsConfigPath: path.resolve(resolvedProject, options.config as string),
      output: path.resolve(options.output as string),
      format,
      open: Boolean(options.open),
    };

    try {
      // Lazy-load ora so the spinner import stays inside the try block
      const { default: ora } = await import('ora');
      const spinner = ora('Detecting framework…').start();

      const progress = (msg: string) => {
        spinner.text = msg;
      };

      const result = await analyze(opts, progress);

      spinner.succeed(chalk.green('Analysis complete!'));

      console.log('\n' + chalk.bold('Summary'));
      console.log(`${chalk.cyan('Components:       ')} ${result.totalComponents}`);
      console.log(`${chalk.cyan('Shared Components:')} ${result.totalSharedComponents}`);
      console.log(`${chalk.cyan('Services:         ')} ${result.totalServices}`);
      console.log(`${chalk.cyan('Directives:       ')} ${result.totalDirectives}`);
      console.log(`${chalk.cyan('Pipes:            ')} ${result.totalPipes}`);
      console.log(`${chalk.cyan('Routes:           ')} ${result.totalRoutes}`);
      console.log(`${chalk.cyan('Output path:      ')} ${result.outputPath}`);

      if (options.open && format !== 'json') {
        const open = (await import('open')).default;
        const htmlPath = format === 'both'
          ? result.outputPath.replace(/\.json$/, '.html')
          : result.outputPath;
        await open(htmlPath);
      }

      console.log('\n' + chalk.bold.green('✓ Done!\n'));
    } catch (err: unknown) {
      console.error(
        chalk.red('\n✗ Analysis failed:'),
        err instanceof Error ? err.message : String(err)
      );
      if (err instanceof Error && err.stack) {
        console.error(chalk.gray(err.stack));
      }
      process.exit(1);
    }
  });

program.parse(process.argv);
