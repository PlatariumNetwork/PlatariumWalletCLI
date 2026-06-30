import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { resolvePlatariumCliBinary } from './platariumCorePaths.js';

const isWindows = process.platform === 'win32';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * Rust Core wrapper - subprocess interface to platarium-cli (same resolution as Gateway Go).
 */
class RustCore {
  constructor(config) {
    this.config = config;

    const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
    const cargoBinPath = `${homeDir}/.cargo/bin`;
    const pathSeparator = isWindows ? ';' : ':';
    const currentPath = process.env.PATH || '';
    if (cargoBinPath && !currentPath.includes(cargoBinPath)) {
      process.env.PATH = `${cargoBinPath}${pathSeparator}${currentPath}`;
    }

    const resolved = resolvePlatariumCliBinary();
    if (!resolved) {
      throw new Error(
        'platarium-cli binary not found. Set PLATARIUM_CLI_PATH or build: cd PlatariumCore && cargo build --release',
      );
    }
    this.binaryPath = resolved.path;
    this.binarySource = resolved.source;
  }

  /**
   * Sign a message using Rust Core
   * @param {Object} message - Message object to sign
   * @param {string} mnemonic - BIP39 mnemonic phrase
   * @param {string} alphanumeric - Alphanumeric code
   * @returns {Promise<Object>} Signature result
   */
  async signMessage(message, mnemonic, alphanumeric) {
    try {
      const messageStr = JSON.stringify(message);
      
      // Use exec on Windows for proper .exe handling, execFile on Unix
      let stdout, stderr;
      if (isWindows) {
        const cmd = `"${this.binaryPath}" sign-message --message "${messageStr.replace(/"/g, '\\"')}" --mnemonic "${mnemonic.replace(/"/g, '\\"')}" --alphanumeric "${alphanumeric.replace(/"/g, '\\"')}"`;
        const result = await execAsync(cmd, { shell: true });
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        const result = await execFileAsync(this.binaryPath, [
          'sign-message',
          '--message', messageStr,
          '--mnemonic', mnemonic,
          '--alphanumeric', alphanumeric,
        ]);
        stdout = result.stdout;
        stderr = result.stderr;
      }

      if (stderr && !stderr.includes('Message Hash:')) {
        throw new Error(`Rust Core error: ${stderr}`);
      }

      return {
        hash: this.extractValue(stdout, 'Message Hash:'),
        signatures: [
          {
            signature_compact: this.extractValue(stdout, 'Compact:'),
            der: this.extractValue(stdout, 'DER:'),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to sign message with Rust Core: ${error.message}`);
    }
  }

  extractValue(output, label) {
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes(label)) {
        const parts = line.split(label);
        if (parts.length > 1) {
          return parts[1].trim();
        }
      }
    }
    return '';
  }

  async verifySignature(message, signature, pubkey) {
    try {
      const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
      const cargoBinPath = `${homeDir}/.cargo/bin`;
      const pathSeparator = isWindows ? ';' : ':';
      const currentPath = process.env.PATH || '';
      const env = {
        ...process.env,
        PATH: `${cargoBinPath}${pathSeparator}${currentPath}`,
      };
      
      const messageStr = JSON.stringify(message);
      
      let stdout, stderr;
      if (isWindows) {
        const cmd = `"${this.binaryPath}" verify-signature --message "${messageStr.replace(/"/g, '\\"')}" --signature "${signature.replace(/"/g, '\\"')}" --pubkey "${pubkey.replace(/"/g, '\\"')}"`;
        const result = await execAsync(cmd, { shell: true, env });
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        const result = await execFileAsync(this.binaryPath, [
          'verify-signature',
          '--message', messageStr,
          '--signature', signature,
          '--pubkey', pubkey,
        ], { env });
        stdout = result.stdout;
        stderr = result.stderr;
      }

      return !stderr && stdout.includes('valid');
    } catch {
      return false;
    }
  }

  async generateMnemonic() {
    try {
      const { stdout, stderr } = await execFileAsync(this.binaryPath, [
        'generate-mnemonic',
      ]);

      const output = stdout + stderr;
      
      const mnemonic = this.extractValue(output, 'Mnemonic:');
      const alphanumeric = this.extractValue(output, 'Alphanumeric:');
      
      if (!mnemonic) {
        throw new Error('Failed to generate mnemonic');
      }
      
      return {
        mnemonic,
        alphanumericPart: alphanumeric,
      };
    } catch (error) {
      throw new Error(`Failed to generate mnemonic with Rust Core: ${error.message}`);
    }
  }

  async generateKeys(seedIndex = 0) {
    try {
      const { mnemonic, alphanumericPart } = await this.generateMnemonic();
      return await this.restoreKeys(mnemonic, alphanumericPart, seedIndex);
    } catch (error) {
      throw new Error(`Failed to generate keys with Rust Core: ${error.message}`);
    }
  }

  async restoreKeys(mnemonic, alphanumeric, seedIndex = 0) {
    try {
      const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
      const cargoBinPath = `${homeDir}/.cargo/bin`;
      const pathSeparator = isWindows ? ';' : ':';
      const currentPath = process.env.PATH || '';
      const env = {
        ...process.env,
        PATH: `${cargoBinPath}${pathSeparator}${currentPath}`,
      };
      
      let stdout, stderr;
      if (isWindows) {
        const mnemonicEscaped = mnemonic.replace(/"/g, '\\"');
        const alphanumericEscaped = alphanumeric.replace(/"/g, '\\"');
        const cmd = `"${this.binaryPath}" generate-keys --mnemonic "${mnemonicEscaped}" --alphanumeric "${alphanumericEscaped}" --seed-index ${seedIndex.toString()}`;
        const result = await execAsync(cmd, { shell: true, env });
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        const result = await execFileAsync(this.binaryPath, [
          'generate-keys',
          '--mnemonic', mnemonic,
          '--alphanumeric', alphanumeric,
          '--seed-index', seedIndex.toString(),
        ], { env });
        stdout = result.stdout;
        stderr = result.stderr;
      }

      const output = stdout + stderr;
      
      if (stderr && !output.includes('Public Key:')) {
        throw new Error(`Rust Core error: ${stderr}`);
      }
      
      const publicKey = this.extractValue(output, 'Public Key:');
      if (!publicKey) {
        throw new Error('Failed to extract public key from Rust Core output');
      }
      
      return {
        publicKey: publicKey,
        privateKey: this.extractValue(output, 'Private Key:'),
        signatureKey: this.extractValue(output, 'Signature Key:'),
        mnemonic: mnemonic,
        alphanumericPart: alphanumeric,
        derivationPaths: {
          mainPath: this.extractValue(output, 'Derivation Path:') || `m/44'/60'/0'/${seedIndex}'`,
        },
      };
    } catch (error) {
      throw new Error(`Failed to restore keys with Rust Core: ${error.message}`);
    }
  }
}

export default RustCore;
