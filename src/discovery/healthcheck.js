import { SharedDiscoveryRepository } from './shared-repository.js';

if (!process.env.DATABASE_URL) process.exit(1);
let repository;
try {
  repository = await SharedDiscoveryRepository.create({ databaseUrl: process.env.DATABASE_URL, migrate: false });
  const health = await repository.health();
  process.exitCode = health.workerRunning ? 0 : 1;
} catch (_) { process.exitCode = 1; }
finally { await repository?.close().catch(() => {}); }
