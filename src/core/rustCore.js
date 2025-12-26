import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect OS
const isWindows = process.platform === 'win32';
const BINARY_EXT = isWindows ? '.exe' : '';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * Rust Core wrapper - Interface to Platarium Core Rust binary
 */
class RustCore {
  constructor(config) {
    this.config = config;
    
    // Add Rust cargo to PATH if available
    const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
    const cargoBinPath = path.join(homeDir, '.cargo', 'bin');
    if (cargoBinPath && existsSync(cargoBinPath)) {
      const pathSeparator = isWindows ? ';' : ':';
      const currentPath = process.env.PATH || '';
      if (!currentPath.includes(cargoBinPath)) {
        process.env.PATH = isWindows 
          ? `${cargoBinPath}${pathSeparator}${currentPath}`
          : `${cargoBinPath}${pathSeparator}${currentPath}`;
      }
    }
    
    // Try to find platarium-cli binary
    // Check common locations
    this.binaryPath = this.findBinary();
  }

  /**
   * Find platarium-cli binary
   * @returns {string|null} Path to binary or null
   */
  findBinary() {
    // Try relative path first (PlatariumCore is in walletPlatariumCLI/PlatariumCore)
    const possiblePaths = [
      path.join(__dirname, '../../PlatariumCore/target/release/platarium-cli' + BINARY_EXT),
      path.join(__dirname, '../../PlatariumCore/target/debug/platarium-cli' + BINARY_EXT),
      path.join(path.dirname(__dirname), '../PlatariumCore/target/release/platarium-cli' + BINARY_EXT),
      path.join(path.dirname(__dirname), '../PlatariumCore/target/debug/platarium-cli' + BINARY_EXT),
      isWindows ? 'platarium-cli.exe' : 'platarium-cli', // If installed globally
    ];

    for (const binaryPath of possiblePaths) {
      try {
        if (existsSync(binaryPath)) {
          return binaryPath;
        }
      } catch (e) {
        // Continue searching
      }
    }

    // Try to use 'platarium-cli' from PATH
    return isWindows ? 'platarium-cli.exe' : 'platarium-cli';
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

      // Parse output - Rust CLI outputs text, we need to parse it
      // For now, return a basic structure
      // In production, you might want to parse the actual output
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

  /**
   * Extract value from CLI output
   * @param {string} output - CLI output
   * @param {string} label - Label to find
   * @returns {string} Extracted value
   */
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

  /**
   * Verify signature using Rust Core
   * @param {Object} message - Original message
   * @param {string} signature - Signature to verify
   * @param {string} pubkey - Public key
   * @returns {Promise<boolean>} True if valid
   */
  async verifySignature(message, signature, pubkey) {
    try {
      // Ensure PATH includes cargo bin
      const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
      const cargoBinPath = path.join(homeDir, '.cargo', 'bin');
      const pathSeparator = isWindows ? ';' : ':';
      const currentPath = process.env.PATH || '';
      const env = {
        ...process.env,
        PATH: isWindows 
          ? `${cargoBinPath}${pathSeparator}${currentPath}`
          : `${cargoBinPath}${pathSeparator}${currentPath}`,
      };
      
      const messageStr = JSON.stringify(message);
      
      // Use exec on Windows for proper .exe handling, execFile on Unix
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
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate mnemonic using Rust Core
   * @returns {Promise<Object>} Generated mnemonic object
   */
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

  /**
   * Generate keys using Rust Core
   * @param {number} seedIndex - Seed index (default: 0)
   * @returns {Promise<Object>} Generated keys object
   */
  async generateKeys(seedIndex = 0) {
    try {
      // First generate mnemonic
      const { mnemonic, alphanumericPart } = await this.generateMnemonic();
      
      // Then generate keys from mnemonic
      return await this.restoreKeys(mnemonic, alphanumericPart, seedIndex);
    } catch (error) {
      throw new Error(`Failed to generate keys with Rust Core: ${error.message}`);
    }
  }

  /**
   * Restore keys from mnemonic using Rust Core
   * @param {string} mnemonic - BIP39 mnemonic phrase
   * @param {string} alphanumeric - Alphanumeric code
   * @param {number} seedIndex - Seed index (default: 0)
   * @returns {Promise<Object>} Restored keys object
   */
  async restoreKeys(mnemonic, alphanumeric, seedIndex = 0) {
    try {
      // Ensure PATH includes cargo bin
      const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
      const cargoBinPath = path.join(homeDir, '.cargo', 'bin');
      const pathSeparator = isWindows ? ';' : ':';
      const currentPath = process.env.PATH || '';
      const env = {
        ...process.env,
        PATH: isWindows 
          ? `${cargoBinPath}${pathSeparator}${currentPath}`
          : `${cargoBinPath}${pathSeparator}${currentPath}`,
      };
      
      // Use exec on Windows for proper .exe handling, execFile on Unix
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
      
      // Check if there was an actual error (not just info messages)
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
