#!/usr/bin/env node

import { exec } from 'child_process';
import { execSync } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, statSync } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  PLATARIUM_CORE_REPO,
  binaryInCoreRoot,
  resolvePlatariumCoreRoot,
  resolvePlatariumCliBinary,
  isMonorepoCoreRoot,
  isExecutable,
} from '../src/core/platariumCorePaths.js';

const WALLET_ROOT = path.join(__dirname, '..');

// Detect OS
const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

function getCoreDir() {
  return resolvePlatariumCoreRoot({ walletRoot: WALLET_ROOT });
}
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

import {
  printBanner,
  printRule,
  runLiveStep,
  printReadyBox,
  getPackageVersion,
} from '../src/cli/branding.js';

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
 * Clone or update PlatariumCore (standalone mode only - monorepo uses ../PlatariumCore).
 */
async function setupRepository(ctx) {
  const coreDir = getCoreDir();
  ctx?.log(`Core directory: ${coreDir}`);

  if (isMonorepoCoreRoot(coreDir, WALLET_ROOT)) {
    ctx?.log('Source: monorepo PlatariumCore (../PlatariumCore)');
    const git = await syncCoreGitRepo(coreDir, ctx);
    return formatCoreGitStepResult(git);
  }

  if (process.env.PLATARIUM_CORE_ROOT?.trim()) {
    ctx?.log('Source: PLATARIUM_CORE_ROOT');
    const git = await syncCoreGitRepo(coreDir, ctx);
    return formatCoreGitStepResult(git);
  }

  ctx?.log('Source: standalone clone into walletPlatariumCLI/PlatariumCore');
  
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
  
  if (existsSync(coreDir)) {
    ctx?.log('Repository exists - checking remote for updates…');

    try {
      const git = await syncCoreGitRepo(coreDir, ctx);
      return formatCoreGitStepResult(git);
    } catch (error) {
      ctx?.log(`Warning: could not update repository: ${error.message}`);
      try {
        const localShort = await gitShortRev(coreDir, 'HEAD');
        const localFull = await gitFullRev(coreDir, 'HEAD');
        ctx?.log(`Using local commit: ${localShort} (${localFull})`);
        return formatCoreGitStepResult({
          localShort,
          localFull,
          remoteShort: null,
          status: 'remote check skipped',
        });
      } catch {
        return formatCoreGitStepResult({ status: 'remote check skipped' });
      }
    }
  } else {
    ctx?.log('Cloning PlatariumCore from GitHub…');
    const parentDir = path.dirname(coreDir);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    const gitCmd = isWindows ? 'git.exe' : 'git';
    await ctx.runCmd(`"${gitCmd}" clone ${PLATARIUM_CORE_REPO} "${coreDir}"`);
    ctx?.log('Repository cloned');
    const git = await syncCoreGitRepo(coreDir, ctx);
    return formatCoreGitStepResult(git);
  }
}

/**
 * Build Platarium Core
 */
async function buildPlatariumCore(coreDir, ctx) {
  if (!existsSync(coreDir)) {
    throw new Error('PlatariumCore directory not found');
  }

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
  ctx?.log(`Building in ${coreDir}`);
  ctx?.log('Release build may take several minutes on first run…');

  try {
    await ctx.runCmd(`${cargoCmd} build --release`, { cwd: coreDir, env });

    const releaseBin = binaryInCoreRoot(coreDir, 'release');
    const debugBin = binaryInCoreRoot(coreDir, 'debug');

    if (isExecutable(releaseBin)) {
      ctx?.log(`Binary ready: ${releaseBin}`);
      return releaseBin;
    }
    if (isExecutable(debugBin)) {
      ctx?.log(`Release missing - using debug: ${debugBin}`);
      return debugBin;
    }
    throw new Error('Binary not found after build');
  } catch (error) {
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
 * Short git revision for a ref inside PlatariumCore.
 */
async function gitShortRev(coreDir, ref) {
  const { stdout } = await execAsync(`git rev-parse --short ${ref}`, {
    cwd: coreDir,
    shell: isWindows,
  });
  return stdout.trim();
}

async function gitFullRev(coreDir, ref) {
  const { stdout } = await execAsync(`git rev-parse ${ref}`, {
    cwd: coreDir,
    shell: isWindows,
  });
  return stdout.trim();
}

async function getDefaultRemoteBranch(coreDir) {
  try {
    const { stdout } = await execAsync('git symbolic-ref --short refs/remotes/origin/HEAD', {
      cwd: coreDir,
      shell: isWindows,
    });
    return stdout.trim().replace(/^origin\//, '');
  } catch {
    return 'main';
  }
}

function formatCoreGitStepResult({ localShort, localFull, remoteShort, status }) {
  const localPart =
    localShort && localFull
      ? `${localShort} (${localFull.slice(0, 12)}…)`
      : localShort || 'unknown';

  if (!remoteShort) {
    return `${localPart}, ${status}`;
  }

  if (localShort === remoteShort) {
    return `${localPart}, origin/${remoteShort}, ${status}`;
  }

  return `${localPart} → origin/${remoteShort}, ${status}`;
}

const GIT_REMOTE_TIMEOUT_MS = Number(process.env.PLATARIUM_GIT_FETCH_TIMEOUT_MS) || 8_000;
const GIT_PULL_TIMEOUT_MS = Number(process.env.PLATARIUM_GIT_PULL_TIMEOUT_MS) || 60_000;

async function getConfiguredOriginUrl(coreDir) {
  try {
    const { stdout } = await execAsync('git remote get-url origin', {
      cwd: coreDir,
      shell: isWindows,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** PlatariumCore is public - always use HTTPS (no SSH keys). */
function toHttpsGithubUrl(url) {
  if (!url) return PLATARIUM_CORE_REPO;
  if (url.startsWith('https://') || url.startsWith('http://')) {
    return url.endsWith('.git') ? url : `${url}.git`;
  }
  if (url.startsWith('git@github.com:')) {
    const repoPath = url.slice('git@github.com:'.length).replace(/\.git$/, '');
    return `https://github.com/${repoPath}.git`;
  }
  return PLATARIUM_CORE_REPO;
}

async function ensureHttpsOrigin(coreDir, ctx) {
  const originUrl = await getConfiguredOriginUrl(coreDir);
  const httpsUrl = toHttpsGithubUrl(originUrl);

  if (!originUrl) {
    ctx?.log(`origin not set - using ${httpsUrl}`);
    return httpsUrl;
  }

  if (originUrl === httpsUrl) {
    ctx?.log(`origin: ${httpsUrl}`);
    return httpsUrl;
  }

  ctx?.log(`origin ${originUrl} → ${httpsUrl}`);
  try {
    await ctx.runCmd(`git remote set-url origin "${httpsUrl}"`, {
      cwd: coreDir,
      timeoutMs: 5000,
    });
    ctx?.log('origin switched to HTTPS');
  } catch (error) {
    ctx?.log(`Could not update local origin (${error.message}) - checks still use HTTPS`);
  }
  return httpsUrl;
}

async function readCachedRemote(coreDir, branch, ctx) {
  const remoteRef = `origin/${branch}`;
  const remoteShort = await gitShortRev(coreDir, remoteRef);
  const remoteFull = await gitFullRev(coreDir, remoteRef);
  ctx?.log(`cached origin/${branch}: ${remoteShort} (${remoteFull})`);
  return { remoteShort, remoteFull, remoteRef };
}

async function queryRemoteBranchTip(coreDir, branch, ctx) {
  const httpsUrl = await ensureHttpsOrigin(coreDir, ctx);
  const cmd = `git ls-remote --heads "${httpsUrl}" refs/heads/${branch}`;
  const { stdout } = await ctx.runCmdCapture(cmd, {
    cwd: coreDir,
    timeoutMs: GIT_REMOTE_TIMEOUT_MS,
  });
  const line = stdout.trim().split('\n').find((row) => row.trim());
  if (!line) {
    throw new Error(`ls-remote returned empty for ${httpsUrl} refs/heads/${branch}`);
  }
  const remoteFull = line.split(/\s+/)[0]?.trim();
  if (!remoteFull) {
    throw new Error(`ls-remote parse failed for origin/${branch}`);
  }
  const remoteShort = remoteFull.slice(0, 7);
  ctx?.log(`origin/${branch}: ${remoteShort} (${remoteFull})`);
  return { remoteShort, remoteFull };
}

async function compareWithCachedRemote(coreDir, branch, localShort, localFull, ctx) {
  const { remoteShort, remoteFull, remoteRef } = await readCachedRemote(coreDir, branch, ctx);
  if (localFull === remoteFull || localShort === remoteShort) {
    return { localShort, localFull, remoteShort, status: 'up to date (cached remote)', updated: false };
  }

  const { stdout: counts } = await execAsync(
    `git rev-list --left-right --count HEAD...${remoteRef}`,
    { cwd: coreDir, shell: isWindows },
  );
  const [ahead, behind] = counts.trim().split(/\s+/).map(Number);
  ctx?.log(`vs cached origin/${branch}: ahead ${ahead}, behind ${behind}`);

  let status = `differs from cached origin/${branch}`;
  if (behind > 0 && ahead === 0) status = `behind cached origin/${branch} by ${behind}`;
  else if (ahead > 0 && behind === 0) status = `ahead of cached origin/${branch} by ${ahead}`;
  else if (behind > 0 && ahead > 0) status = 'diverged from cached origin';

  return { localShort, localFull, remoteShort, status, updated: false };
}

/**
 * Compare HEAD with origin via fast ls-remote (no full git fetch on startup).
 */
async function syncCoreGitRepo(coreDir, ctx) {
  if (!existsSync(path.join(coreDir, '.git'))) {
    ctx?.log('No .git - using local checkout without remote sync');
    return {
      localShort: null,
      localFull: null,
      remoteShort: null,
      status: 'no git metadata',
      updated: false,
    };
  }

  let localShort = await gitShortRev(coreDir, 'HEAD');
  let localFull = await gitFullRev(coreDir, 'HEAD');
  ctx?.log(`local HEAD: ${localShort} (${localFull})`);

  const branch = await getDefaultRemoteBranch(coreDir);
  const autoPull = process.env.PLATARIUM_CORE_AUTO_PULL === '1';

  try {
    ctx?.log(`Checking origin/${branch} (HTTPS)…`);
    const { remoteShort, remoteFull } = await queryRemoteBranchTip(coreDir, branch, ctx);

    if (localFull === remoteFull) {
      ctx?.log('Local commit matches remote tip');
      return { localShort, localFull, remoteShort, status: 'up to date', updated: false };
    }

    ctx?.log(`Remote tip differs from local (${localShort} vs ${remoteShort})`);

    if (autoPull) {
      ctx?.log('PLATARIUM_CORE_AUTO_PULL=1 - git pull…');
      await ctx.runCmd(`git pull origin ${branch}`, {
        cwd: coreDir,
        timeoutMs: GIT_PULL_TIMEOUT_MS,
      });
      localShort = await gitShortRev(coreDir, 'HEAD');
      localFull = await gitFullRev(coreDir, 'HEAD');
      const status = localFull === remoteFull ? 'pulled latest' : `pulled (now ${localShort})`;
      ctx?.log(`Now at ${localShort} (${localFull})`);
      return {
        localShort,
        localFull,
        remoteShort: localShort,
        status,
        updated: true,
      };
    }

    return {
      localShort,
      localFull,
      remoteShort,
      status: `behind origin/${branch} - run git pull in PlatariumCore`,
      updated: false,
    };
  } catch (error) {
    ctx?.log(`Remote query skipped: ${error.message}`);
    try {
      return await compareWithCachedRemote(coreDir, branch, localShort, localFull, ctx);
    } catch {
      return {
        localShort,
        localFull,
        remoteShort: null,
        status: 'remote check skipped',
        updated: false,
      };
    }
  }
}

function prependCargoToPath() {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
  const cargoBinPath = path.join(homeDir, '.cargo', 'bin');
  const pathSeparator = isWindows ? ';' : ':';
  const currentPath = process.env.PATH || '';
  if (cargoBinPath && !currentPath.includes(cargoBinPath)) {
    process.env.PATH = isWindows
      ? `${cargoBinPath}${pathSeparator}${currentPath}`
      : `${cargoBinPath}${pathSeparator}${currentPath}`;
  }
}

async function ensureRustToolchain({ interactive = true } = {}, ctx) {
  prependCargoToPath();
  const rustcCmd = isWindows ? 'rustc.exe' : 'rustc';
  const cargoCmd = isWindows ? 'cargo.exe' : 'cargo';

  if (!(await commandExists(rustcCmd))) {
    ctx?.log('Rust not found in PATH');
    if (!interactive) {
      throw new Error('Rust not installed');
    }
    const wantInstall = await askInstallRust();
    if (!wantInstall) {
      throw new Error('Rust is required to build Platarium Core');
    }
    ctx?.log('Installing Rust via rustup…');
    await installRust();
    prependCargoToPath();
    if (!(await commandExists(rustcCmd))) {
      throw new Error('Rust installed but not in PATH - restart shell or run: source ~/.cargo/env');
    }
  }

  if (!(await commandExists(cargoCmd))) {
    throw new Error('Cargo not found');
  }

  const rustcVer = (await execAsync(`${rustcCmd} --version`, { shell: isWindows })).stdout.trim();
  const cargoVer = (await execAsync(`${cargoCmd} --version`, { shell: isWindows })).stdout.trim();
  ctx?.log(rustcVer);
  ctx?.log(cargoVer);

  let toolchainNote = 'verified';
  const rustupCmd = isWindows ? 'rustup.exe' : 'rustup';
  if (await commandExists(rustupCmd)) {
    try {
      ctx?.log('Checking rustup toolchain…');
      const { stdout } = await execAsync(`${rustupCmd} check`, {
        shell: isWindows,
        timeout: 20000,
      });
      for (const line of stdout.split('\n')) {
        if (line.trim()) ctx?.log(line.trim());
      }
      if (/update available|updates available/i.test(stdout)) {
        toolchainNote = 'update available (run: rustup update stable)';
        ctx?.log('Rust update available - skipped on startup (run rustup update stable manually)');
      } else {
        toolchainNote = 'stable up to date';
      }
    } catch {
      toolchainNote = 'verified';
    }
  }

  return `${rustcVer.replace(/^rustc /, '')}, ${cargoVer.replace(/^cargo /, '')}, ${toolchainNote}`;
}

async function ensureGitToolchain(ctx) {
  const coreDir = getCoreDir();
  const needsGit =
    !existsSync(path.join(coreDir, 'Cargo.toml')) ||
    existsSync(path.join(coreDir, '.git'));

  if (!needsGit) {
    ctx?.log('Git not required for this Core layout');
    return 'not required';
  }

  if (!(await checkGit())) {
    throw new Error('Git not installed (required for PlatariumCore updates)');
  }

  const gitCmd = isWindows ? 'git.exe' : 'git';
  const { stdout } = await execAsync(`${gitCmd} --version`, { shell: isWindows });
  ctx?.log(stdout.trim());
  return stdout.trim().replace(/^git version /, 'v');
}

function needsCoreRebuild(coreDir, binaryPath, ctx) {
  if (!binaryPath || !isExecutable(binaryPath)) {
    ctx?.log('Binary missing - build required');
    return true;
  }

  const binaryMtime = statSync(binaryPath).mtimeMs;
  const markers = [
    path.join(coreDir, 'Cargo.toml'),
    path.join(coreDir, 'Cargo.lock'),
    path.join(coreDir, 'src', 'lib.rs'),
    path.join(coreDir, 'src', 'main.rs'),
  ];

  const stale = markers.filter(
    (file) => existsSync(file) && statSync(file).mtimeMs > binaryMtime,
  );
  if (stale.length > 0) {
    ctx?.log(`Source changed (${stale.map((f) => path.basename(f)).join(', ')}) - rebuild required`);
    return true;
  }

  ctx?.log(`Binary up to date: ${binaryPath}`);
  return false;
}

async function verifyCoreBinary(binaryPath, ctx) {
  ctx?.log(`Running: platarium-cli --version`);
  const { stdout } = await execAsync(`"${binaryPath}" --version`, { shell: isWindows });
  const version = stdout.trim();
  if (!version) {
    throw new Error('platarium-cli --version returned empty output');
  }
  ctx?.log(version);
  return version;
}

/**
 * Full environment preparation - every step runs with verify-or-skip logic.
 * @returns {Promise<{ binaryPath: string, coreVersion: string, buildType: string }>}
 */
export async function ensurePlatariumCore({ interactive = true } = {}) {
  await ensureDependencies();

  await runLiveStep('Rust toolchain', async (ctx) =>
    ensureRustToolchain({ interactive }, ctx),
  );

  await runLiveStep('Git', async (ctx) => ensureGitToolchain(ctx));

  await runLiveStep('PlatariumCore source', async (ctx) => setupRepository(ctx));

  const coreDir = getCoreDir();
  const resolved = resolvePlatariumCliBinary({ walletRoot: WALLET_ROOT });
  let binaryPath = resolved?.path ?? null;

  binaryPath = await runLiveStep('PlatariumCore build', async (ctx) => {
    if (binaryPath && checkBinary(binaryPath) && !needsCoreRebuild(coreDir, binaryPath, ctx)) {
      ctx.log('Skipping cargo build - binary is current');
      return binaryPath;
    }
    return buildPlatariumCore(coreDir, ctx);
  });

  const buildType = binaryPath.includes(`${path.sep}release${path.sep}`) ? 'release' : 'debug';
  const coreVersion = await runLiveStep('PlatariumCore binary', async (ctx) =>
    verifyCoreBinary(binaryPath, ctx),
  );

  await runLiveStep('Cryptographic checks', async (ctx) => runVerificationSuite(ctx));

  return { binaryPath, coreVersion, buildType };
}

async function runVerificationSuite(ctx) {
  const { runVerificationTests } = await import('./verify-setup.js');
  return runVerificationTests({ walletRoot: WALLET_ROOT, ctx });
}

/**
 * Check if binary exists and is executable
 */
function checkBinary(binaryPath) {
  return isExecutable(binaryPath);
}

/**
 * Main setup function (npm run setup)
 */
async function main() {
  try {
    const version = await getPackageVersion();
    printBanner({ version, subtitle: 'Environment setup' });
    printRule();
    console.log('');

    const { binaryPath, coreVersion, buildType } = await ensurePlatariumCore({ interactive: true });

    printReadyBox({
      title: 'Setup complete',
      lines: [
        ['Core build', buildType],
        ['Core version', coreVersion],
        ['Binary path', binaryPath],
      ],
    });
  } catch (error) {
    console.log(chalk.red(`\n❌ Setup failed: ${error.message}\n`));
    console.log(chalk.yellow('💡 Make sure:'));
    console.log(chalk.white('   - Rust and Cargo are installed'));
    console.log(chalk.white('   - Git is installed and in PATH'));
    console.log(chalk.white('   - You have internet connection'));
    console.log(chalk.white('   - You have write permissions'));
    if (isWindows) {
      console.log(chalk.white('\n   If Git is not found, install it from: https://git-scm.com/download/win'));
    }
    console.log('');
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch((error) => {
    console.error(chalk ? chalk.red(`Fatal error: ${error.message}`) : `Fatal error: ${error.message}`);
    process.exit(1);
  });
}
