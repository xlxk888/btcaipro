# Production deployment boundary

No production deployment is performed in AI-3.6. The included Docker and Compose files are preparation examples.

## Responsibilities

- Vercel: web frontend, static assets, production web delivery.
- VPS backend: Market Worker, future News Worker, WebSocket ingestion, scheduler, Event Engine, future AI Router, and future notifications.
- PostgreSQL: persistent snapshots, events, source status, and future product records.
- Redis: shared cache, worker lock, and deduplication. It is recommended in production but remains optional; an in-process bounded memory fallback keeps local development usable.

`DATABASE_URL` selects PostgreSQL. Without it, `DATABASE_PATH` selects local SQLite. Never point local tests at production. PostgreSQL migrations include `snapshots`, `events`, `source_status`, and reserved empty tables for users, subscriptions, watchlists, notification preferences, AI analysis, and usage.

Copy `.env.example` to `.env`, set a strong `POSTGRES_PASSWORD` outside Git, then use `compose.production.example.yml` only on the future VPS. Secrets and API keys must come from environment variables. The database and Redis use named persistent volumes; services have health checks and restart policies. Do not run a permanent SQLite worker on Vercel.
