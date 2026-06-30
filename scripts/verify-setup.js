#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolvePlatariumCliBinary } from '../src/core/platariumCorePaths.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isWindows = process.platform === 'win32';
const WALLET_ROOT = path.join(__dirname, '..');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(`${color}${args.join(' ')}${colors.reset}`);
}

function setupRustPath() {
  const cargoBinPath = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.cargo', 'bin');
  if (cargoBinPath && !process.env.PATH.includes(cargoBinPath)) {
    process.env.PATH = `${cargoBinPath}:${process.env.PATH}`;
  }
}

export async function runVerificationTests({ walletRoot = WALLET_ROOT, ctx } = {}) {
  setupRustPath();

  const resolved = resolvePlatariumCliBinary({ walletRoot });
  if (!resolved) {
    throw new Error('platarium-cli binary not found');
  }

  ctx?.log(`Binary: ${resolved.path}`);
  ctx?.log('→ platarium-cli --help');
  await execAsync(`"${resolved.path}" --help`, {
    env: { ...process.env },
    shell: isWindows,
  });
  ctx?.log('CLI help OK');

  ctx?.log('→ platarium-cli generate-mnemonic');
  const { stdout: mnemonicOut, stderr: mnemonicErr } = await execAsync(
    `"${resolved.path}" generate-mnemonic`,
    { env: { ...process.env }, maxBuffer: 1024 * 1024, shell: isWindows },
  );
  const mnemonicOutput = mnemonicOut + mnemonicErr;
  if (!mnemonicOutput.includes('Mnemonic:') || !mnemonicOutput.includes('Alphanumeric:')) {
    throw new Error('generate-mnemonic failed');
  }
  ctx?.log('generate-mnemonic OK');

  const testMnemonic =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
  const testAlphanumeric = 'TEST123456';
  const mnemonicEscaped = isWindows ? testMnemonic.replace(/"/g, '\\"') : testMnemonic;
  const alphanumericEscaped = isWindows ? testAlphanumeric.replace(/"/g, '\\"') : testAlphanumeric;

  ctx?.log('→ platarium-cli generate-keys (test vector)');
  const { stdout: keysOut, stderr: keysErr } = await execAsync(
    `"${resolved.path}" generate-keys --mnemonic "${mnemonicEscaped}" --alphanumeric "${alphanumericEscaped}" --seed-index 0`,
    { env: { ...process.env }, maxBuffer: 1024 * 1024, shell: isWindows },
  );
  const keysOutput = keysOut + keysErr;
  if (!keysOutput.includes('Public Key:') || !keysOutput.includes('Private Key:')) {
    throw new Error('generate-keys failed');
  }
  ctx?.log('generate-keys OK');

  return 'mnemonic, keys, binary OK';
}

async function main() {
  const resolved = resolvePlatariumCliBinary({ walletRoot: WALLET_ROOT });
  log(colors.cyan, '\n🧪 Verifying setup...\n');
  if (resolved) {
    log(colors.cyan, `   Binary: ${resolved.path} (${resolved.source})\n`);
  }

  try {
    const detail = await runVerificationTests({ walletRoot: WALLET_ROOT });
    log(colors.green, `✅ All tests passed - ${detail}\n`);
    return 0;
  } catch (error) {
    log(colors.red, `❌ Verification failed: ${error.message}\n`);
    return 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main()
    .then((exitCode) => process.exit(exitCode))
    .catch((error) => {
      log(colors.red, `\n❌ Verification error: ${error.message}\n`);
      process.exit(1);
    });
}
