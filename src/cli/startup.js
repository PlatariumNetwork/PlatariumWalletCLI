import chalk from 'chalk';
import {
  printBanner,
  printRule,
  runStep,
  warnStep,
  printReadyBox,
  getPackageVersion,
} from './branding.js';

/**
 * Professional network connection splash before interactive mode.
 */
export async function connectWithSplash(serverClient, config) {
  const version = await getPackageVersion();
  printBanner({ version, subtitle: 'Connecting to Platarium Network' });
  printRule();
  console.log('');

  await runStep('REST API', async () => {
    await serverClient.healthCheck();
    return config.server.rest.baseUrl;
  });

  try {
    await runStep('WebSocket', async () => {
      await serverClient.connectWebSocket();
      return config.server.websocket.url;
    });
  } catch (error) {
    await warnStep(`WebSocket - ${error.message}`);
    console.log(chalk.gray('  Continuing with REST API only\n'));
  }

  printRule();
  console.log(chalk.green.bold('\n  ✓ Connected\n'));
}
