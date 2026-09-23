import { startBroker } from './server.js';
startBroker().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Broker failed');
  process.exitCode = 1;
});
