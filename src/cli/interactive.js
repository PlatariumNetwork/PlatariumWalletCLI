import chalk from 'chalk';
import ora from 'ora';
import MessageStorage from '../messaging/messageStorage.js';
import { ask, PROMPT_SUFFIX } from './prompt.js';
import { exitWallet, clearTerminal } from './lifecycle.js';

function printAsciiArt() {
  console.log(chalk.blue.bold(`
█▀█ █░░ ▄▀█ ▀█▀ ▄▀█ █▀█ █ █░█ █▀▄▀█   █░█░█ ▄▀█ █░░ █░░ █▀▀ ▀█▀
█▀▀ █▄▄ █▀█ ░█░ █▀█ █▀▄ █ █▄█ █░▀░█   ▀▄▀▄▀ █▀█ █▄▄ █▄▄ ██▄ ░█░
`));
}

function normalizeMnemonic(input) {
  return input.trim().replace(/\s+/g, ' ');
}

function isValidMnemonic(input) {
  return normalizeMnemonic(input).split(' ').filter(Boolean).length === 24;
}

class InteractiveCLI {
  constructor(walletManager, serverClient, messageStorage = null) {
    this.walletManager = walletManager;
    this.serverClient = serverClient;
    this.messageStorage = messageStorage || new MessageStorage();
    this.currentDialogAddress = null;
    this.shouldRefreshDialog = false;
  }

  renderScreen() {
    console.clear();
    printAsciiArt();
    const wallet = this.walletManager.getCurrentWallet();
    const lockStatus = this.walletManager.isUnlocked()
      ? chalk.green('unlocked')
      : chalk.yellow('locked');
    const walletLine = wallet
      ? chalk.cyan(` | ${wallet.name} (${wallet.address})`)
      : '';
    console.log(chalk.gray(`Session: ${lockStatus}${walletLine}\n`));
  }

  async promptPassword(message = `Wallet password${PROMPT_SUFFIX}`) {
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

  /** @returns {Promise<boolean>} */
  async ensureUnlocked() {
    if (this.walletManager.isUnlocked()) return true;
    return this.promptSessionUnlock();
  }

  /**
   * Gate: password required before the main menu.
   * First launch → create password. Existing vault → unlock or forgot-password flow.
   * @returns {Promise<boolean>} false if user chose exit
   */
  async promptSessionUnlock() {
    if (this.walletManager.isUnlocked()) return true;

    const status = await this.walletManager.getStorageStatus();
    const hasWallets = this.walletManager.hasAnyStoredWallets(status);
    let needsUnlock = status.encrypted > 0;

    this.renderScreen();

    if (!hasWallets) {
      console.log(chalk.cyan('Welcome! Create a password to encrypt your wallets.\n'));
    } else if (status.encrypted > 0) {
      console.log(chalk.cyan('Enter your password to unlock the wallet menu.\n'));
    } else if (status.backup > 0) {
      console.log(
        chalk.yellow(
          `Wallet backup found (${status.backup} account(s)). Vault was reset - restore with your previous password.\n`,
        ),
      );
    } else if (status.legacy > 0) {
      console.log(
        chalk.cyan(
          `Found ${status.legacy} unencrypted wallet(s). Create a password to secure them.\n`,
        ),
      );
    }

    while (true) {
      if (status.encrypted === 0 && status.backup > 0) {
        const { action } = await ask([
          {
            type: 'list',
            name: 'action',
            message: 'Wallet backup found:',
            choices: [
              { name: '🔓 Restore from backup (previous password)', value: 'restore-backup' },
              { name: '🆕 Start fresh (new password, backup kept)', value: 'fresh' },
              { name: '❌ Exit', value: 'exit' },
            ],
          },
        ]);

        if (action === 'exit') return false;
        if (action === 'restore-backup') {
          try {
            const count = await this.walletManager.restoreFromBackup();
            console.log(chalk.green(`✓ Restored ${count} wallet(s) from backup.\n`));
            needsUnlock = true;
            status.encrypted = count;
          } catch (error) {
            console.log(chalk.red(`Restore failed: ${error.message}\n`));
            continue;
          }
        } else {
          needsUnlock = false;
          console.log(chalk.cyan('Create a new vault password.\n'));
        }
      } else if (needsUnlock) {
        const { action } = await ask([
          {
            type: 'list',
            name: 'action',
            message: 'Unlock session:',
            choices: [
              { name: '🔓 Enter password', value: 'password' },
              { name: '🔑 Forgot password - reset and restore', value: 'forgot' },
              { name: '❌ Exit', value: 'exit' },
            ],
          },
        ]);

        if (action === 'exit') return false;
        if (action === 'forgot') {
          const ok = await this.handleForgotPassword({ thenRestore: true });
          if (ok) return true;
          this.renderScreen();
          console.log(chalk.cyan('Enter your password to unlock the wallet menu.\n'));
          continue;
        }
      }

      if (!needsUnlock && !hasWallets) {
        const password = await this.promptPassword(`Create wallet password${PROMPT_SUFFIX}`);
        const confirm = await this.promptPassword(`Confirm wallet password${PROMPT_SUFFIX}`);
        if (password !== confirm) {
          console.log(chalk.red('Passwords do not match. Try again.\n'));
          continue;
        }
        try {
          await this.walletManager.unlock(password);
          await this.walletManager.migrateLegacyWallets(password);
          console.log(chalk.green('✓ Password created. You can now create or restore a wallet.\n'));
          return true;
        } catch (error) {
          console.log(chalk.red(`Failed: ${error.message}\n`));
        }
      } else if (!needsUnlock && hasWallets && status.encrypted === 0) {
        // Start fresh after choosing not to restore backup
        const password = await this.promptPassword(`Create new vault password${PROMPT_SUFFIX}`);
        const confirm = await this.promptPassword(`Confirm new vault password${PROMPT_SUFFIX}`);
        if (password !== confirm) {
          console.log(chalk.red('Passwords do not match. Try again.\n'));
          continue;
        }
        try {
          await this.walletManager.unlock(password);
          await this.walletManager.migrateLegacyWallets(password);
          console.log(chalk.green('✓ New vault password set.\n'));
          return true;
        } catch (error) {
          console.log(chalk.red(`Failed: ${error.message}\n`));
        }
      } else {
        const password = await this.promptPassword(
          `Enter password to unlock wallets${PROMPT_SUFFIX}`,
        );
        try {
          await this.walletManager.unlock(password);
          const migrated = await this.walletManager.migrateLegacyWallets(password);
          if (migrated > 0) {
            console.log(chalk.green(`✓ Migrated ${migrated} legacy wallet(s) to encrypted storage`));
          }
          console.log(chalk.green('✓ Session unlocked.\n'));
          return true;
        } catch {
          console.log(chalk.red('Wrong password.\n'));
        }
      }
    }
  }

  async promptRestoreCredentials() {
    console.log(chalk.cyan('\nEnter your recovery phrase (from backup when wallet was created):\n'));

    const answers = await ask([
      {
        type: 'input',
        name: 'name',
        message: 'Wallet name:',
        validate: (input) => input.length > 0 || 'Name cannot be empty',
      },
      {
        type: 'input',
        name: 'mnemonic',
        message: 'Mnemonic (24 words, paste allowed):',
        validate: (input) => isValidMnemonic(input) || 'Mnemonic must be exactly 24 words',
        filter: (input) => normalizeMnemonic(input),
      },
      {
        type: 'input',
        name: 'alphanumeric',
        message: 'Alphanumeric code (12 characters):',
        validate: (input) => input.trim().length === 12 || 'Alphanumeric code must be 12 characters',
        filter: (input) => input.trim().toUpperCase(),
      },
      {
        type: 'number',
        name: 'seedIndex',
        message: 'Seed index (0 = first account):',
        default: 0,
      },
    ]);

    return answers;
  }

  async performRestore(name, mnemonic, alphanumeric, seedIndex) {
    const spinner = ora('Restoring wallet...').start();
    try {
      const wallet = await this.walletManager.restoreWallet(
        name,
        mnemonic,
        alphanumeric,
        seedIndex,
      );
      spinner.succeed('Wallet restored successfully!');
      console.log(chalk.green('\n✓ Wallet Details:'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));
      console.log(chalk.cyan(`  Seed index: ${wallet.seedIndex}`));

      try {
        await this.serverClient.ensureConnected();
        await this.serverClient.registerAddress(wallet.address);
        console.log(chalk.green('✓ Address registered for messaging'));
      } catch {
        console.log(chalk.yellow('⚠️  Address registration for messaging failed'));
      }
      return true;
    } catch (error) {
      spinner.fail(`Failed to restore wallet: ${error.message}`);
      return false;
    }
  }

  /**
   * @param {{ thenRestore?: boolean }} options
   * @returns {Promise<boolean>}
   */
  async handleForgotPassword(options = {}) {
    const { thenRestore = false } = options;

    console.log(chalk.yellow('\n⚠️  Vault password cannot be recovered from this computer.'));
    console.log(chalk.white('   Your funds remain on the blockchain.'));
    console.log(chalk.white('   Only local encrypted files will be removed.\n'));

    if (thenRestore) {
      console.log(chalk.cyan('   Next steps:'));
      console.log(chalk.white('   1. Clear local vault'));
      console.log(chalk.white('   2. Set a new password'));
      console.log(chalk.white('   3. Enter mnemonic + alphanumeric + seed index\n'));
    } else {
      console.log(chalk.white('   After reset you can restore with:'));
      console.log(chalk.white('   • 24-word mnemonic'));
      console.log(chalk.white('   • 12-character alphanumeric code'));
      console.log(chalk.white('   • seed index (usually 0)\n'));
    }

    const { confirm } = await ask([
      {
        type: 'confirm',
        name: 'confirm',
        message: thenRestore
          ? 'Delete local vault and continue to restore wallet'
          : 'Delete local encrypted vault on this device',
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.yellow('Cancelled.'));
      return false;
    }

    const spinner = ora('Resetting vault...').start();
    try {
      const { backupPath } = await this.walletManager.resetVault();
      spinner.succeed('Local vault cleared.');
      if (backupPath) {
        console.log(chalk.gray(`   Backup saved: ${backupPath}`));
      }
    } catch (error) {
      spinner.fail(`Reset failed: ${error.message}`);
      return false;
    }

    console.log(chalk.cyan('\nSet a new password for the restored wallet:\n'));
    if (!(await this.ensureUnlocked())) {
      return false;
    }

    if (thenRestore) {
      const { name, mnemonic, alphanumeric, seedIndex } = await this.promptRestoreCredentials();
      return this.performRestore(name, mnemonic, alphanumeric, seedIndex);
    }

    console.log(chalk.green('✓ Ready. Use "Restore wallet from mnemonic" in the menu.\n'));
    return true;
  }

  async onNewMessage(from, to, text, timestamp) {
    const currentWallet = this.walletManager.getCurrentWallet();

    if (
      this.currentDialogAddress &&
      this.currentDialogAddress === from &&
      currentWallet &&
      to === currentWallet.address
    ) {
      this.shouldRefreshDialog = true;
      process.stdout.write(chalk.gray('  (New message received - refresh to view)\n'));
      return;
    }

    if (currentWallet && to === currentWallet.address) {
      console.log(chalk.green('\n📩 New message received!'));
      console.log(chalk.cyan(`  From: ${from || 'Unknown'}`));
      console.log(chalk.cyan(`  Message: ${text || ''}`));
      if (timestamp) {
        console.log(chalk.gray(`  Time: ${new Date(timestamp).toLocaleString()}`));
      }
      console.log(chalk.yellow('  💡 Go to Messages menu to view and reply\n'));
    }
  }

  async showMainMenu() {
    let unreadCount = 0;
    const currentWallet = this.walletManager.getCurrentWallet();
    if (currentWallet) {
      try {
        unreadCount = await this.messageStorage.getUnreadCount(currentWallet.address);
      } catch {
        // silent
      }
    }

    const messagesLabel =
      unreadCount > 0 ? `💬 Messages (${unreadCount} new)` : '💬 Messages';

    const { action } = await ask([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do:',
        choices: [
          { name: '📝 Create new wallet', value: 'create' },
          { name: '🔑 Restore wallet from mnemonic', value: 'restore' },
          { name: '➕ Add HD account', value: 'add-account' },
          { name: '📂 Load existing wallet', value: 'load' },
          { name: '📋 List all wallets', value: 'list' },
          { name: '🔐 Export recovery secrets', value: 'secrets' },
          { name: '🗑️  Delete wallet', value: 'delete' },
          { name: '🔒 Lock wallet', value: 'lock-toggle' },
          { name: '💰 Check balance', value: 'balance' },
          { name: '📤 Send transaction', value: 'send' },
          { name: '📜 View transactions', value: 'transactions' },
          { name: messagesLabel, value: 'messages' },
          { name: '🌐 Network status', value: 'network' },
          { name: '⚙️  RPC settings', value: 'settings' },
          { name: '❌ Exit', value: 'exit' },
        ],
      },
    ]);

    return action;
  }

  async handleCreateWallet() {
    const { name, seedIndex } = await ask([
      {
        type: 'input',
        name: 'name',
        message: 'Wallet name:',
        validate: (input) => input.length > 0 || 'Name cannot be empty',
      },
      {
        type: 'number',
        name: 'seedIndex',
        message: 'Seed index (default 0):',
        default: 0,
      },
    ]);

    const spinner = ora('Creating wallet...').start();
    try {
      const wallet = await this.walletManager.createWallet(name, seedIndex);
      spinner.succeed('Wallet created successfully!');
      console.log(chalk.green('\n✓ Wallet Details:'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));
      console.log(chalk.yellow('\n⚠️  Save your recovery phrase securely!'));
      console.log(chalk.white(`  Mnemonic: ${wallet.mnemonic}`));
      console.log(chalk.white(`  Alphanumeric: ${wallet.alphanumeric}`));
    } catch (error) {
      spinner.fail(`Failed to create wallet: ${error.message}`);
    }
  }

  async handleRestoreWallet() {
    const { name, mnemonic, alphanumeric, seedIndex } = await this.promptRestoreCredentials();
    await this.performRestore(name, mnemonic, alphanumeric, seedIndex);
  }

  async handleAddAccount() {
    const wallets = await this.walletManager.listWallets();
    if (wallets.length === 0) {
      console.log(chalk.yellow('No wallets found. Create or restore one first.'));
      return;
    }

    const { sourceId, name, useAutoIndex, seedIndex } = await ask([
      {
        type: 'list',
        name: 'sourceId',
        message: 'Source wallet (same seed):',
        choices: wallets.map((w) => ({
          name: `${w.name} (index ${w.seedIndex ?? 0})`,
          value: w.id,
        })),
      },
      {
        type: 'input',
        name: 'name',
        message: 'New account name:',
        validate: (input) => input.length > 0 || 'Name cannot be empty',
      },
      {
        type: 'confirm',
        name: 'useAutoIndex',
        message: 'Auto-assign next seed index',
        default: true,
      },
      {
        type: 'number',
        name: 'seedIndex',
        message: 'Seed index:',
        default: 0,
        when: (answers) => !answers.useAutoIndex,
      },
    ]);

    const spinner = ora('Creating account...').start();
    try {
      const index = useAutoIndex ? undefined : seedIndex;
      const wallet = await this.walletManager.addAccount(name, sourceId, index);
      spinner.succeed('Account created!');
      console.log(chalk.green('\n✓ Account Details:'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));
      console.log(chalk.cyan(`  Seed index: ${wallet.seedIndex}`));
    } catch (error) {
      spinner.fail(`Failed to add account: ${error.message}`);
    }
  }

  async handleExportSecrets() {
    const wallets = await this.walletManager.listWallets();
    if (wallets.length === 0) {
      console.log(chalk.yellow('No wallets found.'));
      return;
    }

    const { walletId } = await ask([
      {
        type: 'list',
        name: 'walletId',
        message: 'Select wallet:',
        choices: wallets.map((w) => ({
          name: `${w.name} (${w.address})`,
          value: w.id,
        })),
      },
    ]);

    try {
      const secrets = await this.walletManager.getWalletSecrets(walletId);
      console.log(chalk.yellow('\n⚠️  Recovery secrets - keep private!'));
      console.log(chalk.white(`  Mnemonic: ${secrets.mnemonic}`));
      console.log(chalk.white(`  Alphanumeric: ${secrets.alphanumeric}`));
      console.log(chalk.white(`  Seed index: ${secrets.seedIndex}`));
    } catch (error) {
      console.log(chalk.red(`Failed to export secrets: ${error.message}`));
    }
  }

  async handleDeleteWallet() {
    const wallets = await this.walletManager.listWallets();
    if (wallets.length === 0) {
      console.log(chalk.yellow('No wallets found.'));
      return;
    }

    const { walletId, confirm } = await ask([
      {
        type: 'list',
        name: 'walletId',
        message: 'Select wallet to delete:',
        choices: wallets.map((w) => ({
          name: `${w.name} (${w.address})`,
          value: w.id,
        })),
      },
      {
        type: 'confirm',
        name: 'confirm',
        message: 'This cannot be undone. Confirm deletion',
        default: false,
      },
    ]);

    if (!confirm) return;

    const spinner = ora('Deleting wallet...').start();
    try {
      await this.walletManager.deleteWallet(walletId);
      spinner.succeed('Wallet deleted');
    } catch (error) {
      spinner.fail(`Failed to delete wallet: ${error.message}`);
    }
  }

  async handleSettings() {
    const currentRpc = this.walletManager.getRpcUrl();
    const { rpcUrl } = await ask([
      {
        type: 'input',
        name: 'rpcUrl',
        message: 'RPC base URL:',
        default: currentRpc,
        validate: (input) => input.startsWith('http') || 'Must be a valid HTTP(S) URL',
      },
    ]);
    await this.walletManager.setRpcUrl(rpcUrl);
    this.serverClient.restBaseUrl = rpcUrl;
    console.log(chalk.green(`✓ RPC URL set to ${rpcUrl}`));
  }

  async handleLoadWallet() {
    const wallets = await this.walletManager.listWallets();
    if (wallets.length === 0) {
      console.log(chalk.yellow('No wallets found. Create one first.'));
      return;
    }

    const { walletId } = await ask([
      {
        type: 'list',
        name: 'walletId',
        message: 'Select wallet to load:',
        choices: wallets.map((w) => ({
          name: `${w.name} (${w.address}) [index ${w.seedIndex ?? 0}]`,
          value: w.id,
        })),
      },
    ]);

    const spinner = ora('Loading wallet...').start();
    try {
      const wallet = await this.walletManager.loadWallet(walletId);
      spinner.succeed('Wallet loaded successfully!');
      console.log(chalk.green('\n✓ Wallet Details:'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));

      try {
        await this.serverClient.ensureConnected();
        await this.serverClient.registerAddress(wallet.address);
        console.log(chalk.green('✓ Address registered for messaging'));
      } catch {
        console.log(chalk.yellow('⚠️  Address registration for messaging failed'));
      }
    } catch (error) {
      spinner.fail(`Failed to load wallet: ${error.message}`);
    }
  }

  async handleListWallets() {
    const spinner = ora('Loading wallets...').start();
    try {
      const wallets = await this.walletManager.listWallets();
      spinner.stop();

      if (wallets.length === 0) {
        console.log(chalk.yellow('No wallets found.'));
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
      spinner.fail(`Failed to list wallets: ${error.message}`);
    }
  }

  async handleCheckBalance() {
    const wallet = this.walletManager.getCurrentWallet();
    if (!wallet) {
      console.log(chalk.yellow('No wallet loaded. Please load a wallet first.'));
      return;
    }

    const spinner = ora('Checking balance...').start();
    try {
      const balance = await this.serverClient.getBalance(wallet.address);
      spinner.succeed('Balance retrieved!');
      console.log(chalk.green(`\n💰 Balance: ${balance} PLP`));
      console.log(chalk.cyan(`   Address: ${wallet.address}`));
    } catch (error) {
      spinner.fail(`Failed to check balance: ${error.message}`);
    }
  }

  async handleSendTransaction() {
    const wallet = this.walletManager.getCurrentWallet();
    if (!wallet) {
      console.log(chalk.yellow('No wallet loaded. Please load a wallet first.'));
      return;
    }

    const { to, amount, asset, tokenId, fee, nonce, memo } = await ask([
      {
        type: 'input',
        name: 'to',
        message: 'Recipient address:',
        validate: (input) => input.length > 0 || 'Address cannot be empty',
      },
      {
        type: 'input',
        name: 'amount',
        message: 'Amount:',
        validate: (input) => {
          const num = parseFloat(input);
          return (!isNaN(num) && num > 0) || 'Amount must be a positive number';
        },
      },
      {
        type: 'list',
        name: 'asset',
        message: 'Asset:',
        choices: [
          { name: 'PLP', value: 'PLP' },
          { name: 'Custom token', value: 'token' },
        ],
      },
      {
        type: 'input',
        name: 'tokenId',
        message: 'Token ID (without Token: prefix):',
        when: (answers) => answers.asset === 'token',
        validate: (input) => input.length > 0 || 'Token ID required',
      },
      {
        type: 'input',
        name: 'fee',
        message: 'Fee (uPLP):',
        default: '1000',
      },
      {
        type: 'number',
        name: 'nonce',
        message: 'Nonce:',
        default: 1,
      },
      {
        type: 'input',
        name: 'memo',
        message: 'Memo (optional):',
      },
    ]);

    const assetValue = asset === 'token' ? `Token:${tokenId}` : 'PLP';
    const writes = memo ? [`memo:${memo}`] : [];
    const tx = {
      from: wallet.address,
      to,
      asset: assetValue,
      amount,
      fee_uplp: fee,
      nonce,
      reads: [],
      writes,
    };

    const spinner = ora('Signing and sending transaction...').start();
    try {
      const signedTx = await this.walletManager.signGatewayTx(tx);
      const result = await this.serverClient.sendTransaction(signedTx);
      spinner.succeed('Transaction sent successfully!');
      console.log(chalk.green('\n✓ Transaction Details:'));
      console.log(chalk.cyan(`  Hash: ${signedTx.hash || result.transaction?.hash || 'N/A'}`));
      console.log(chalk.cyan(`  From: ${signedTx.from}`));
      console.log(chalk.cyan(`  To: ${signedTx.to}`));
      console.log(chalk.cyan(`  Amount: ${signedTx.amount} ${signedTx.asset}`));
      console.log(chalk.cyan(`  Fee: ${signedTx.fee_uplp} uPLP`));
    } catch (error) {
      spinner.fail(`Failed to send transaction: ${error.message}`);
    }
  }

  async handleViewTransactions() {
    const wallet = this.walletManager.getCurrentWallet();
    if (!wallet) {
      console.log(chalk.yellow('No wallet loaded. Please load a wallet first.'));
      return;
    }

    const spinner = ora('Loading transactions...').start();
    try {
      const transactions = await this.serverClient.getTransactions(wallet.address);
      spinner.stop();

      if (transactions.length === 0) {
        console.log(chalk.yellow('No transactions found.'));
        return;
      }

      console.log(chalk.green(`\n📜 Transactions (${transactions.length}):`));
      transactions.forEach((tx, i) => {
        console.log(chalk.cyan(`\n  ${i + 1}. ${tx.hash || 'N/A'}`));
        console.log(chalk.white(`     From: ${tx.from}`));
        console.log(chalk.white(`     To: ${tx.to}`));
        console.log(chalk.white(`     Amount: ${tx.value} PLP`));
        console.log(chalk.gray(`     Time: ${new Date(tx.timestamp * 1000).toLocaleString()}`));
      });
    } catch (error) {
      spinner.fail(`Failed to load transactions: ${error.message}`);
    }
  }

  async handleNetworkStatus() {
    const spinner = ora('Checking network status...').start();
    try {
      const status = await this.serverClient.getDetailedStatus();
      spinner.succeed('Network status retrieved!');
      console.log(chalk.green('\n🌐 Network Status:'));
      console.log(chalk.cyan(`  Status: ${status.status}`));
      console.log(chalk.cyan(`  Node ID: ${status.nodeId}`));
      console.log(chalk.cyan(`  Connected Peers: ${status.connectedPeers}`));
      console.log(chalk.cyan(`  Connected Clients: ${status.summary?.connectedClients || 0}`));
    } catch (error) {
      spinner.fail(`Failed to get network status: ${error.message}`);
    }
  }

  async run() {
    // Clear npm prestart output from the screen only (wallet files are untouched).
    clearTerminal();

    try {
      await this.messageStorage.init();
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Message storage initialization failed: ${error.message}`));
    }

    while (true) {
      if (!this.walletManager.isUnlocked()) {
        const unlocked = await this.promptSessionUnlock();
        if (!unlocked) {
          exitWallet(0);
          return;
        }
      }

      this.renderScreen();
      const action = await this.showMainMenu();

      if (action === 'exit') {
        exitWallet(0);
        return;
      }

      if (action === 'lock-toggle') {
        this.walletManager.lock();
        console.log(chalk.green('\n✓ Wallet locked'));
        continue;
      }

      console.log('');
      try {
        switch (action) {
          case 'create':
            await this.handleCreateWallet();
            break;
          case 'restore':
            await this.handleRestoreWallet();
            break;
          case 'add-account':
            await this.handleAddAccount();
            break;
          case 'load':
            await this.handleLoadWallet();
            break;
          case 'list':
            await this.handleListWallets();
            break;
          case 'secrets':
            await this.handleExportSecrets();
            break;
          case 'delete':
            await this.handleDeleteWallet();
            break;
          case 'balance':
            await this.handleCheckBalance();
            break;
          case 'send':
            await this.handleSendTransaction();
            break;
          case 'transactions':
            await this.handleViewTransactions();
            break;
          case 'network':
            await this.handleNetworkStatus();
            break;
          case 'messages':
            await this.handleMessages();
            break;
          case 'settings':
            await this.handleSettings();
            break;
        }
      } catch (error) {
        console.error(chalk.red(`\n✗ Error: ${error.message}`));
      }

      await ask([
        {
          type: 'input',
          name: 'continue',
          message: 'Press Enter to return to menu:',
        },
      ]).catch(() => {});
    }
  }

  async handleMessages() {
    const wallet = this.walletManager.getCurrentWallet();
    if (!wallet) {
      console.log(chalk.yellow('No wallet loaded. Please load a wallet first.'));
      return;
    }

    while (true) {
      const dialogs = await this.messageStorage.getDialogs(wallet.address);
      const choices = [
        { name: '📝 New message', value: 'new' },
        ...dialogs
          .filter((d) => d.otherParticipant)
          .map((d) => ({
            name: `${d.unreadCount > 0 ? '🔴 ' : ''}${(d.otherParticipant || '').substring(0, 20)}…`,
            value: d.otherParticipant,
          })),
        { name: '⬅️  Back', value: 'back' },
      ];

      const { action } = await ask([
        {
          type: 'list',
          name: 'action',
          message: 'Select dialog or action:',
          choices,
        },
      ]);

      if (action === 'back') break;
      if (action === 'new') await this.handleNewMessage(wallet.address);
      else await this.handleOpenDialog(wallet.address, action);
    }
  }

  async handleNewMessage(fromAddress) {
    const { to, text } = await ask([
      {
        type: 'input',
        name: 'to',
        message: 'Recipient address:',
        validate: (input) => input.length > 0 || 'Address cannot be empty',
      },
      {
        type: 'input',
        name: 'text',
        message: 'Message:',
        validate: (input) => input.length > 0 || 'Message cannot be empty',
      },
    ]);

    const spinner = ora('Sending message...').start();
    try {
      await this.serverClient.ensureConnected();
      await this.serverClient.registerAddress(fromAddress);
      await this.serverClient.sendMessage(fromAddress, to, text);
      await this.messageStorage.addMessage(fromAddress, to, text, Date.now());
      spinner.succeed('Message sent successfully!');
    } catch (error) {
      spinner.fail(`Failed to send message: ${error.message}`);
    }
  }

  async handleOpenDialog(currentAddress, otherAddress) {
    await this.messageStorage.markAsRead(currentAddress, otherAddress, currentAddress);
    this.currentDialogAddress = otherAddress;
    let lastMessageCount = 0;

    while (true) {
      if (this.shouldRefreshDialog && this.currentDialogAddress === otherAddress) {
        this.shouldRefreshDialog = false;
        lastMessageCount = 0;
      }

      const messages = await this.messageStorage.getMessages(currentAddress, otherAddress, 50);
      await this.messageStorage.markAsRead(currentAddress, otherAddress, currentAddress);
      lastMessageCount = messages.length;
      messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      const dialogMessages = messages.filter(
        (msg) =>
          msg &&
          msg.from &&
          msg.to &&
          ((msg.from === currentAddress && msg.to === otherAddress) ||
            (msg.from === otherAddress && msg.to === currentAddress)),
      );

      if (lastMessageCount === 0) lastMessageCount = dialogMessages.length;

      console.clear();
      printAsciiArt();
      console.log(chalk.cyan(`\n💬 Chat with ${(otherAddress || 'Unknown').substring(0, 30)}…\n`));
      console.log(chalk.gray('─'.repeat(60)));

      if (dialogMessages.length === 0) {
        console.log(chalk.yellow('  No messages yet. Start the conversation!\n'));
      } else {
        dialogMessages.forEach((msg) => {
          const isOwn = msg.from === currentAddress;
          const timeStr = new Date(msg.timestamp || Date.now()).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          });
          if (isOwn) {
            console.log(chalk.green(`  [${timeStr}] You:`));
          } else {
            console.log(chalk.blue(`  [${timeStr}] ${msg.from.substring(0, 20)}…:`));
          }
          console.log(chalk.white(`    ${msg.text || '(empty message)'}\n`));
        });
      }

      console.log(chalk.gray('─'.repeat(60)));

      const { action } = await ask([
        {
          type: 'list',
          name: 'action',
          message: 'Chat action:',
          choices: [
            { name: '🔄 Refresh messages', value: 'refresh' },
            { name: '✉️  Send message', value: 'send' },
            { name: '⬅️  Back to dialogs', value: 'back' },
          ],
        },
      ]);

      if (action === 'back') {
        this.currentDialogAddress = null;
        break;
      }
      if (action === 'refresh') {
        lastMessageCount = 0;
        continue;
      }
      if (action === 'send') {
        const { text } = await ask([
          {
            type: 'input',
            name: 'text',
            message: 'Message:',
            validate: (input) => input.length > 0 || 'Message cannot be empty',
          },
        ]);

        const spinner = ora('Sending message...').start();
        try {
          await this.serverClient.ensureConnected();
          await this.serverClient.registerAddress(currentAddress);
          await this.serverClient.sendMessage(currentAddress, otherAddress, text);
          await this.messageStorage.addMessage(currentAddress, otherAddress, text, Date.now());
          spinner.succeed('Message sent!');
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          spinner.fail(`Failed to send message: ${error.message}`);
        }
      }
    }
  }
}

export default InteractiveCLI;
