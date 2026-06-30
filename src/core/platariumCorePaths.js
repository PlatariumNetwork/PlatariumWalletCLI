/**
 * PlatariumCore binary and source resolution - aligned with
 * PlatariumGatewayGO/internal/core/rust_core.go
 *
 * Order: PLATARIUM_CLI_PATH → core tree (release/debug) → cwd-relative → PATH
 * Source tree: PLATARIUM_CORE_ROOT → monorepo ../PlatariumCore → nested clone
 */

import { existsSync, accessSync, constants } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const isWindows = process.platform === 'win32';
export const BINARY_EXT = isWindows ? '.exe' : '';
export const BINARY_NAME = `platarium-cli${BINARY_EXT}`;
export const PLATARIUM_CORE_REPO = 'https://github.com/PlatariumNetwork/PlatariumCore.git';

const WALLET_ROOT = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'),
);

export function getWalletPackageRoot() {
  return WALLET_ROOT;
}

export function isExecutable(filePath) {
  if (!filePath || !existsSync(filePath)) return false;
  try {
    accessSync(filePath, constants.F_OK | constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return existsSync(filePath);
  }
}

function isCoreCrate(dir) {
  return Boolean(dir) && existsSync(path.join(dir, 'Cargo.toml'));
}

export function binaryInCoreRoot(coreRoot, profile = 'release') {
  return path.join(coreRoot, 'target', profile, BINARY_NAME);
}

/**
 * @returns {string} Directory with Cargo.toml to build from
 */
export function resolvePlatariumCoreRoot(options = {}) {
  const walletRoot = options.walletRoot ?? WALLET_ROOT;

  const fromEnv = process.env.PLATARIUM_CORE_ROOT?.trim();
  if (fromEnv && isCoreCrate(fromEnv)) {
    return path.resolve(fromEnv);
  }

  const monorepoCore = path.resolve(walletRoot, '..', 'PlatariumCore');
  if (isCoreCrate(monorepoCore)) {
    return monorepoCore;
  }

  const nestedCore = path.join(walletRoot, 'PlatariumCore');
  if (isCoreCrate(nestedCore)) {
    return nestedCore;
  }

  return nestedCore;
}

export function isMonorepoCoreRoot(coreRoot, walletRoot = WALLET_ROOT) {
  const monorepoCore = path.resolve(walletRoot, '..', 'PlatariumCore');
  return path.resolve(coreRoot) === monorepoCore && isCoreCrate(monorepoCore);
}

/**
 * @returns {{ path: string, source: string, coreRoot?: string } | null}
 */
export function resolvePlatariumCliBinary(options = {}) {
  const walletRoot = options.walletRoot ?? WALLET_ROOT;
  const cwd = options.cwd ?? process.cwd();

  const explicit = process.env.PLATARIUM_CLI_PATH?.trim();
  if (explicit && isExecutable(explicit)) {
    return { path: path.resolve(explicit), source: 'PLATARIUM_CLI_PATH' };
  }

  const coreRoot = resolvePlatariumCoreRoot({ walletRoot });
  for (const profile of ['release', 'debug']) {
    const bin = binaryInCoreRoot(coreRoot, profile);
    if (isExecutable(bin)) {
      return {
        path: bin,
        source: profile === 'release' ? 'core-release' : 'core-debug',
        coreRoot,
      };
    }
  }

  const relativeFromCwd = path.resolve(
    cwd,
    '..',
    'PlatariumCore',
    'target',
    'release',
    BINARY_NAME,
  );
  if (isExecutable(relativeFromCwd)) {
    return { path: relativeFromCwd, source: 'cwd-relative' };
  }

  try {
    const whichCmd = isWindows ? 'where platarium-cli' : 'which platarium-cli';
    const out = execSync(whichCmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    const found = out.split(/\r?\n/)[0]?.trim();
    if (found && isExecutable(found)) {
      return { path: found, source: 'PATH' };
    }
  } catch {
    // not on PATH
  }

  return null;
}

/** Ordered candidate paths for verification scripts. */
export function listPlatariumCliCandidates(options = {}) {
  const seen = new Set();
  const candidates = [];

  const add = (p) => {
    const resolved = path.resolve(p);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      candidates.push(resolved);
    }
  };

  const resolved = resolvePlatariumCliBinary(options);
  if (resolved) add(resolved.path);

  const coreRoot = resolvePlatariumCoreRoot(options);
  add(binaryInCoreRoot(coreRoot, 'release'));
  add(binaryInCoreRoot(coreRoot, 'debug'));

  add(path.resolve(options.cwd ?? process.cwd(), '..', 'PlatariumCore', 'target', 'release', BINARY_NAME));
  add(isWindows ? 'platarium-cli.exe' : 'platarium-cli');

  return candidates;
}
