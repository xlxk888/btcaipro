import http from 'node:http';
import { createRuntime } from './runtime.js';
import { createApp } from './app.js';

const runtime = await createRuntime();
const server = http.createServer(createApp(runtime));
server.listen(runtime.config.port, runtime.config.host, async () => {
  runtime.logger.info('server_started', { host: runtime.config.host, port: runtime.config.port });
  if (runtime.config.workerEnabled) await runtime.worker.start();
});

const shutdown = async signal => {
  runtime.logger.info('server_stopping', { signal });
  await runtime.worker.stop();
  server.close(async () => { await runtime.store.close(); process.exit(0); });
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
