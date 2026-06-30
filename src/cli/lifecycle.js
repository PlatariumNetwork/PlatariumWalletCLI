/**
 * Terminal cleanup and graceful wallet process exit.
 */

import { execSync } from 'child_process';

let exiting = false;
let serverClientRef = null;
let walletManagerRef = null;
let signalsRegistered = false;

function releaseStdin() {
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  } catch {
    // ignore
  }
}

/**
 * Clear visible screen and scrollback (best effort per terminal).
 */
export function clearTerminal() {
  if (!process.stdout.isTTY) return;

  releaseStdin();

  try {
    if (process.platform === 'win32') {
      execSync('cls', { stdio: ['ignore', 'inherit', 'inherit'] });
    } else {
      // macOS / Linux: clear scrollback + viewport (Terminal.app, iTerm, most xterm)
      execSync('printf "\\033[3J\\033[2J\\033[H"', {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      execSync('clear', { stdio: ['ignore', 'inherit', 'inherit'] });
    }
  } catch {
    // fallback
  }

  try {
    console.clear();
  } catch {
    // ignore
  }

  process.stdout.write('\x1b[3J\x1b[2J\x1b[H\x1b[0m');
}

export function registerLifecycle({ serverClient, walletManager }) {
  serverClientRef = serverClient;
  walletManagerRef = walletManager;
  registerSignalHandlers();
}

export function exitWallet(code = 0) {
  if (exiting) return;
  exiting = true;

  try {
    serverClientRef?.shutdown();
    // Memory only - never deletes wallet files on disk.
    walletManagerRef?.lock();
  } catch {
    // ignore cleanup errors
  }

  releaseStdin();
  clearTerminal();
  process.exit(code);
}

function registerSignalHandlers() {
  if (signalsRegistered) return;
  signalsRegistered = true;

  process.once('SIGINT', () => exitWallet(130));
  process.once('SIGTERM', () => exitWallet(143));

  // Ctrl+Z suspends by default; for this interactive CLI we exit to the shell instead.
  // Re-sending SIGTSTP from a handler causes a clear-screen loop and never returns to $.
  if (process.platform !== 'win32') {
    process.once('SIGTSTP', () => exitWallet(0));
  }
}
