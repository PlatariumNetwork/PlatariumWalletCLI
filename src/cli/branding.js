import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { createStepLogger } from './stepLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ASCII_BANNER = `
█▀█ █░░ ▄▀█ ▀█▀ ▄▀█ █▀█ █ █░█ █▀▄▀█   █░█░█ ▄▀█ █░░ █░░ █▀▀ ▀█▀
█▀▀ █▄▄ █▀█ ░█░ █▀█ █▀▄ █ █▄█ █░▀░█   ▀▄▀▄▀ █▀█ █▄▄ █▄▄ ██▄ ░█░`;

let versionCache;

export async function getPackageVersion() {
  if (!versionCache) {
    const pkg = JSON.parse(
      await readFile(path.join(__dirname, '../../package.json'), 'utf-8'),
    );
    versionCache = pkg.version;
  }
  return versionCache;
}

export function printRule() {
  console.log(chalk.gray(`  ${'─'.repeat(54)}`));
}

export function printBanner({ version, subtitle } = {}) {
  console.log(chalk.blue.bold(ASCII_BANNER));
  const ver = version ? chalk.gray(` v${version}`) : '';
  console.log(chalk.cyan.bold(`  Platarium Wallet CLI${ver}`));
  console.log(chalk.gray(`  ${subtitle || 'Console wallet · Platarium Network'}\n`));
}

export function printReadyBox({ title = 'Environment ready', lines = [] } = {}) {
  printRule();
  console.log(chalk.green.bold(`\n  ✓ ${title}\n`));
  for (const line of lines) {
    const [label, value] = line;
    console.log(chalk.gray(`  ${label.padEnd(14)} ${chalk.white(value)}`));
  }
  console.log('');
}

export async function runLiveStep(label, fn) {
  const spinner = ora({
    text: chalk.white(label),
    indent: 2,
    color: 'cyan',
  }).start();

  const ctx = createStepLogger();
  ctx.bindSpinner(spinner);

  try {
    const result = await fn(ctx);
    ctx.stopSpinner();
    if (spinner.isSpinning) {
      spinner.stop();
    }
    const detail =
      typeof result === 'string' && result.trim()
        ? chalk.gray(` - ${result.trim()}`)
        : '';
    console.log(`  ${chalk.green('✔')} ${chalk.white(label)}${detail}`);
    return result;
  } catch (error) {
    ctx.stopSpinner();
    if (spinner.isSpinning) {
      spinner.fail(chalk.white(label));
    } else {
      console.log(`  ${chalk.red('✖')} ${chalk.white(label)}`);
    }
    throw error;
  }
}

export async function runStep(label, fn) {
  const spinner = ora({
    text: chalk.white(label),
    indent: 2,
    color: 'cyan',
  }).start();

  try {
    const result = await fn();
    const detail =
      typeof result === 'string' && result.trim()
        ? chalk.gray(` - ${result.trim()}`)
        : '';
    spinner.succeed(chalk.white(label) + detail);
    return result;
  } catch (error) {
    spinner.fail(chalk.white(label));
    throw error;
  }
}

export function runStepSync(label, fn) {
  const spinner = ora({
    text: chalk.white(label),
    indent: 2,
    color: 'cyan',
  }).start();

  try {
    const result = fn();
    spinner.succeed(chalk.white(label));
    return result;
  } catch (error) {
    spinner.fail(chalk.white(label));
    throw error;
  }
}

export async function warnStep(label) {
  const spinner = ora({ text: chalk.white(label), indent: 2, color: 'yellow' }).start();
  spinner.warn(chalk.yellow(label));
}
