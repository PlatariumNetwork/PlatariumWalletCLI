import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import MessageStorage from '../messaging/messageStorage.js';

/**
 * Print ASCII art header
 */
function printAsciiArt() {
  console.log(chalk.blue.bold(`
█▀█ █░░ ▄▀█ ▀█▀ ▄▀█ █▀█ █ █░█ █▀▄▀█   █░█░█ ▄▀█ █░░ █░░ █▀▀ ▀█▀
█▀▀ █▄▄ █▀█ ░█░ █▀█ █▀▄ █ █▄█ █░▀░█   ▀▄▀▄▀ █▀█ █▄▄ █▄▄ ██▄ ░█░
`));
}

/**
 * Interactive CLI interface
 */
class InteractiveCLI {
  constructor(walletManager, serverClient, messageStorage = null) {
    this.walletManager = walletManager;
    this.serverClient = serverClient;
    this.messageStorage = messageStorage || new MessageStorage();
    this.pendingMessage = null; // Store pending message to open dialog
  }

  /**
   * Called when a new message is received
   */
  async onNewMessage(from, to, text, timestamp) {
    const currentWallet = this.walletManager.getCurrentWallet();
    
    // If we're in a dialog and message is from the same user we're chatting with
    if (this.currentDialogAddress && this.currentDialogAddress === from && currentWallet && to === currentWallet.address) {
      // Don't show notification - just set flag, dialog will refresh next time menu is shown
      this.shouldRefreshDialog = true;
      // Show subtle indicator that new message arrived
      process.stdout.write(chalk.gray('  (New message received - refresh to view)\n'));
      return;
    }
    
    // Otherwise show notification for messages from other users
    if (currentWallet && to === currentWallet.address) {
      console.log(chalk.green('\n📩 New message received!'));
      console.log(chalk.cyan(`  From: ${from || 'Unknown'}`));
      console.log(chalk.cyan(`  Message: ${text || ''}`));
      if (timestamp) {
        const date = new Date(timestamp);
        console.log(chalk.gray(`  Time: ${date.toLocaleString()}`));
      }
      console.log(chalk.yellow('  💡 Go to Messages menu to view and reply\n'));
    }
  }

  /**
   * Show main menu
   * @returns {Promise<string>}
   */
  async showMainMenu() {
    // Get unread count for current wallet
    let unreadCount = 0;
    const currentWallet = this.walletManager.getCurrentWallet();
    if (currentWallet) {
      try {
        unreadCount = await this.messageStorage.getUnreadCount(currentWallet.address);
      } catch (error) {
        // Silent fail
      }
    }
    
    const messagesLabel = unreadCount > 0 
      ? `💬 Messages (${unreadCount} new)`
      : '💬 Messages';
    
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '📝 Create new wallet', value: 'create' },
          { name: '🔑 Restore wallet from mnemonic', value: 'restore' },
          { name: '📂 Load existing wallet', value: 'load' },
          { name: '📋 List all wallets', value: 'list' },
          { name: '💰 Check balance', value: 'balance' },
          { name: '📤 Send transaction', value: 'send' },
          { name: '📜 View transactions', value: 'transactions' },
          { name: messagesLabel, value: 'messages' },
          { name: '🌐 Network status', value: 'network' },
          { name: '❌ Exit', value: 'exit' },
        ],
      },
    ]);
    
    return action;
  }

  /**
   * Handle create wallet
   */
  async handleCreateWallet() {
    const { name, seedIndex } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Wallet name:',
        validate: (input) => input.length > 0 || 'Name cannot be empty',
      },
      {
        type: 'number',
        name: 'seedIndex',
        message: 'Seed index (default: 0):',
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
      
      // Get unread messages count
      try {
        const unreadCount = await this.messageStorage.getUnreadCount(wallet.address);
        if (unreadCount > 0) {
          console.log(chalk.yellow(`  📩 Unread messages: ${unreadCount}`));
        } else {
          console.log(chalk.gray(`  📩 Unread messages: 0`));
        }
      } catch (error) {
        // Silent fail
      }
      
      console.log(chalk.yellow(`\n⚠️  IMPORTANT: Save your mnemonic phrase securely!`));
      console.log(chalk.white(`  Mnemonic: ${wallet.mnemonic}`));
      console.log(chalk.white(`  Alphanumeric: ${wallet.alphanumeric}`));
    } catch (error) {
      spinner.fail(`Failed to create wallet: ${error.message}`);
    }
  }

  /**
   * Handle restore wallet
   */
  async handleRestoreWallet() {
    const { name, mnemonic, alphanumeric, seedIndex } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Wallet name:',
        validate: (input) => input.length > 0 || 'Name cannot be empty',
      },
      {
        type: 'input',
        name: 'mnemonic',
        message: 'Mnemonic phrase (24 words):',
        validate: (input) => input.split(' ').length === 24 || 'Mnemonic must be 24 words',
      },
      {
        type: 'input',
        name: 'alphanumeric',
        message: 'Alphanumeric code:',
        validate: (input) => input.length > 0 || 'Alphanumeric code cannot be empty',
      },
      {
        type: 'number',
        name: 'seedIndex',
        message: 'Seed index (default: 0):',
        default: 0,
      },
    ]);
    
    const spinner = ora('Restoring wallet...').start();
    
    try {
      const wallet = await this.walletManager.restoreWallet(name, mnemonic, alphanumeric, seedIndex);
      spinner.succeed('Wallet restored successfully!');
      
      console.log(chalk.green('\n✓ Wallet Details:'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));
      
      // Get unread messages count
      try {
        const unreadCount = await this.messageStorage.getUnreadCount(wallet.address);
        if (unreadCount > 0) {
          console.log(chalk.yellow(`  📩 Unread messages: ${unreadCount}`));
        } else {
          console.log(chalk.gray(`  📩 Unread messages: 0`));
        }
      } catch (error) {
        // Silent fail
      }
      
      // Register address with WebSocket server
      try {
        // Ensure WebSocket is connected first
        await this.serverClient.ensureConnected();
        await this.serverClient.registerAddress(wallet.address);
        console.log(chalk.green('✓ Address registered for messaging'));
      } catch (regError) {
        // Try to reconnect and register
        try {
          console.log(chalk.yellow('   Attempting to reconnect...'));
          await this.serverClient.connectWebSocket();
          await this.serverClient.registerAddress(wallet.address);
          console.log(chalk.green('✓ Address registered for messaging'));
        } catch (retryError) {
          console.log(chalk.yellow(`⚠️  Address registration failed: ${retryError.message}`));
        }
      }
    } catch (error) {
      spinner.fail(`Failed to restore wallet: ${error.message}`);
    }
  }

  /**
   * Handle load wallet
   */
  async handleLoadWallet() {
    const wallets = await this.walletManager.listWallets();
    
    if (wallets.length === 0) {
      console.log(chalk.yellow('No wallets found. Create one first.'));
      return;
    }
    
    const { filename } = await inquirer.prompt([
      {
        type: 'list',
        name: 'filename',
        message: 'Select wallet to load:',
        choices: wallets.map(w => ({
          name: `${w.name} (${w.address.substring(0, 20)}...)`,
          value: w.filename,
        })),
      },
    ]);
    
    const spinner = ora('Loading wallet...').start();
    
    try {
      const wallet = await this.walletManager.loadWallet(filename);
      spinner.succeed('Wallet loaded successfully!');
      
      console.log(chalk.green('\n✓ Wallet Details:'));
      console.log(chalk.cyan(`  Name: ${wallet.name}`));
      console.log(chalk.cyan(`  Address: ${wallet.address}`));
      
      // Get unread messages count
      try {
        const unreadCount = await this.messageStorage.getUnreadCount(wallet.address);
        if (unreadCount > 0) {
          console.log(chalk.yellow(`  📩 Unread messages: ${unreadCount}`));
        } else {
          console.log(chalk.gray(`  📩 Unread messages: 0`));
        }
      } catch (error) {
        // Silent fail
      }
      
      // Register address with WebSocket server
      try {
        // Ensure WebSocket is connected first
        await this.serverClient.ensureConnected();
        await this.serverClient.registerAddress(wallet.address);
        console.log(chalk.green('✓ Address registered for messaging'));
      } catch (regError) {
        // Try to reconnect and register
        try {
          console.log(chalk.yellow('   Attempting to reconnect...'));
          await this.serverClient.connectWebSocket();
          await this.serverClient.registerAddress(wallet.address);
          console.log(chalk.green('✓ Address registered for messaging'));
        } catch (retryError) {
          console.log(chalk.yellow(`⚠️  Address registration failed: ${retryError.message}`));
        }
      }
    } catch (error) {
      spinner.fail(`Failed to load wallet: ${error.message}`);
    }
  }

  /**
   * Handle list wallets
   */
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
        console.log(chalk.white(`     Address: ${w.address}`));
        console.log(chalk.gray(`     Created: ${w.createdAt}`));
      });
    } catch (error) {
      spinner.fail(`Failed to list wallets: ${error.message}`);
    }
  }

  /**
   * Handle check balance
   */
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
      
      console.log(chalk.green(`\n💰 Balance: ${balance} PLT`));
      console.log(chalk.cyan(`   Address: ${wallet.address}`));
    } catch (error) {
      spinner.fail(`Failed to check balance: ${error.message}`);
      console.log(chalk.yellow('   Make sure the server is running and accessible.'));
    }
  }

  /**
   * Handle send transaction
   */
  async handleSendTransaction() {
    const wallet = this.walletManager.getCurrentWallet();
    
    if (!wallet) {
      console.log(chalk.yellow('No wallet loaded. Please load a wallet first.'));
      return;
    }
    
    const { to, amount, nonce } = await inquirer.prompt([
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
          return !isNaN(num) && num > 0 || 'Amount must be a positive number';
        },
      },
      {
        type: 'number',
        name: 'nonce',
        message: 'Nonce:',
        default: 1,
      },
    ]);
    
    const transaction = {
      from: wallet.address,
      to,
      amount,
      nonce,
      timestamp: Date.now(),
      type: 'transfer',
    };
    
    const spinner = ora('Signing and sending transaction...').start();
    
    try {
      const signedTx = await this.walletManager.signTransaction(transaction);
      const result = await this.serverClient.sendTransaction(signedTx);
      
      spinner.succeed('Transaction sent successfully!');
      
      console.log(chalk.green('\n✓ Transaction Details:'));
      console.log(chalk.cyan(`  Hash: ${result.transaction?.hash || 'N/A'}`));
      console.log(chalk.cyan(`  From: ${signedTx.from}`));
      console.log(chalk.cyan(`  To: ${signedTx.to}`));
      console.log(chalk.cyan(`  Amount: ${signedTx.amount} PLT`));
    } catch (error) {
      spinner.fail(`Failed to send transaction: ${error.message}`);
      console.log(chalk.yellow('   Make sure the server is running and accessible.'));
    }
  }

  /**
   * Handle view transactions
   */
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
        console.log(chalk.white(`     Amount: ${tx.value} PLT`));
        console.log(chalk.gray(`     Time: ${new Date(tx.timestamp * 1000).toLocaleString()}`));
      });
    } catch (error) {
      spinner.fail(`Failed to load transactions: ${error.message}`);
      console.log(chalk.yellow('   Make sure the server is running and accessible.'));
    }
  }

  /**
   * Handle network status
   */
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
      
      if (status.components) {
        console.log(chalk.yellow('\n  Components:'));
        Object.entries(status.components).forEach(([key, value]) => {
          const icon = value === 'ok' ? '✓' : '✗';
          const color = value === 'ok' ? chalk.green : chalk.red;
          console.log(color(`    ${icon} ${key}: ${value}`));
        });
      }
    } catch (error) {
      spinner.fail(`Failed to get network status: ${error.message}`);
      console.log(chalk.yellow('   Make sure the server is running and accessible.'));
    }
  }

  /**
   * Run interactive CLI loop
   */
  async run() {
    console.clear();
    printAsciiArt();
    
    // Initialize message storage
    try {
      await this.messageStorage.init();
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Message storage initialization failed: ${error.message}`));
    }
    
    while (true) {
      // Update menu to show unread count
      const action = await this.showMainMenu();
      
      if (action === 'exit') {
        console.log(chalk.yellow('\n👋 Goodbye!'));
        break;
      }
      
      try {
        switch (action) {
          case 'create':
            await this.handleCreateWallet();
            break;
          case 'restore':
            await this.handleRestoreWallet();
            break;
          case 'load':
            await this.handleLoadWallet();
            break;
          case 'list':
            await this.handleListWallets();
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
        }
      } catch (error) {
        console.error(chalk.red(`\n✗ Error: ${error.message}`));
      }
      
      console.log('\n');
    }
  }

  /**
   * Handle messages menu
   */
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
          .filter(d => d.otherParticipant) // Filter out dialogs without otherParticipant
          .map(d => ({
            name: `${d.unreadCount > 0 ? `🔴 ` : ''}${(d.otherParticipant || '').substring(0, 20)}... ${d.lastMessage && d.lastMessage.text ? `(${d.lastMessage.text.substring(0, 30)}...)` : '(No messages)'}`,
            value: d.otherParticipant,
          })),
        { name: '⬅️  Back', value: 'back' },
      ];

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'Select dialog or action:',
          choices,
        },
      ]);

      if (action === 'back') {
        break;
      } else if (action === 'new') {
        await this.handleNewMessage(wallet.address);
      } else {
        await this.handleOpenDialog(wallet.address, action);
      }
    }
  }

  /**
   * Handle new message
   */
  async handleNewMessage(fromAddress) {
    const { to, text } = await inquirer.prompt([
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
      // Ensure connection and register address before sending
      await this.serverClient.ensureConnected();
      await this.serverClient.registerAddress(fromAddress);
      
      // Send message via server
      await this.serverClient.sendMessage(fromAddress, to, text);
      
      // Save message locally
      const timestamp = Date.now();
      await this.messageStorage.addMessage(fromAddress, to, text, timestamp);
      
      spinner.succeed('Message sent successfully!');
    } catch (error) {
      spinner.fail(`Failed to send message: ${error.message}`);
      // If connection error, provide helpful message
      if (error.message.includes('WebSocket not connected') || error.message.includes('connect')) {
        console.log(chalk.yellow('   WebSocket connection issue. Make sure:'));
        console.log(chalk.yellow('   1. Go server is running'));
        console.log(chalk.yellow('   2. WebSocket URL is correct in config'));
        console.log(chalk.yellow('   3. Try restarting the application'));
      } else {
        console.log(chalk.yellow('   Make sure the server is running and recipient is online.'));
      }
    }
  }

  /**
   * Handle open dialog
   */
  async handleOpenDialog(currentAddress, otherAddress) {
    // Mark messages as read when opening dialog
    await this.messageStorage.markAsRead(currentAddress, otherAddress, currentAddress);
    
    // Set current dialog address to track if we're in this dialog
    this.currentDialogAddress = otherAddress;
    
    // Store last message count to detect new messages
    let lastMessageCount = 0;

    while (true) {
      // Check if we should refresh due to new message
      if (this.shouldRefreshDialog && this.currentDialogAddress === otherAddress) {
        this.shouldRefreshDialog = false;
        // Reset message count to show all messages including new ones
        lastMessageCount = 0;
      }
      
      // Get messages (re-fetch to include any new messages)
      // Always use consistent order: currentAddress, otherAddress
      const messages = await this.messageStorage.getMessages(currentAddress, otherAddress, 50);
      
      // Check if new messages arrived
      const hasNewMessages = messages.length > lastMessageCount;
      
      // Mark any new unread messages as read
      await this.messageStorage.markAsRead(currentAddress, otherAddress, currentAddress);
      
      // Update last message count
      lastMessageCount = messages.length;
      
      // Sort messages by timestamp to ensure correct order
      messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      
      // Filter messages to only show messages in this dialog
      // A message belongs to this dialog if it's between currentAddress and otherAddress
      // This ensures messages from other dialogs don't appear here
      const dialogMessages = messages.filter(msg => {
        if (!msg || !msg.from || !msg.to) return false;
        const from = msg.from;
        const to = msg.to;
        // Message is in this dialog if both addresses match (in either direction)
        return (from === currentAddress && to === otherAddress) ||
               (from === otherAddress && to === currentAddress);
      });
      
      // Update lastMessageCount based on filtered messages
      if (lastMessageCount === 0) {
        lastMessageCount = dialogMessages.length;
      }
      
      // Display chat history
      console.clear();
      console.log(chalk.cyan(`\n💬 Chat with ${(otherAddress || 'Unknown').substring(0, 30)}...\n`));
      console.log(chalk.gray('─'.repeat(60)));
      
      if (dialogMessages.length === 0) {
        console.log(chalk.yellow('  No messages yet. Start the conversation!\n'));
      } else {
        dialogMessages.forEach(msg => {
          if (!msg) return; // Skip invalid messages
          
          // Compare addresses exactly (case-sensitive)
          const isOwn = msg.from && msg.from === currentAddress;
          const date = new Date(msg.timestamp || Date.now());
          const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          
          if (isOwn) {
            console.log(chalk.green(`  [${timeStr}] You:`));
            console.log(chalk.white(`    ${msg.text || '(empty message)'}\n`));
          } else {
            const fromAddr = msg.from || 'Unknown';
            console.log(chalk.blue(`  [${timeStr}] ${fromAddr.substring(0, 20)}...:`));
            console.log(chalk.white(`    ${msg.text || '(empty message)'}\n`));
          }
        });
      }
      
      console.log(chalk.gray('─'.repeat(60)));

      // Check for new messages before showing prompt
      const currentMessageCount = dialogMessages.length;
      
      // Show prompt with refresh option
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: '🔄 Refresh messages', value: 'refresh' },
            { name: '✉️  Send message', value: 'send' },
            { name: '⬅️  Back to dialogs', value: 'back' },
          ],
        },
      ]);

      if (action === 'back') {
        // Clear current dialog tracking
        this.currentDialogAddress = null;
        break;
      } else if (action === 'refresh') {
        // Refresh dialog to show new messages
        // Reset message count to force refresh
        lastMessageCount = 0;
        continue; // Go back to start of loop
      } else if (action === 'send') {
        const { text } = await inquirer.prompt([
          {
            type: 'input',
            name: 'text',
            message: 'Message:',
            validate: (input) => input.length > 0 || 'Message cannot be empty',
          },
        ]);

        const spinner = ora('Sending message...').start();

        try {
          // Ensure connection and register address before sending
          await this.serverClient.ensureConnected();
          await this.serverClient.registerAddress(currentAddress);
          
          // Send message via server
          await this.serverClient.sendMessage(currentAddress, otherAddress, text);
          
          // Save message locally
          const timestamp = Date.now();
          await this.messageStorage.addMessage(currentAddress, otherAddress, text, timestamp);
          
          spinner.succeed('Message sent!');
          
          // Small delay to ensure message is saved
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Refresh dialog to show the new message immediately
          continue; // Go back to start of loop to refresh dialog
        } catch (error) {
          spinner.fail(`Failed to send message: ${error.message}`);
          // If connection error, suggest reconnecting
          if (error.message.includes('WebSocket not connected') || error.message.includes('connect')) {
            console.log(chalk.yellow('   Try: Restart the application to reconnect to server.'));
          }
        }
      }
    }
  }
}

export default InteractiveCLI;
