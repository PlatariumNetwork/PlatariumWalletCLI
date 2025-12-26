#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { Command } from 'commander';
import RustCore from './core/rustCore.js';
import ServerClient from './api/serverClient.js';
import WalletManager from './wallet/walletManager.js';
import InteractiveCLI from './cli/interactive.js';
import MessageStorage from './messaging/messageStorage.js';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add Rust cargo to PATH if available
const cargoBinPath = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.cargo', 'bin');
if (cargoBinPath && existsSync(cargoBinPath)) {
  const currentPath = process.env.PATH || '';
  if (!currentPath.includes(cargoBinPath)) {
    process.env.PATH = `${cargoBinPath}:${currentPath}`;
  }
}

// Load configuration
let config;
try {
  const configPath = path.join(__dirname, '../config/default.json');
  const configData = await readFile(configPath, 'utf-8');
  config = JSON.parse(configData);
} catch (error) {
  console.error(chalk.red('Failed to load configuration:'), error.message);
  console.error(chalk.yellow('Please run: npm start (this will install everything automatically)'));
  process.exit(1);
}

// Initialize components
const rustCore = new RustCore(config);
const serverClient = new ServerClient(config);
const walletManager = new WalletManager(config, rustCore);
const messageStorage = new MessageStorage();
const interactiveCLI = new InteractiveCLI(walletManager, serverClient, messageStorage);

// Set up message handler once (global handler)
serverClient.on('message', async (data) => {
  try {
    const currentWallet = walletManager.getCurrentWallet();
    if (currentWallet && data.to === currentWallet.address) {
      const timestamp = data.timestamp ? data.timestamp * 1000 : Date.now();
      await messageStorage.addMessage(data.from, data.to, data.text, timestamp);
      // Notify interactive CLI (it will decide whether to show notification)
      await interactiveCLI.onNewMessage(data.from, data.to, data.text, timestamp);
    }
  } catch (error) {
    console.error(chalk.red(`Failed to save message: ${error.message}`));
  }
});

// CLI Program
const program = new Command();

program
  .name('platarium-wallet')
  .description('Platarium Wallet CLI - Node.js CLI using Rust Core and Go RPC server')
  .version('1.0.0');

// Interactive mode (default)
program
  .command('interactive')
  .alias('i')
  .description('Start interactive CLI')
  .action(async () => {
    try {
      // Check REST API connection (uses domain)
      console.log(chalk.cyan(`Checking REST API: ${config.server.rest.baseUrl}...`));
      await serverClient.healthCheck();
      console.log(chalk.green('✓ REST API is accessible!\n'));
      
      // Connect to WebSocket (uses IP)
      console.log(chalk.cyan(`Connecting to WebSocket: ${config.server.websocket.url}...`));
      try {
        await serverClient.connectWebSocket();
        console.log(chalk.green('✓ WebSocket connected!\n'));
        
        // Message handler is already set globally above
        
        // Register wallet address if wallet is loaded
        const currentWallet = walletManager.getCurrentWallet();
        if (currentWallet) {
          try {
            await serverClient.registerAddress(currentWallet.address);
            console.log(chalk.green(`✓ Registered address: ${currentWallet.address}\n`));
          } catch (regError) {
            console.log(chalk.yellow(`⚠️  Address registration failed: ${regError.message}\n`));
          }
        }
      } catch (wsError) {
        console.log(chalk.yellow(`⚠️  WebSocket connection failed: ${wsError.message}`));
        console.log(chalk.yellow('   Continuing with REST API only...\n'));
      }
      
      await interactiveCLI.run();
    } catch (error) {
      console.error(chalk.red(`\n✗ Failed to connect to server: ${error.message}`));
      console.error(chalk.yellow(`Make sure the Go server is running`));
      console.error(chalk.yellow(`  REST API: ${config.server.rest.baseUrl}`));
      console.error(chalk.yellow(`  WebSocket: ${config.server.websocket.url}`));
      process.exit(1);
    }
  });

// Create wallet
program
  .command('create')
  .description('Create a new wallet')
  .option('-n, --name <name>', 'Wallet name')
  .option('-i, --index <index>', 'Seed index', '0')
  .action(async (options) => {
    const name = options.name || `wallet_${Date.now()}`;
    const seedIndex = parseInt(options.index, 10);
    
    try {
      const wallet = await walletManager.createWallet(name, seedIndex);
      console.log(chalk.green('\n✓ Wallet created successfully!'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));
      console.log(chalk.yellow(`\n⚠️  IMPORTANT: Save your mnemonic phrase securely!`));
      console.log(chalk.white(`  Mnemonic: ${wallet.mnemonic}`));
      console.log(chalk.white(`  Alphanumeric: ${wallet.alphanumeric}`));
    } catch (error) {
      console.error(chalk.red(`Failed to create wallet: ${error.message}`));
      process.exit(1);
    }
  });

// Restore wallet
program
  .command('restore')
  .description('Restore wallet from mnemonic')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('-m, --mnemonic <mnemonic>', 'BIP39 mnemonic phrase')
  .requiredOption('-a, --alphanumeric <code>', 'Alphanumeric code')
  .option('-i, --index <index>', 'Seed index', '0')
  .action(async (options) => {
    const seedIndex = parseInt(options.index, 10);
    
    try {
      const wallet = await walletManager.restoreWallet(
        options.name,
        options.mnemonic,
        options.alphanumeric,
        seedIndex
      );
      console.log(chalk.green('\n✓ Wallet restored successfully!'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));
    } catch (error) {
      console.error(chalk.red(`Failed to restore wallet: ${error.message}`));
      process.exit(1);
    }
  });

// List wallets
program
  .command('list')
  .description('List all wallets')
  .action(async () => {
    try {
      const wallets = await walletManager.listWallets();
      
      if (wallets.length === 0) {
        console.log(chalk.yellow('No wallets found.'));
        return;
      }
      
      console.log(chalk.green('\n📂 Wallets:'));
      wallets.forEach((w, i) => {
        console.log(chalk.cyan(`  ${i + 1}. ${w.name}`));
        console.log(chalk.white(`     Address: ${w.address}`));
        console.log(chalk.gray(`     Created: ${w.createdAt}`));
      });
    } catch (error) {
      console.error(chalk.red(`Failed to list wallets: ${error.message}`));
      process.exit(1);
    }
  });

// Balance
program
  .command('balance')
  .description('Check wallet balance')
  .requiredOption('-a, --address <address>', 'Wallet address')
  .action(async (options) => {
    try {
      const balance = await serverClient.getBalance(options.address);
      console.log(chalk.green(`\n💰 Balance: ${balance} PLT`));
      console.log(chalk.cyan(`   Address: ${options.address}`));
    } catch (error) {
      console.error(chalk.red(`Failed to get balance: ${error.message}`));
      process.exit(1);
    }
  });

// Network status
program
  .command('status')
  .description('Get network status')
  .action(async () => {
    try {
      const status = await serverClient.getDetailedStatus();
      console.log(chalk.green('\n🌐 Network Status:'));
      console.log(chalk.cyan(`  Status: ${status.status}`));
      console.log(chalk.cyan(`  Node ID: ${status.nodeId}`));
      console.log(chalk.cyan(`  Connected Peers: ${status.connectedPeers}`));
      console.log(chalk.cyan(`  Connected Clients: ${status.summary?.connectedClients || 0}`));
    } catch (error) {
      console.error(chalk.red(`Failed to get network status: ${error.message}`));
      process.exit(1);
    }
  });

// Parse arguments
const args = process.argv.slice(2);

// If no arguments, default to interactive mode
if (args.length === 0) {
  // Run interactive mode directly
  (async () => {
    // Try to connect to server, but don't fail if unavailable
    try {
      // Check REST API connection (uses domain)
      console.log(chalk.cyan(`Checking REST API: ${config.server.rest.baseUrl}...`));
      await serverClient.healthCheck();
      console.log(chalk.green('✓ REST API is accessible!\n'));
      
      // Connect to WebSocket (uses IP)
      console.log(chalk.cyan(`Connecting to WebSocket: ${config.server.websocket.url}...`));
      try {
        await serverClient.connectWebSocket();
        console.log(chalk.green('✓ WebSocket connected!\n'));
        
        // Message handler is already set globally above
        
        // Register wallet address if wallet is loaded
        const currentWallet = walletManager.getCurrentWallet();
        if (currentWallet) {
          try {
            await serverClient.registerAddress(currentWallet.address);
            console.log(chalk.green(`✓ Registered address: ${currentWallet.address}\n`));
          } catch (regError) {
            console.log(chalk.yellow(`⚠️  Address registration failed: ${regError.message}\n`));
          }
        }
      } catch (wsError) {
        console.log(chalk.yellow(`⚠️  WebSocket connection failed: ${wsError.message}`));
        console.log(chalk.yellow('   Continuing with REST API only...\n'));
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️  REST API connection failed: ${error.message}`));
      console.log(chalk.yellow(`   You can still work with wallets offline.\n`));
      console.log(chalk.yellow(`   REST API: ${config.server.rest.baseUrl}`));
      console.log(chalk.yellow(`   WebSocket: ${config.server.websocket.url}\n`));
    }
    
    // Run interactive CLI regardless of server connection
    await interactiveCLI.run();
  })();
} else {
  // Parse commands normally
  program.parse();
}
