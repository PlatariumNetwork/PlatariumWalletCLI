#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { Command } from 'commander';
import { ask, PROMPT_SUFFIX } from './cli/prompt.js';
import ServerClient from './api/serverClient.js';
import WalletManager from './wallet/walletManager.js';
import InteractiveCLI from './cli/interactive.js';
import MessageStorage from './messaging/messageStorage.js';
import { connectWithSplash } from './cli/startup.js';
import { registerLifecycle, exitWallet } from './cli/lifecycle.js';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const walletManager = new WalletManager(config);
const serverClient = new ServerClient(config);
const messageStorage = new MessageStorage();
const interactiveCLI = new InteractiveCLI(walletManager, serverClient, messageStorage);
registerLifecycle({ serverClient, walletManager });

async function promptPassword(message = `Wallet password${PROMPT_SUFFIX}`) {
  const { password } = await ask([
    {
      type: 'password',
      name: 'password',
      message,
      mask: '*',
      validate: (input) => input.length >= 4 || 'Password must be at least 4 characters',
    },
  ]);
  return password;
}

async function ensureUnlocked() {
  if (walletManager.isUnlocked()) return;
  const password = await promptPassword();
  try {
    await walletManager.unlock(password);
    const migrated = await walletManager.migrateLegacyWallets(password);
    if (migrated > 0) {
      console.log(chalk.green(`✓ Migrated ${migrated} legacy wallet(s) to encrypted storage`));
    }
  } catch (error) {
    console.error(chalk.red(`Unlock failed: ${error.message}`));
    process.exit(1);
  }
}

// Set up message handler once (global handler)
serverClient.on('message', async (data) => {
  try {
    const currentWallet = walletManager.getCurrentWallet();
    if (currentWallet && data.to === currentWallet.address) {
      const timestamp = data.timestamp ? data.timestamp * 1000 : Date.now();
      await messageStorage.addMessage(data.from, data.to, data.text, timestamp);
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
  .description('Platarium Wallet CLI - console wallet for Platarium Network')
  .version('1.0.0');

program
  .command('interactive')
  .alias('i')
  .description('Start interactive CLI')
  .action(async () => {
    await startInteractive();
  });

program
  .command('unlock')
  .description('Unlock encrypted wallets with password')
  .action(async () => {
    const password = await promptPassword();
    try {
      await walletManager.unlock(password);
      const migrated = await walletManager.migrateLegacyWallets(password);
      console.log(chalk.green('✓ Wallet unlocked'));
      if (migrated > 0) {
        console.log(chalk.green(`✓ Migrated ${migrated} legacy wallet(s)`));
      }
    } catch (error) {
      console.error(chalk.red(`Unlock failed: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('lock')
  .description('Lock wallet session')
  .action(() => {
    walletManager.lock();
    console.log(chalk.green('✓ Wallet locked'));
  });

program
  .command('create')
  .description('Create a new wallet')
  .option('-n, --name <name>', 'Wallet name')
  .option('-i, --index <index>', 'Seed index', '0')
  .action(async (options) => {
    await ensureUnlocked();
    const name = options.name || `wallet_${Date.now()}`;
    const seedIndex = parseInt(options.index, 10);
    try {
      const wallet = await walletManager.createWallet(name, seedIndex);
      console.log(chalk.green('\n✓ Wallet created successfully!'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));
      console.log(chalk.cyan(`  Seed index: ${wallet.seedIndex}`));
      console.log(chalk.yellow(`\n⚠️  IMPORTANT: Save your recovery phrase securely!`));
      console.log(chalk.white(`  Mnemonic (24 words): ${wallet.mnemonic}`));
      console.log(chalk.white(`  Alphanumeric code: ${wallet.alphanumeric}`));
    } catch (error) {
      console.error(chalk.red(`Failed to create wallet: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('restore')
  .description('Restore wallet from mnemonic + alphanumeric + seed index')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('-m, --mnemonic <mnemonic>', 'BIP39 mnemonic phrase (24 words)')
  .requiredOption('-a, --alphanumeric <code>', 'Alphanumeric code (12 chars)')
  .option('-i, --index <index>', 'Seed index (HD account)', '0')
  .action(async (options) => {
    await ensureUnlocked();
    const seedIndex = parseInt(options.index, 10);
    try {
      const wallet = await walletManager.restoreWallet(
        options.name,
        options.mnemonic,
        options.alphanumeric,
        seedIndex,
      );
      console.log(chalk.green('\n✓ Wallet restored successfully!'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));
      console.log(chalk.cyan(`  Seed index: ${wallet.seedIndex}`));
    } catch (error) {
      console.error(chalk.red(`Failed to restore wallet: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('add-account')
  .description('Add HD account from existing seed')
  .requiredOption('-n, --name <name>', 'Account name')
  .option('-s, --source <id>', 'Source wallet ID')
  .option('-i, --index <index>', 'Seed index (auto if omitted)')
  .action(async (options) => {
    await ensureUnlocked();
    try {
      const seedIndex = options.index !== undefined ? parseInt(options.index, 10) : undefined;
      const wallet = await walletManager.addAccount(options.name, options.source, seedIndex);
      console.log(chalk.green('\n✓ Account created!'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));
      console.log(chalk.cyan(`  Seed index: ${wallet.seedIndex}`));
    } catch (error) {
      console.error(chalk.red(`Failed to add account: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('delete')
  .description('Delete a wallet')
  .requiredOption('-i, --id <id>', 'Wallet ID')
  .action(async (options) => {
    await ensureUnlocked();
    const { confirm } = await ask([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'This cannot be undone. Confirm deletion',
        default: false,
      },
    ]);
    if (!confirm) return;
    try {
      await walletManager.deleteWallet(options.id);
      console.log(chalk.green('✓ Wallet deleted'));
    } catch (error) {
      console.error(chalk.red(`Failed to delete wallet: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('secrets')
  .description('Export wallet recovery secrets (requires unlock)')
  .requiredOption('-i, --id <id>', 'Wallet ID')
  .action(async (options) => {
    await ensureUnlocked();
    try {
      const secrets = await walletManager.getWalletSecrets(options.id);
      console.log(chalk.yellow('\n⚠️  Recovery secrets - keep private!'));
      console.log(chalk.white(`  Mnemonic: ${secrets.mnemonic}`));
      console.log(chalk.white(`  Alphanumeric: ${secrets.alphanumeric}`));
      console.log(chalk.white(`  Seed index: ${secrets.seedIndex}`));
    } catch (error) {
      console.error(chalk.red(`Failed to export secrets: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all wallets')
  .action(async () => {
    try {
      const wallets = await walletManager.listWallets();
      if (wallets.length === 0) {
        console.log(chalk.yellow('No wallets found. Create or restore one first.'));
        return;
      }
      console.log(chalk.green('\n📂 Wallets:'));
      wallets.forEach((w, i) => {
        console.log(chalk.cyan(`  ${i + 1}. ${w.name}`));
        console.log(chalk.white(`     ID: ${w.id}`));
        console.log(chalk.white(`     Address: ${w.address}`));
        console.log(chalk.gray(`     Seed index: ${w.seedIndex ?? 0}`));
        console.log(chalk.gray(`     Created: ${w.createdAt}`));
      });
    } catch (error) {
      console.error(chalk.red(`Failed to list wallets: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('balance')
  .description('Check wallet balance')
  .requiredOption('-a, --address <address>', 'Wallet address')
  .action(async (options) => {
    try {
      const balance = await serverClient.getBalance(options.address);
      console.log(chalk.green(`\n💰 Balance: ${balance} PLP`));
      console.log(chalk.cyan(`   Address: ${options.address}`));
    } catch (error) {
      console.error(chalk.red(`Failed to get balance: ${error.message}`));
      process.exit(1);
    }
  });

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

async function exitApp(code = 0) {
  exitWallet(code);
}

async function prepareNetwork() {
  try {
    await connectWithSplash(serverClient, config);
    const currentWallet = walletManager.getCurrentWallet();
    if (currentWallet) {
      try {
        await serverClient.registerAddress(currentWallet.address);
      } catch {
        // messaging registration is optional
      }
    }
  } catch (error) {
    console.log(chalk.yellow(`\n  ⚠  Network unavailable: ${error.message}`));
    console.log(chalk.gray('  You can still manage wallets offline.\n'));
  }
}

async function startInteractive() {
  try {
    await prepareNetwork();
    await interactiveCLI.run();
    await exitApp(0);
  } catch (error) {
    console.error(chalk.red(`\n✗ Failed to start wallet: ${error.message}`));
    await exitApp(1);
  }
}

const args = process.argv.slice(2);

if (args.length === 0) {
  (async () => {
    await prepareNetwork();
    await interactiveCLI.run();
    await exitApp(0);
  })();
} else {
  program.parse();
}
