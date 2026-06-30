import { spawn } from 'child_process';
import chalk from 'chalk';

const INDENT = '      ';
const DEFAULT_CMD_TIMEOUT_MS = 30_000;

/**
 * Live logger for bootstrap steps - prints sub-commands and streams their output.
 */
export function createStepLogger() {
  let spinner = null;

  const stopSpinner = () => {
    if (!spinner) return;
    if (spinner.isSpinning) {
      spinner.clear();
    }
    spinner = null;
  };

  const log = (message) => {
    stopSpinner();
    const text = String(message ?? '');
    for (const line of text.split('\n')) {
      if (line.trim()) {
        console.log(chalk.gray(`${INDENT}${line}`));
      }
    }
  };

  const runCmd = (command, options = {}) => {
    const {
      cwd,
      env = process.env,
      echo = true,
      timeoutMs = DEFAULT_CMD_TIMEOUT_MS,
    } = options;

    if (echo) {
      const timeoutLabel =
        timeoutMs > 0 ? chalk.gray(` (timeout ${Math.round(timeoutMs / 1000)}s)`) : '';
      log(`→ ${command}${timeoutLabel}`);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        shell: true,
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timedOut = false;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGTERM');
              setTimeout(() => child.kill('SIGKILL'), 1000);
            }, timeoutMs)
          : null;

      const streamLines = (data, isErr = false) => {
        for (const line of data.toString().split('\n')) {
          if (!line.trim()) continue;
          stopSpinner();
          const body = isErr ? chalk.yellow(line) : chalk.gray(line);
          console.log(`${INDENT}${body}`);
        }
      };

      const finish = (error) => {
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      child.stdout.on('data', (chunk) => streamLines(chunk, false));
      child.stderr.on('data', (chunk) => streamLines(chunk, true));
      child.on('error', (error) => finish(error));
      child.on('close', (code) => {
        if (timedOut) {
          finish(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${command}`));
          return;
        }
        if (code === 0) {
          finish();
          return;
        }
        finish(new Error(`Command failed (${code}): ${command}`));
      });
    });
  };

  const runCmdCapture = (command, options = {}) => {
    const {
      cwd,
      env = process.env,
      echo = true,
      timeoutMs = DEFAULT_CMD_TIMEOUT_MS,
    } = options;

    if (echo) {
      const timeoutLabel =
        timeoutMs > 0 ? chalk.gray(` (timeout ${Math.round(timeoutMs / 1000)}s)`) : '';
      log(`→ ${command}${timeoutLabel}`);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        shell: true,
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGTERM');
              setTimeout(() => child.kill('SIGKILL'), 1000);
            }, timeoutMs)
          : null;

      const streamLines = (data, isErr = false) => {
        const text = data.toString();
        if (isErr) stderr += text;
        else stdout += text;
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          stopSpinner();
          const body = isErr ? chalk.yellow(line) : chalk.gray(line);
          console.log(`${INDENT}${body}`);
        }
      };

      const finish = (error, result) => {
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      };

      child.stdout.on('data', (chunk) => streamLines(chunk, false));
      child.stderr.on('data', (chunk) => streamLines(chunk, true));
      child.on('error', (error) => finish(error));
      child.on('close', (code) => {
        if (timedOut) {
          finish(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${command}`));
          return;
        }
        if (code === 0) {
          finish(null, { stdout, stderr });
          return;
        }
        finish(new Error(`Command failed (${code}): ${command}`));
      });
    });
  };

  return {
    log,
    runCmd,
    runCmdCapture,
    bindSpinner(s) {
      spinner = s;
    },
    stopSpinner,
  };
}
