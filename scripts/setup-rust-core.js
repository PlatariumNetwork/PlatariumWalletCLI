#!/usr/bin/env node

import { exec } from 'child_process';
import { execSync } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, accessSync, constants } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLATARIUM_CORE_REPO = 'https://github.com/PlatariumNetwork/PlatariumCore.git';
const PLATARIUM_CORE_DIR = path.join(__dirname, '../PlatariumCore');

// Detect OS
const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// Binary paths with platform-specific extensions
const BINARY_EXT = isWindows ? '.exe' : '';
const BINARY_RELEASE_PATH = path.join(PLATARIUM_CORE_DIR, 'target/release/platarium-cli' + BINARY_EXT);
const BINARY_DEBUG_PATH = path.join(PLATARIUM_CORE_DIR, 'target/debug/platarium-cli' + BINARY_EXT);

// Dynamic chalk import - check dependencies first
let chalk;
const nodeModulesPath = path.join(__dirname, '../node_modules');

async function ensureDependencies() {
  const wasInstalling = !existsSync(nodeModulesPath);
  
  if (wasInstalling) {
    // Dependencies will be installed by install-deps.js script
    // Just wait a moment and import chalk
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Now import chalk
  try {
    chalk = (await import('chalk')).default;
  } catch (error) {
    console.error('❌ Failed to load chalk module');
    console.error('   Please run: npm install');
    process.exit(1);
  }
  
  return wasInstalling;
}

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
 * Check if command exists (cross-platform)
 */
async function commandExists(command) {
  try {
    if (isWindows) {
      // On Windows, use 'where' command
      // Remove .exe extension if present for 'where' command
      const cmd = command.replace(/\.exe$/i, '');
      await execAsync(`where ${cmd}`, { shell: true });
    } else {
      // On Unix-like systems, use 'which'
      await execAsync(`which ${command}`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask user if they want to install Rust
 * @returns {Promise<boolean>} True if user wants to install
 */
async function askInstallRust() {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    rl.question(chalk.yellow('   Do you want to install Rust now? (y/n): '), (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Install Rust using rustup (cross-platform)
 */
async function installRust() {
  console.log(chalk.cyan('\n📦 Installing Rust...'));
  console.log(chalk.gray('   This may take a few minutes...\n'));
  
  try {
    if (isWindows) {
      // Windows installation using PowerShell
      console.log(chalk.gray('   Downloading rustup-init.exe for Windows...'));
      
      const rustupInitPath = path.join(__dirname, '..', 'rustup-init.exe');
      const rustupUrl = 'https://win.rustup.rs/x86_64';
      
      // Download using PowerShell
      const downloadScript = `
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri "${rustupUrl}" -OutFile "${rustupInitPath}" -UseBasicParsing
      `.trim();
      
      try {
        await execAsync(`powershell -Command "${downloadScript}"`, {
          maxBuffer: 10 * 1024 * 1024,
        });
        
        console.log(chalk.gray('   Running rustup-init.exe...'));
        
        // Run installer with -y flag for unattended installation
        await execAsync(`"${rustupInitPath}" -y --default-host x86_64-pc-windows-msvc --default-toolchain stable`, {
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            CARGO_HOME: process.env.CARGO_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.cargo'),
            RUSTUP_HOME: process.env.RUSTUP_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.rustup'),
          },
        });
        
        // Clean up installer
        if (existsSync(rustupInitPath)) {
          try {
            await execAsync(`del /F "${rustupInitPath}"`, { shell: true });
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      } catch (downloadError) {
        // Fallback: try using curl if available (some Windows systems have it)
        if (await commandExists('curl')) {
          console.log(chalk.gray('   Trying curl as fallback...'));
          await execAsync(`curl -sSf -o "${rustupInitPath}" "${rustupUrl}"`, {
            maxBuffer: 10 * 1024 * 1024,
          });
          
          await execAsync(`"${rustupInitPath}" -y --default-host x86_64-pc-windows-msvc --default-toolchain stable`, {
            maxBuffer: 10 * 1024 * 1024,
            env: {
              ...process.env,
              CARGO_HOME: process.env.CARGO_HOME || path.join(process.env.USERPROFILE || '.', '.cargo'),
              RUSTUP_HOME: process.env.RUSTUP_HOME || path.join(process.env.USERPROFILE || '.', '.rustup'),
            },
          });
        } else {
          throw new Error('Could not download rustup installer. Please install Rust manually from https://rustup.rs/');
        }
      }
    } else {
      // Linux/macOS installation using curl
      if (!(await commandExists('curl'))) {
        throw new Error('curl is required to install Rust. Please install curl first.');
      }
      
      console.log(chalk.gray('   Downloading and running rustup installer...'));
      
      // Run rustup installer
      const installScript = 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y';
      
      await execAsync(installScript, {
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          CARGO_HOME: process.env.CARGO_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.cargo'),
          RUSTUP_HOME: process.env.RUSTUP_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.rustup'),
        },
      });
    }
    
    // Verify installation
    console.log(chalk.gray('   Verifying installation...'));
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for installation to complete
    
    // Update PATH for current process
    const cargoBinPath = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.cargo', 'bin');
    process.env.PATH = `${cargoBinPath}:${process.env.PATH}`;
    
    // Try to run rustc
    try {
      // Source cargo env file if it exists
      const cargoEnvFile = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.cargo', 'env');
      if (existsSync(cargoEnvFile)) {
        try {
          // Try to source it
          const { stdout: envContent } = await execAsync(`cat "${cargoEnvFile}" | grep "export PATH" | head -1`);
          if (envContent) {
            const pathMatch = envContent.match(/export PATH="([^"]+)"/);
            if (pathMatch && pathMatch[1]) {
              process.env.PATH = `${pathMatch[1]}:${process.env.PATH}`;
            }
          }
        } catch (e) {
          // Ignore errors reading env file
        }
      }
      
      // Try rustc (use .exe on Windows)
      const rustcCmd = isWindows ? 'rustc.exe' : 'rustc';
      const cargoCmd = isWindows ? 'cargo.exe' : 'cargo';
      const newPath = isWindows 
        ? `${cargoBinPath};${process.env.PATH}`
        : `${cargoBinPath}:${process.env.PATH}`;
      
      const { stdout: rustVersion } = await execAsync(rustcCmd + ' --version', {
        env: { ...process.env, PATH: newPath },
        shell: isWindows,
      });
      console.log(chalk.green(`✓ Rust installed: ${rustVersion.trim()}`));
      
      // Try cargo
      const { stdout: cargoVersion } = await execAsync(cargoCmd + ' --version', {
        env: { ...process.env, PATH: newPath },
        shell: isWindows,
      });
      console.log(chalk.green(`✓ Cargo installed: ${cargoVersion.trim()}`));
      
      return true;
    } catch (error) {
      // Try with explicit path
      const rustcPath = path.join(cargoBinPath, isWindows ? 'rustc.exe' : 'rustc');
      const cargoPath = path.join(cargoBinPath, isWindows ? 'cargo.exe' : 'cargo');
      
      if (existsSync(rustcPath) && existsSync(cargoPath)) {
        console.log(chalk.green('✓ Rust installed successfully'));
        if (!isWindows) {
          console.log(chalk.yellow('⚠️  Note: You may need to restart your shell or run:'));
          console.log(chalk.cyan('   source ~/.cargo/env'));
        } else {
          console.log(chalk.yellow('⚠️  Note: You may need to restart your terminal'));
        }
        
        // Update PATH for this process
        const pathSeparator = isWindows ? ';' : ':';
        const currentPath = process.env.PATH || '';
        process.env.PATH = isWindows 
          ? `${cargoBinPath}${pathSeparator}${currentPath}`
          : `${cargoBinPath}${pathSeparator}${currentPath}`;
        
        // Return true to continue - we'll use explicit paths
        return true;
      } else {
        console.log(chalk.red('❌ Rust installation verification failed'));
        throw new Error('Rust was installed but binaries are not accessible');
      }
    }
    
  } catch (error) {
    console.log(chalk.red(`❌ Failed to install Rust: ${error.message}`));
    console.log(chalk.yellow('\n💡 Please install Rust manually:'));
    if (isWindows) {
      console.log(chalk.cyan('   Visit: https://rustup.rs/'));
      console.log(chalk.cyan('   Or download: https://win.rustup.rs/x86_64'));
    } else {
      console.log(chalk.cyan('   curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh'));
    }
    throw error;
  }
}

/**
 * Check if Rust is installed
 * @returns {Promise<boolean>} True if Rust is available
 */
async function checkRust() {
  console.log(chalk.cyan('🔍 Checking Rust installation...'));
  
  // Setup PATH for cargo bin (needed for checks)
  const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
  const cargoBinPath = path.join(homeDir, '.cargo', 'bin');
  const pathSeparator = isWindows ? ';' : ':';
  const currentPath = process.env.PATH || '';
  const newPath = isWindows 
    ? `${cargoBinPath}${pathSeparator}${currentPath}`
    : `${cargoBinPath}${pathSeparator}${currentPath}`;
  
  // Update PATH for checks
  process.env.PATH = newPath;
  
  const rustcCmd = isWindows ? 'rustc.exe' : 'rustc';
  const cargoCmd = isWindows ? 'cargo.exe' : 'cargo';
  
  if (!(await commandExists(rustcCmd))) {
    console.log(chalk.yellow('⚠️  Rust is not installed!'));
    console.log(chalk.yellow('\n📦 Rust is required to build Platarium Core'));
    
    const wantInstall = await askInstallRust();
    
    if (wantInstall) {
      await installRust();
      
      // Update PATH again after installation
      process.env.PATH = newPath;
      
      // Check again after installation
      if (!(await commandExists(rustcCmd))) {
        console.log(chalk.yellow('\n⚠️  Rust was installed but is not in PATH'));
        if (!isWindows) {
          console.log(chalk.yellow('   Please run: source ~/.cargo/env'));
        } else {
          console.log(chalk.yellow('   Please restart your terminal'));
        }
        console.log(chalk.yellow('   Then run npm start again\n'));
        return false;
      }
    } else {
      console.log(chalk.yellow('\n💡 To install Rust manually:'));
      if (isWindows) {
        console.log(chalk.cyan('   Visit: https://rustup.rs/'));
        console.log(chalk.cyan('   Or download: https://win.rustup.rs/x86_64'));
      } else {
        console.log(chalk.cyan('   curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh'));
        console.log(chalk.cyan('   Or visit: https://www.rust-lang.org/tools/install'));
      }
      console.log('');
      return false;
    }
  }
  
  // homeDir, newPath, rustcCmd, and cargoCmd are already defined at the start of the function
  // Re-use them here
  const { stdout } = await execAsync(rustcCmd + ' --version', {
    shell: isWindows,
    env: { ...process.env, PATH: newPath },
  });
  console.log(chalk.green(`✓ Rust found: ${stdout.trim()}`));
  
  // cargoCmd is already defined at the start of the function
  if (!(await commandExists(cargoCmd))) {
    console.log(chalk.yellow('⚠️  Cargo is not installed!'));
    return false;
  }
  
  const cargoVersion = await execAsync(cargoCmd + ' --version', {
    shell: isWindows,
    env: { ...process.env, PATH: newPath },
  });
  console.log(chalk.green(`✓ Cargo found: ${cargoVersion.stdout.trim()}`));
  
  // Also check Git early (before attempting to clone)
  console.log(chalk.cyan('\n🔍 Checking Git installation...'));
  const hasGit = await checkGit();
  if (!hasGit) {
    console.log(chalk.yellow('⚠️  Git is not installed or not in PATH!'));
    console.log(chalk.yellow('\n📦 Git is required to clone Platarium Core repository'));
    console.log(chalk.yellow('\n💡 Please install Git:'));
    if (isWindows) {
      console.log(chalk.cyan('   1. Download Git for Windows: https://git-scm.com/download/win'));
      console.log(chalk.cyan('   2. Run the installer'));
      console.log(chalk.cyan('   3. Make sure to select "Add Git to PATH" during installation'));
      console.log(chalk.cyan('   4. Restart your terminal and run npm start again'));
      console.log(chalk.yellow('\n   Or use winget (if available):'));
      console.log(chalk.cyan('   winget install --id Git.Git -e --source winget'));
      console.log(chalk.yellow('\n   Or use Chocolatey (if installed):'));
      console.log(chalk.cyan('   choco install git'));
    } else {
      console.log(chalk.cyan('   macOS: xcode-select --install'));
      console.log(chalk.cyan('   Ubuntu/Debian: sudo apt-get install git'));
      console.log(chalk.cyan('   Fedora: sudo dnf install git'));
      console.log(chalk.cyan('   Or visit: https://git-scm.com/downloads'));
    }
    console.log('');
    // Don't return false here - let setupRepository handle it with better error message
  } else {
    const gitCmd = isWindows ? 'git.exe' : 'git';
    try {
      const gitVersion = await execAsync(gitCmd + ' --version', {
        shell: isWindows,
      });
      console.log(chalk.green(`✓ Git found: ${gitVersion.stdout.trim()}`));
    } catch (e) {
      // Ignore version check errors
    }
  }
  
  return true;
}

/**
 * Check if Git is installed
 */
async function checkGit() {
  const gitCmd = isWindows ? 'git.exe' : 'git';
  return await commandExists(gitCmd);
}

/**
 * Clone or update PlatariumCore repository
 */
async function setupRepository() {
  console.log(chalk.cyan('\n📦 Setting up Platarium Core repository...'));
  
  // Check if Git is installed
  const hasGit = await checkGit();
  if (!hasGit) {
    console.log(chalk.red('\n❌ Git is not installed or not in PATH!'));
    console.log(chalk.yellow('\n📦 Git is required to clone Platarium Core repository'));
    console.log(chalk.yellow('\n💡 Please install Git:'));
    if (isWindows) {
      console.log(chalk.cyan('   1. Download Git for Windows: https://git-scm.com/download/win'));
      console.log(chalk.cyan('   2. Run the installer'));
      console.log(chalk.cyan('   3. Make sure to select "Add Git to PATH" during installation'));
      console.log(chalk.cyan('   4. Restart your terminal and run npm start again'));
      console.log(chalk.yellow('\n   Or use winget (if available):'));
      console.log(chalk.cyan('   winget install --id Git.Git -e --source winget'));
      console.log(chalk.yellow('\n   Or use Chocolatey (if installed):'));
      console.log(chalk.cyan('   choco install git'));
    } else {
      console.log(chalk.cyan('   macOS: xcode-select --install'));
      console.log(chalk.cyan('   Ubuntu/Debian: sudo apt-get install git'));
      console.log(chalk.cyan('   Fedora: sudo dnf install git'));
      console.log(chalk.cyan('   Or visit: https://git-scm.com/downloads'));
    }
    throw new Error('Git is not installed. Please install Git and try again.');
  }
  
  if (existsSync(PLATARIUM_CORE_DIR)) {
    console.log(chalk.yellow('   Repository exists, checking for updates...'));
    
    try {
      process.chdir(PLATARIUM_CORE_DIR);
      await execAsync('git fetch origin', { shell: isWindows });
      const { stdout: status } = await execAsync('git status -sb', { shell: isWindows });
      
      if (status.includes('behind')) {
        console.log(chalk.yellow('   Updating repository...'));
        await execAsync('git pull origin main', { shell: isWindows });
        console.log(chalk.green('✓ Repository updated'));
      } else {
        console.log(chalk.green('✓ Repository is up to date'));
      }
    } catch (error) {
      console.log(chalk.yellow(`   Warning: Could not update repository: ${error.message}`));
      console.log(chalk.yellow('   Continuing with existing code...'));
    }
  } else {
    console.log(chalk.yellow('   Cloning repository...'));
    const parentDir = path.dirname(PLATARIUM_CORE_DIR);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    
    try {
      const gitCmd = isWindows ? 'git.exe' : 'git';
      await execAsync(`"${gitCmd}" clone ${PLATARIUM_CORE_REPO} "${PLATARIUM_CORE_DIR}"`, {
        shell: isWindows,
      });
      console.log(chalk.green('✓ Repository cloned'));
    } catch (error) {
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  }
}

/**
 * Build Platarium Core
 */
async function buildPlatariumCore() {
  console.log(chalk.cyan('\n🔨 Building Platarium Core...'));
  
  if (!existsSync(PLATARIUM_CORE_DIR)) {
    throw new Error('PlatariumCore directory not found');
  }
  
  process.chdir(PLATARIUM_CORE_DIR);
  
  // Ensure cargo is in PATH
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
  
  const cargoCmd = isWindows ? 'cargo.exe' : 'cargo';
  console.log(chalk.gray(`   Running: ${cargoCmd} build --release`));
  
  try {
    console.log(chalk.gray('   This may take a few minutes on first build...\n'));
    
    const { stdout, stderr } = await execAsync(`${cargoCmd} build --release`, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for build output
        env: env,
        shell: isWindows,
      });
    
    // Show build output (filter out verbose output)
    const lines = (stdout + '\n' + stderr).split('\n');
    let showOutput = false;
    for (const line of lines) {
      if (line.includes('Compiling') || line.includes('Finished') || line.includes('error')) {
        showOutput = true;
      }
      if (showOutput || line.includes('error') || line.includes('warning')) {
        if (line.trim()) {
          if (line.includes('error')) {
            console.log(chalk.red(`   ${line}`));
          } else if (line.includes('warning')) {
            console.log(chalk.yellow(`   ${line}`));
          } else if (line.includes('Finished')) {
            console.log(chalk.green(`   ${line}`));
          } else {
            console.log(chalk.gray(`   ${line}`));
          }
        }
      }
    }
    
    if (existsSync(BINARY_RELEASE_PATH)) {
      console.log(chalk.green('✓ Build successful!'));
      return BINARY_RELEASE_PATH;
    } else if (existsSync(BINARY_DEBUG_PATH)) {
      console.log(chalk.yellow('⚠ Release build not found, using debug build'));
      return BINARY_DEBUG_PATH;
    } else {
      throw new Error('Binary not found after build');
    }
  } catch (error) {
    console.log(chalk.red('❌ Build failed!'));
    const errorOutput = error.stderr || error.stdout || error.message;
    console.log(chalk.red(errorOutput));
    
    // Check if it's a linker/build toolchain error on Windows
    const isLinkerError = errorOutput.includes('link.exe not found') || errorOutput.includes('linker link.exe not found');
    const isDlltoolError = errorOutput.includes('dlltool.exe') && errorOutput.includes('program not found');
    
    if (isWindows && (isLinkerError || isDlltoolError)) {
      if (isLinkerError) {
        console.log(chalk.yellow('\n⚠️  Rust MSVC linker not found on Windows!'));
        console.log(chalk.yellow('\n📦 Rust on Windows requires a C++ build toolchain to compile Platarium Core:'));
        console.log(chalk.yellow('\n💡 Install Visual Studio Build Tools (Recommended)'));
        console.log(chalk.cyan('   1. Download: https://visualstudio.microsoft.com/downloads/'));
        console.log(chalk.cyan('   2. Scroll down to "Tools for Visual Studio"'));
        console.log(chalk.cyan('   3. Download "Build Tools for Visual Studio"'));
        console.log(chalk.cyan('   4. During installation, select "Desktop development with C++" workload'));
        console.log(chalk.cyan('   5. Restart your terminal and run npm start again'));
        console.log(chalk.yellow('\n⚠️  Without Visual Studio Build Tools, you cannot compile Rust code on Windows!\n'));
      } else if (isDlltoolError) {
        console.log(chalk.yellow('\n⚠️  MinGW dlltool not found!'));
        console.log(chalk.yellow('\n📦 You are using GNU toolchain but MinGW tools are missing:'));
        console.log(chalk.yellow('\n💡 Option 1: Complete MinGW/MSYS2 installation'));
        console.log(chalk.cyan('   1. Install MSYS2: https://www.msys2.org/'));
        console.log(chalk.cyan('   2. Open MSYS2 terminal and run:'));
        console.log(chalk.cyan('      pacman -Syu'));
        console.log(chalk.cyan('      pacman -S mingw-w64-x86_64-toolchain'));
        console.log(chalk.cyan('   3. Add C:\\msys64\\mingw64\\bin to your PATH'));
        console.log(chalk.cyan('   4. Restart terminal and run npm start again'));
        console.log(chalk.yellow('\n💡 Option 2: Switch to MSVC toolchain (Recommended)'));
        console.log(chalk.cyan('   1. Install Visual Studio Build Tools'));
        console.log(chalk.cyan('   2. Switch Rust to MSVC toolchain:'));
        console.log(chalk.cyan('      rustup toolchain install stable-x86_64-pc-windows-msvc'));
        console.log(chalk.cyan('      rustup default stable-x86_64-pc-windows-msvc'));
        console.log(chalk.cyan('   3. Restart terminal and run npm start again'));
        console.log(chalk.yellow('\n⚠️  Without a complete C++ toolchain, you cannot compile Platarium Core on Windows!\n'));
      }
    }
    
    throw error;
  }
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
 * Main setup function
 */
async function main() {
  // Ensure dependencies are installed first
  const wasInstalling = await ensureDependencies();
  
  // Don't show ASCII art again if it was already shown by install-deps.js
  // Check both wasInstalling flag and environment variable
  const asciiAlreadyShown = process.env.PLATARIUM_ASCII_SHOWN === '1' || wasInstalling;
  
  if (!asciiAlreadyShown) {
    printAsciiArt();
    console.log(chalk.cyan.bold('\n🚀 Platarium Wallet CLI - Setup\n'));
  }
  // Otherwise continue silently - ASCII art was already shown above
  
  try {
    // Check if binary already exists (maybe from previous build)
    let binaryPath = BINARY_RELEASE_PATH;
    if (!checkBinary(binaryPath)) {
      binaryPath = BINARY_DEBUG_PATH;
    }
    
    if (checkBinary(binaryPath)) {
      console.log(chalk.cyan('\n✅ Platarium Core binary found'));
      console.log(chalk.gray(`   Path: ${binaryPath}`));
      
      // Test binary
      try {
        await execAsync(`"${binaryPath}" --version`, {
          shell: isWindows,
        });
        console.log(chalk.green('✓ Binary is working'));
        console.log(chalk.green('\n✅ Setup complete!'));
        console.log(chalk.gray('   Using existing binary\n'));
        return;
      } catch (error) {
        console.log(chalk.yellow('   Binary found but may be corrupted, will rebuild...'));
      }
    }
    
    // Check Rust installation (required for building)
    const rustAvailable = await checkRust();
    
    if (!rustAvailable) {
      console.log(chalk.red('\n❌ Cannot build Platarium Core without Rust'));
      console.log(chalk.yellow('\n💡 Please install Rust manually or run setup again:'));
      if (isWindows) {
        console.log(chalk.cyan('   Visit: https://rustup.rs/'));
        console.log(chalk.cyan('   Or download: https://win.rustup.rs/x86_64'));
      } else {
        console.log(chalk.cyan('   curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh'));
      }
      console.log(chalk.yellow('\n⚠️  Wallet will not work without Platarium Core binary!\n'));
      process.exit(1);
    }
    
    // Setup repository
    await setupRepository();
    
    // Build binary
    binaryPath = await buildPlatariumCore();
    
    console.log(chalk.green('\n✅ Setup complete!'));
    console.log(chalk.gray(`   Binary location: ${binaryPath}\n`));
    
    // Run verification tests
    console.log(chalk.cyan('🧪 Running verification tests...\n'));
    try {
      const { execSync } = await import('child_process');
      execSync('node scripts/verify-setup.js', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        env: { ...process.env, PATH: `${path.join(process.env.HOME || process.env.USERPROFILE || '.', '.cargo', 'bin')}:${process.env.PATH}` },
      });
      console.log(chalk.green('\n✅ All checks passed! Wallet is ready to use.\n'));
    } catch (error) {
      console.log(chalk.yellow('\n⚠️  Some verification tests failed, but setup completed'));
      console.log(chalk.yellow('   You can try running the wallet anyway\n'));
    }
    
  } catch (error) {
    console.log(chalk.red(`\n❌ Setup failed: ${error.message}\n`));
    console.log(chalk.yellow('💡 Make sure:'));
    console.log(chalk.white('   - Rust and Cargo are installed'));
    console.log(chalk.white('   - Git is installed and in PATH'));
    console.log(chalk.white('   - You have internet connection'));
    console.log(chalk.white('   - You have write permissions'));
    if (isWindows) {
      console.log(chalk.white('\n   If Git is not found, install it from: https://git-scm.com/download/win'));
      console.log(chalk.white('   Make sure to select "Add Git to PATH" during installation'));
    }
    console.log('');
    process.exit(1);
  }
}

// Run setup
main().catch((error) => {
  console.error(chalk ? chalk.red(`Fatal error: ${error.message}`) : `Fatal error: ${error.message}`);
  process.exit(1);
});
