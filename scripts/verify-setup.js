#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, accessSync, constants } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect OS
const isWindows = process.platform === 'win32';
const BINARY_EXT = isWindows ? '.exe' : '';

// Simple console colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(color, ...args) {
  console.log(`${color}${args.join(' ')}${colors.reset}`);
}

/**
 * Check if binary exists and is executable
 */
function checkBinary(binaryPath) {
  if (!existsSync(binaryPath)) {
    return false;
  }
  
  try {
    accessSync(binaryPath, constants.F_OK | constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add Rust core to PATH
 */
function setupRustPath() {
  const cargoBinPath = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.cargo', 'bin');
  if (existsSync(cargoBinPath)) {
    if (!process.env.PATH.includes(cargoBinPath)) {
      process.env.PATH = `${cargoBinPath}:${process.env.PATH}`;
    }
  }
}

/**
 * Test platarium-cli binary
 */
async function testPlatariumCLI() {
  const possiblePaths = [
    path.join(__dirname, '../PlatariumCore/target/release/platarium-cli' + BINARY_EXT),
    path.join(__dirname, '../PlatariumCore/target/debug/platarium-cli' + BINARY_EXT),
    isWindows ? 'platarium-cli.exe' : 'platarium-cli',
  ];
  
  setupRustPath();
  
  for (const binaryPath of possiblePaths) {
    if (checkBinary(binaryPath) || binaryPath.includes('platarium-cli')) {
      try {
        const { stdout } = await execAsync(`"${binaryPath}" --help`, {
          env: { ...process.env },
          shell: isWindows,
        });
        log(colors.green, '✓ platarium-cli binary is working');
        return true;
      } catch (error) {
        // Try next path
        continue;
      }
    }
  }
  
  log(colors.red, '❌ platarium-cli binary not found or not working');
  return false;
}

/**
 * Test generate-mnemonic command
 */
async function testGenerateMnemonic() {
  const possiblePaths = [
    path.join(__dirname, '../PlatariumCore/target/release/platarium-cli'),
    path.join(__dirname, '../PlatariumCore/target/debug/platarium-cli'),
    'platarium-cli',
  ];
  
  setupRustPath();
  
  for (const binaryPath of possiblePaths) {
    if (checkBinary(binaryPath) || binaryPath === 'platarium-cli') {
      try {
        const { stdout, stderr } = await execAsync(`"${binaryPath}" generate-mnemonic`, {
          env: { ...process.env },
          maxBuffer: 1024 * 1024,
        });
        
        const output = stdout + stderr;
        if (output.includes('Mnemonic:') && output.includes('Alphanumeric:')) {
          log(colors.green, '✓ generate-mnemonic command works');
          return true;
        }
      } catch (error) {
        // Try next path
        continue;
      }
    }
  }
  
  log(colors.red, '❌ generate-mnemonic command failed');
  return false;
}

/**
 * Test generate-keys command
 */
async function testGenerateKeys() {
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
  const testAlphanumeric = 'TEST123456';
  
  const possiblePaths = [
    path.join(__dirname, '../PlatariumCore/target/release/platarium-cli' + BINARY_EXT),
    path.join(__dirname, '../PlatariumCore/target/debug/platarium-cli' + BINARY_EXT),
    isWindows ? 'platarium-cli.exe' : 'platarium-cli',
  ];
  
  setupRustPath();
  
  for (const binaryPath of possiblePaths) {
    if (checkBinary(binaryPath) || binaryPath.includes('platarium-cli')) {
      try {
        // Escape quotes for Windows
        const mnemonicEscaped = isWindows 
          ? testMnemonic.replace(/"/g, '\\"')
          : testMnemonic;
        const alphanumericEscaped = isWindows
          ? testAlphanumeric.replace(/"/g, '\\"')
          : testAlphanumeric;
        
        const { stdout, stderr } = await execAsync(
          `"${binaryPath}" generate-keys --mnemonic "${mnemonicEscaped}" --alphanumeric "${alphanumericEscaped}" --seed-index 0`,
          {
            env: { ...process.env },
            maxBuffer: 1024 * 1024,
            shell: isWindows,
          }
        );
        
        const output = stdout + stderr;
        if (output.includes('Public Key:') && output.includes('Private Key:')) {
          log(colors.green, '✓ generate-keys command works');
          return true;
        }
      } catch (error) {
        // Try next path
        continue;
      }
    }
  }
  
  log(colors.red, '❌ generate-keys command failed');
  return false;
}

/**
 * Main verification function
 */
async function main() {
  log(colors.cyan, '\n🧪 Verifying setup...\n');
  
  let allPassed = true;
  
  // Test 1: Check binary exists
  log(colors.cyan, '1. Checking platarium-cli binary...');
  const binaryOk = await testPlatariumCLI();
  if (!binaryOk) {
    allPassed = false;
  }
  
  // Test 2: Test generate-mnemonic
  log(colors.cyan, '\n2. Testing generate-mnemonic command...');
  const mnemonicOk = await testGenerateMnemonic();
  if (!mnemonicOk) {
    allPassed = false;
  }
  
  // Test 3: Test generate-keys
  log(colors.cyan, '\n3. Testing generate-keys command...');
  const keysOk = await testGenerateKeys();
  if (!keysOk) {
    allPassed = false;
  }
  
  console.log('');
  if (allPassed) {
    log(colors.green, '✅ All tests passed!\n');
    return 0;
  } else {
    log(colors.red, '❌ Some tests failed. Please check the setup.\n');
    return 1;
  }
}

// Run verification
main().then((exitCode) => {
  process.exit(exitCode);
}).catch((error) => {
  log(colors.red, `\n❌ Verification error: ${error.message}\n`);
  process.exit(1);
});
