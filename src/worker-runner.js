import { createRuntime } from './runtime.js';

const runtime = await createRuntime();
await runtime.worker.start();
if (process.env.DISCOVERY_ENABLED === 'true') runtime.discovery.start();
runtime.logger.info('standalone_worker_ready', {});
const shutdown = async signal => { runtime.logger.info('standalone_worker_stopping', { signal }); runtime.discovery.stop(); await runtime.worker.stop(); await runtime.discovery.repository.close(); await runtime.store.close(); process.exit(0); };
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
