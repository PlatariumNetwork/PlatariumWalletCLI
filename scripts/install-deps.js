#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple console colors (no dependencies)
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function colorLog(color, ...args) {
  console.log(`${color}${args.join(' ')}${colors.reset}`);
}

/**
 * Print ASCII art header (without chalk dependency)
 */
function printAsciiArt() {
  colorLog(colors.blue + colors.bright, `
█▀█ █░░ ▄▀█ ▀█▀ ▄▀█ █▀█ █ █░█ █▀▄▀█   █░█░█ ▄▀█ █░░ █░░ █▀▀ ▀█▀
█▀▀ █▄▄ █▀█ ░█░ █▀█ █▀▄ █ █▄█ █░▀░█   ▀▄▀▄▀ █▀█ █▄▄ █▄▄ ██▄ ░█░
`);
}

/**
 * Check if node_modules exists
 */
function checkDependencies() {
  const nodeModulesPath = path.join(__dirname, '../node_modules');
  return existsSync(nodeModulesPath);
}

/**
 * Install dependencies
 */
async function installDependencies() {
  colorLog(colors.cyan, '\n📦 Installing dependencies...');
  colorLog(colors.gray, '   Running: npm install\n');
  
  try {
    execSync('npm install', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      maxBuffer: 10 * 1024 * 1024,
    });
    
    colorLog(colors.green, '\n✓ Dependencies installed successfully!\n');
    return true;
  } catch (error) {
    colorLog(colors.red, `\n❌ Failed to install dependencies: ${error.message}\n`);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const needsInstall = !checkDependencies();
  
  if (needsInstall) {
    // Show ASCII art once at the top
    printAsciiArt();
    colorLog(colors.cyan + colors.bright, '\n🚀 Platarium Wallet CLI - Setup\n');
    colorLog(colors.cyan, '📦 Installing npm dependencies...\n');
    // Mark that we've shown ASCII art
    process.env.PLATARIUM_ASCII_SHOWN = '1';
  }
  
  try {
    if (!needsInstall) {
      // Dependencies already installed, skip silently
      return;
    }
    
    await installDependencies();
  } catch (error) {
    colorLog(colors.red, `\n❌ Installation failed: ${error.message}\n`);
    process.exit(1);
  }
}

// Run if called directly
main().catch((error) => {
  colorLog(colors.red, `Fatal error: ${error.message}`);
  process.exit(1);
});

export { checkDependencies, installDependencies };
