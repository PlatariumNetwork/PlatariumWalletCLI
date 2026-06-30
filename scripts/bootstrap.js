#!/usr/bin/env node

/**
 * Single entry for `npm start` - installs, verifies, then launches the wallet.
 */

import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureNpmDependencies, checkNodeVersion } from './install-deps.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WALLET_ROOT = path.join(__dirname, '..');

async function bootstrap() {
  checkNodeVersion();

  if (!existsSync(path.join(WALLET_ROOT, 'node_modules', 'chalk'))) {
    console.log('\n  → First run: installing npm packages…\n');
    execSync('npm install', { cwd: WALLET_ROOT, stdio: 'inherit' });
  }

  const { printBanner, printRule, runLiveStep, printReadyBox, getPackageVersion } = await import(
    '../src/cli/branding.js'
  );
  const { ensurePlatariumCore } = await import('./setup-rust-core.js');

  const version = await getPackageVersion();
  printBanner({ version, subtitle: 'Preparing environment' });
  printRule();
  console.log('');

  await runLiveStep('Node.js runtime', async (ctx) => {
    ctx.log(`Node.js ${process.versions.node}`);
    return `v${process.versions.node}`;
  });

  await runLiveStep('npm dependencies', async (ctx) => ensureNpmDependencies(ctx));

  const { binaryPath, coreVersion, buildType } = await ensurePlatariumCore({
    interactive: true,
  });

  printReadyBox({
    title: 'Wallet is ready',
    lines: [
      ['Core build', buildType],
      ['Core version', coreVersion],
      ['Binary path', binaryPath],
    ],
  });

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/index.js', ...process.argv.slice(2)], {
      cwd: WALLET_ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        PLATARIUM_CLI_PATH: binaryPath,
      },
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

bootstrap()
  .then((code) => process.exit(code))
  .catch(async (error) => {
    try {
      const chalk = (await import('chalk')).default;
      console.error(chalk.red(`\n  ✗ Bootstrap failed: ${error.message}\n`));
    } catch {
      console.error(`\n  ✗ Bootstrap failed: ${error.message}\n`);
    }
    process.exit(1);
  });
