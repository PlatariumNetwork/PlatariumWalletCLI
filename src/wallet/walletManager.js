import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Wallet Manager - Manages wallet creation, storage, and signing
 */
class WalletManager {
  constructor(config, rustCore) {
    this.config = config;
    this.rustCore = rustCore;
    // Store wallets inside walletPlatariumCLI directory
    this.walletsDir = path.join(path.dirname(__dirname), '../wallets');
    this.currentWallet = null;
    
    // Ensure wallets directory exists (synchronous check, async creation if needed)
    if (!existsSync(this.walletsDir)) {
      // Try to create synchronously first, if that fails it will be created on first write
      try {
        mkdirSync(this.walletsDir, { recursive: true });
      } catch (e) {
        // If sync creation fails, async creation will happen on first wallet operation
        mkdir(this.walletsDir, { recursive: true }).catch(() => {});
      }
    }
  }

  /**
   * Create a new wallet
   * @param {string} name - Wallet name
   * @param {number} seedIndex - Seed index
   * @returns {Promise<Object>} Wallet object
   */
  async createWallet(name, seedIndex = 0) {
    if (!this.rustCore) {
      throw new Error('Rust Core not available');
    }
    
    const keys = await this.rustCore.generateKeys(seedIndex);

    const wallet = {
      name,
      address: keys.publicKey, // Use Px... address, not signature key
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      mnemonic: keys.mnemonic,
      alphanumeric: keys.alphanumericPart,
      derivationPath: keys.derivationPaths.mainPath,
      seedIndex,
      createdAt: new Date().toISOString(),
    };

    const filename = `wallet_${Date.now()}.json`;
    const filepath = path.join(this.walletsDir, filename);
    await writeFile(filepath, JSON.stringify(wallet, null, 2));

    wallet.filename = filename;
    this.currentWallet = wallet;

    return wallet;
  }

  /**
   * Restore wallet from mnemonic
   * @param {string} name - Wallet name
   * @param {string} mnemonic - BIP39 mnemonic phrase
   * @param {string} alphanumeric - Alphanumeric code
   * @param {number} seedIndex - Seed index
   * @returns {Promise<Object>} Wallet object
   */
  async restoreWallet(name, mnemonic, alphanumeric, seedIndex = 0) {
    if (!this.rustCore) {
      throw new Error('Rust Core not available');
    }
    
    const keys = await this.rustCore.restoreKeys(mnemonic, alphanumeric, seedIndex);

    const wallet = {
      name,
      address: keys.publicKey, // Use Px... address, not signature key
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      mnemonic: keys.mnemonic,
      alphanumeric: keys.alphanumericPart,
      derivationPath: keys.derivationPaths.mainPath,
      seedIndex,
      createdAt: new Date().toISOString(),
    };

    const filename = `wallet_${Date.now()}.json`;
    const filepath = path.join(this.walletsDir, filename);
    await writeFile(filepath, JSON.stringify(wallet, null, 2));

    wallet.filename = filename;
    this.currentWallet = wallet;

    return wallet;
  }

  /**
   * Load wallet from file
   * @param {string} filename - Wallet filename
   * @returns {Promise<Object>} Wallet object
   */
  async loadWallet(filename) {
    const filepath = path.join(this.walletsDir, filename);
    const data = await readFile(filepath, 'utf-8');
    const wallet = JSON.parse(data);
    wallet.filename = filename;
    this.currentWallet = wallet;
    return wallet;
  }

  /**
   * List all wallets
   * @returns {Promise<Array>} Array of wallet info
   */
  async listWallets() {
    if (!existsSync(this.walletsDir)) {
      return [];
    }

    const files = await readdir(this.walletsDir);
    const wallets = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filepath = path.join(this.walletsDir, file);
        const data = await readFile(filepath, 'utf-8');
        const wallet = JSON.parse(data);
        wallets.push({
          name: wallet.name,
          address: wallet.address,
          filename: file,
          createdAt: wallet.createdAt || 'Unknown',
        });
      } catch (error) {
        // Skip corrupted files
        continue;
      }
    }

    return wallets.sort((a, b) => {
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      return dateB - dateA;
    });
  }

  /**
   * Get current loaded wallet
   * @returns {Object|null} Current wallet or null
   */
  getCurrentWallet() {
    return this.currentWallet;
  }

  /**
   * Sign transaction using Rust Core
   * @param {Object} transaction - Transaction object
   * @returns {Promise<Object>} Signed transaction
   */
  async signTransaction(transaction) {
    if (!this.currentWallet) {
      throw new Error('No wallet loaded');
    }

    if (!this.rustCore) {
      throw new Error('Rust Core not available');
    }

    const message = {
      from: transaction.from,
      to: transaction.to,
      amount: transaction.amount.toString(),
      nonce: transaction.nonce || 1,
      timestamp: transaction.timestamp || Date.now(),
      type: transaction.type || 'transfer',
    };

    const signature = await this.rustCore.signMessage(
      message,
      this.currentWallet.mnemonic,
      this.currentWallet.alphanumeric
    );

    return {
      ...transaction,
      signature: signature.signatures[0]?.signature_compact || signature.signatures[0]?.der,
      from: this.currentWallet.address,
    };
  }
}

export default WalletManager;
