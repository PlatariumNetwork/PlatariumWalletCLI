import { readFile, writeFile, readdir, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateMnemonicPair,
  deriveKeyPair,
  validateMnemonicPhrase,
  signGatewayTransaction,
  signLegacyTransferMessage,
  signWithBothKeys,
  verifySignature,
} from '../crypto/platarium-crypto.js';
import { encryptJson, decryptJson } from './vault.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sameSeed(a, b) {
  return a.mnemonic === b.mnemonic && a.alphanumeric === b.alphanumeric;
}

/**
 * Wallet Manager - aligned with PlatariumWalletExtension (Chrome).
 * Uses the same crypto algorithms and encrypted vault storage.
 */
class WalletManager {
  constructor(config) {
    this.config = config;
    this.walletsDir = path.join(path.dirname(__dirname), '../wallets');
    this.statePath = path.join(this.walletsDir, 'state.json');
    this.sessionPassword = null;
    /** @type {Map<string, { mnemonic: string, alphanumeric: string, seedIndex: number }>} */
    this.unlockedVault = new Map();
    this.currentWalletId = null;
    this.wallets = [];
    this.settings = { rpcBaseUrl: config?.server?.rest?.baseUrl };
  }

  async ensureWalletsDir() {
    if (!existsSync(this.walletsDir)) {
      await mkdir(this.walletsDir, { recursive: true });
    }
  }

  async loadState() {
    await this.ensureWalletsDir();
    if (!existsSync(this.statePath)) {
      this.wallets = [];
      this.settings = { rpcBaseUrl: this.config?.server?.rest?.baseUrl };
      return { wallets: this.wallets, settings: this.settings };
    }
    const data = JSON.parse(await readFile(this.statePath, 'utf-8'));
    this.wallets = data.wallets || [];
    this.settings = {
      rpcBaseUrl: data.settings?.rpcBaseUrl || this.config?.server?.rest?.baseUrl,
      ...data.settings,
    };
    return { wallets: this.wallets, settings: this.settings };
  }

  async saveState() {
    await this.ensureWalletsDir();
    await writeFile(
      this.statePath,
      JSON.stringify({ wallets: this.wallets, settings: this.settings }, null, 2),
    );
  }

  /** Detect encrypted wallets, backup file, and legacy JSON files. */
  async getStorageStatus() {
    await this.loadState();
    let backup = 0;
    const backupPath = `${this.statePath}.bak`;
    if (existsSync(backupPath)) {
      try {
        const bak = JSON.parse(await readFile(backupPath, 'utf-8'));
        backup = bak.wallets?.length || 0;
      } catch {
        backup = 0;
      }
    }

    let legacy = 0;
    if (existsSync(this.walletsDir)) {
      const files = await readdir(this.walletsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        if (file === 'state.json' || file === 'state.json.bak') continue;
        try {
          const data = JSON.parse(
            await readFile(path.join(this.walletsDir, file), 'utf-8'),
          );
          if (data.mnemonic && data.alphanumeric) legacy += 1;
        } catch {
          // skip
        }
      }
    }

    return {
      encrypted: this.wallets.length,
      backup,
      legacy,
    };
  }

  /** Restore wallets from state.json.bak (after forgot-password reset). */
  async restoreFromBackup() {
    const backupPath = `${this.statePath}.bak`;
    if (!existsSync(backupPath)) {
      throw new Error('No wallet backup found');
    }
    const content = await readFile(backupPath, 'utf-8');
    const data = JSON.parse(content);
    if (!data.wallets?.length) {
      throw new Error('Backup file contains no wallets');
    }
    await writeFile(this.statePath, content);
    await this.loadState();
    return data.wallets.length;
  }

  hasAnyStoredWallets(status) {
    return status.encrypted > 0 || status.backup > 0 || status.legacy > 0;
  }

  requireUnlock() {
    if (!this.sessionPassword) {
      throw new Error('Wallet locked - enter password first');
    }
  }

  secretsForWallet(walletId) {
    const sec = this.unlockedVault.get(walletId);
    if (!sec) throw new Error('Wallet locked - enter password first');
    return sec;
  }

  isUnlocked() {
    return !!this.sessionPassword;
  }

  async unlock(password) {
    await this.loadState();
    this.unlockedVault.clear();
    this.sessionPassword = password;
    if (this.wallets.length === 0) return;
    for (const w of this.wallets) {
      if (!w.vault) continue;
      try {
        const secrets = await decryptJson(w.vault, password);
        this.unlockedVault.set(w.id, {
          mnemonic: secrets.mnemonic,
          alphanumeric: secrets.alphanumeric,
          seedIndex: secrets.seedIndex ?? 0,
        });
      } catch {
        this.sessionPassword = null;
        this.unlockedVault.clear();
        throw new Error('Wrong password');
      }
    }
  }

  lock() {
    this.sessionPassword = null;
    this.unlockedVault.clear();
    this.currentWalletId = null;
  }

  /**
   * Reset encrypted local vault (forgot password).
   * Backs up state.json and clears wallets. Recovery requires mnemonic + alphanumeric.
   */
  async resetVault() {
    await this.loadState();
    const backupPath = `${this.statePath}.bak`;
    if (existsSync(this.statePath)) {
      const content = await readFile(this.statePath, 'utf-8');
      await writeFile(backupPath, content);
    }
    this.wallets = [];
    this.unlockedVault.clear();
    this.sessionPassword = null;
    this.currentWalletId = null;
    await this.saveState();
    return { backupPath: existsSync(backupPath) ? backupPath : null };
  }

  getRpcUrl() {
    return this.settings.rpcBaseUrl || this.config?.server?.rest?.baseUrl;
  }

  async setRpcUrl(url) {
    await this.loadState();
    this.settings.rpcBaseUrl = url;
    await this.saveState();
  }

  async nextSeedIndexForSource(sourceWalletId) {
    await this.loadState();
    const source = this.wallets.find((w) => w.id === sourceWalletId);
    if (!source) throw new Error('No source wallet');
    const sourceSec = this.secretsForWallet(sourceWalletId);
    let maxIdx = -1;
    for (const w of this.wallets) {
      const sec = this.unlockedVault.get(w.id);
      if (!sec || !sameSeed(sec, sourceSec)) continue;
      const idx =
        typeof w.seedIndex === 'number'
          ? w.seedIndex
          : typeof sec.seedIndex === 'number'
            ? sec.seedIndex
            : 0;
      maxIdx = Math.max(maxIdx, idx);
    }
    return maxIdx + 1;
  }

  /**
   * Import legacy plaintext wallet files into encrypted state.
   */
  async migrateLegacyWallets(password) {
    await this.loadState();
    if (!existsSync(this.walletsDir)) return 0;
    const files = await readdir(this.walletsDir);
    let migrated = 0;
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'state.json') continue;
      try {
        const data = JSON.parse(
          await readFile(path.join(this.walletsDir, file), 'utf-8'),
        );
        if (!data.mnemonic || !data.alphanumeric) continue;
        if (this.wallets.some((w) => w.address === data.address)) continue;
        const id = randomUUID();
        const vault = await encryptJson(
          {
            mnemonic: data.mnemonic,
            alphanumeric: data.alphanumeric,
            seedIndex: data.seedIndex ?? 0,
          },
          password,
        );
        this.wallets.push({
          id,
          name: data.name || file.replace('.json', ''),
          address: data.address || data.publicKey,
          createdAt: data.createdAt || new Date().toISOString(),
          seedIndex: data.seedIndex ?? 0,
          vault,
        });
        this.unlockedVault.set(id, {
          mnemonic: data.mnemonic,
          alphanumeric: data.alphanumeric,
          seedIndex: data.seedIndex ?? 0,
        });
        migrated += 1;
      } catch {
        // skip corrupted legacy files
      }
    }
    if (migrated > 0) {
      this.sessionPassword = password;
      await this.saveState();
    }
    return migrated;
  }

  async createWallet(name, seedIndex = 0) {
    this.requireUnlock();
    await this.loadState();
    const pair = generateMnemonicPair();
    const keys = deriveKeyPair(pair.mnemonic, pair.alphanumeric, seedIndex);
    const id = randomUUID();
    const vault = await encryptJson(
      { mnemonic: pair.mnemonic, alphanumeric: pair.alphanumeric, seedIndex },
      this.sessionPassword,
    );
    const entry = {
      id,
      name,
      address: keys.publicKey,
      createdAt: new Date().toISOString(),
      seedIndex,
      vault,
    };
    this.wallets.push(entry);
    await this.saveState();
    this.unlockedVault.set(id, {
      mnemonic: pair.mnemonic,
      alphanumeric: pair.alphanumeric,
      seedIndex,
    });
    this.currentWalletId = id;
    return this.walletView(entry, {
      mnemonic: pair.mnemonic,
      alphanumeric: pair.alphanumeric,
      derivationPath: keys.derivationPaths.mainPath,
    });
  }

  async addAccount(name, sourceWalletId, seedIndex) {
    this.requireUnlock();
    await this.loadState();
    if (!this.wallets.length) throw new Error('No existing wallet');
    const sourceId = sourceWalletId || this.wallets[0].id;
    const sourceSec = this.secretsForWallet(sourceId);
    const index =
      typeof seedIndex === 'number' && Number.isFinite(seedIndex)
        ? seedIndex
        : await this.nextSeedIndexForSource(sourceId);
    const keys = deriveKeyPair(sourceSec.mnemonic, sourceSec.alphanumeric, index);
    if (this.wallets.some((w) => w.address === keys.publicKey)) {
      throw new Error('Account already exists at this index');
    }
    const id = randomUUID();
    const vault = await encryptJson(
      {
        mnemonic: sourceSec.mnemonic,
        alphanumeric: sourceSec.alphanumeric,
        seedIndex: index,
      },
      this.sessionPassword,
    );
    const entry = {
      id,
      name,
      address: keys.publicKey,
      createdAt: new Date().toISOString(),
      seedIndex: index,
      vault,
    };
    this.wallets.push(entry);
    await this.saveState();
    this.unlockedVault.set(id, {
      mnemonic: sourceSec.mnemonic,
      alphanumeric: sourceSec.alphanumeric,
      seedIndex: index,
    });
    this.currentWalletId = id;
    return this.walletView(entry, {
      derivationPath: keys.derivationPaths.mainPath,
    });
  }

  async restoreWallet(name, mnemonic, alphanumeric, seedIndex = 0) {
    this.requireUnlock();
    if (!validateMnemonicPhrase(mnemonic)) {
      throw new Error('Invalid BIP39 mnemonic');
    }
    await this.loadState();
    const keys = deriveKeyPair(mnemonic, alphanumeric, seedIndex);
    const id = randomUUID();
    const vault = await encryptJson(
      { mnemonic, alphanumeric, seedIndex },
      this.sessionPassword,
    );
    const entry = {
      id,
      name,
      address: keys.publicKey,
      createdAt: new Date().toISOString(),
      seedIndex,
      vault,
    };
    this.wallets.push(entry);
    await this.saveState();
    this.unlockedVault.set(id, { mnemonic, alphanumeric, seedIndex });
    this.currentWalletId = id;
    return this.walletView(entry, {
      derivationPath: keys.derivationPaths.mainPath,
    });
  }

  async deleteWallet(walletId) {
    this.requireUnlock();
    await this.loadState();
    this.wallets = this.wallets.filter((w) => w.id !== walletId);
    this.unlockedVault.delete(walletId);
    if (this.currentWalletId === walletId) {
      this.currentWalletId = null;
    }
    await this.saveState();
    return { ok: true };
  }

  async getWalletSecrets(walletId) {
    this.requireUnlock();
    const sec = this.secretsForWallet(walletId);
    return {
      mnemonic: sec.mnemonic,
      alphanumeric: sec.alphanumeric,
      seedIndex: sec.seedIndex ?? 0,
    };
  }

  walletView(entry, extra = {}) {
    return {
      id: entry.id,
      name: entry.name,
      address: entry.address,
      publicKey: entry.address,
      seedIndex: entry.seedIndex,
      createdAt: entry.createdAt,
      ...extra,
    };
  }

  async loadWallet(walletIdOrFilename) {
    await this.loadState();
    let entry = this.wallets.find(
      (w) => w.id === walletIdOrFilename || w.name === walletIdOrFilename,
    );
    if (!entry && walletIdOrFilename.endsWith('.json')) {
      entry = this.wallets.find((w) => w.id === walletIdOrFilename);
    }
    if (!entry) {
      throw new Error('Wallet not found. Unlock and select from list.');
    }
    this.currentWalletId = entry.id;
    return this.walletView(entry);
  }

  async listWallets() {
    await this.loadState();
    return this.wallets.map((w) => ({
      id: w.id,
      name: w.name,
      address: w.address,
      seedIndex: w.seedIndex,
      createdAt: w.createdAt || 'Unknown',
    }));
  }

  getCurrentWallet() {
    if (!this.currentWalletId) return null;
    const entry = this.wallets.find((w) => w.id === this.currentWalletId);
    if (!entry) return null;
    return this.walletView(entry);
  }

  currentSecrets() {
    if (!this.currentWalletId) throw new Error('No wallet loaded');
    return this.secretsForWallet(this.currentWalletId);
  }

  async signGatewayTx(tx) {
    this.requireUnlock();
    const sec = this.currentSecrets();
    const signed = signGatewayTransaction(tx, sec.mnemonic, sec.alphanumeric);
    const body = { ...signed };
    delete body._dual;
    return body;
  }

  async signLegacyTransfer(tx) {
    this.requireUnlock();
    const sec = this.currentSecrets();
    const wallet = this.getCurrentWallet();
    const signed = signLegacyTransferMessage(
      { ...tx, from: tx.from || wallet.address },
      sec.mnemonic,
      sec.alphanumeric,
    );
    const body = { ...signed };
    delete body._dual;
    return body;
  }

  async signCanonicalMessage(message) {
    this.requireUnlock();
    const sec = this.currentSecrets();
    return signWithBothKeys(message, sec.mnemonic, sec.alphanumeric);
  }

  verifySig(message, signature, pubkey) {
    return verifySignature(message, signature.replace(/^0x/, ''), pubkey);
  }

  /** @deprecated Use signGatewayTx for network transactions */
  async signTransaction(transaction) {
    return this.signLegacyTransfer(transaction);
  }
}

export default WalletManager;
