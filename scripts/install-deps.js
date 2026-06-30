#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, statSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WALLET_ROOT = path.join(__dirname, '..');

const REQUIRED_DEPS = ['chalk', 'inquirer', 'commander', 'ora', '@scure/bip39'];

function isNodeModulesStale() {
  const nodeModulesPath = path.join(WALLET_ROOT, 'node_modules');
  if (!existsSync(nodeModulesPath)) return true;

  const lockPath = path.join(WALLET_ROOT, 'package-lock.json');
  const pkgPath = path.join(WALLET_ROOT, 'package.json');
  if (!existsSync(lockPath)) return false;

  try {
    const lockMtime = Math.max(statSync(lockPath).mtimeMs, statSync(pkgPath).mtimeMs);
    return lockMtime > statSync(nodeModulesPath).mtimeMs;
  } catch {
    return true;
  }
}

function missingDependencies() {
  return REQUIRED_DEPS.filter(
    (name) => !existsSync(path.join(WALLET_ROOT, 'node_modules', name)),
  );
}

function readEnginesNode() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(WALLET_ROOT, 'package.json'), 'utf-8'));
    const engines = pkg.engines?.node || '>=18.0.0';
    const match = engines.match(/(\d+)/);
    return match ? Number(match[1]) : 18;
  } catch {
    return 18;
  }
}

/**
 * @returns {Promise<string>} Detail line for runStep
 */
export async function ensureNpmDependencies(ctx) {
  const minNode = readEnginesNode();
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < minNode) {
    throw new Error(`Node.js ≥${minNode} required (current: ${process.versions.node})`);
  }

  ctx?.log(`Node.js ${process.versions.node} (required ≥${minNode})`);

  const missing = missingDependencies();
  const stale = isNodeModulesStale();

  if (missing.length === 0 && !stale) {
    ctx?.log('package-lock.json synced with node_modules');
    ctx?.log(`verified packages: ${REQUIRED_DEPS.join(', ')}`);
    return `lockfile synced`;
  }

  const reason =
    missing.length > 0
      ? `missing ${missing.length} package(s): ${missing.join(', ')}`
      : 'package-lock.json newer than node_modules';

  ctx?.log(reason);

  if (ctx?.runCmd) {
    await ctx.runCmd('npm install', { cwd: WALLET_ROOT });
  } else {
    execSync('npm install', {
      cwd: WALLET_ROOT,
      stdio: 'inherit',
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  const stillMissing = missingDependencies();
  if (stillMissing.length > 0) {
    throw new Error(`Missing after install: ${stillMissing.join(', ')}`);
  }

  ctx?.log('npm install completed');
  return reason;
}

export function checkNodeVersion() {
  const minNode = readEnginesNode();
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < minNode) {
    throw new Error(`Node.js ≥${minNode} required (current: ${process.versions.node})`);
  }
  return process.versions.node;
}
