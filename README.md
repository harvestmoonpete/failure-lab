# Failure Lab

**Resilience, made visible.** An interactive invoice pipeline that you can deliberately break, then recover without duplicate delivery.

[Browser demo](https://harvestmoonpete.github.io/failure-lab/) · TypeScript / Node.js · Python · PostgreSQL · RabbitMQ

## Try the story

1. Select **Renderer outage**, then **Process batch**.
2. Observe one invoice exhaust three attempts while the others finish.
3. **Replay** the dead-lettered invoice. Its fault is cleared and it delivers once.
4. Reset when idle and try **Worker crash**: the PDF is written before the worker exits; the restarted worker reuses it.

The public demo is a deterministic, in-memory browser simulation. It uses sample PDFs and simulated timing. Refreshing clears its state. It makes no backend calls and does not measure real throughput. Compose runs the actual queue, database and renderer. All invoices are synthetic; delivery is an internal record, never an email or financial transaction.

## Run locally

Requires Docker with Compose v2:

```sh
docker compose up --build -d --wait
# Open http://localhost:8081
python3 tests/integration.py
docker compose down
# To remove persistent demo data: docker compose down -v
```

The named Compose project isolates this app from the other portfolio projects. Database and broker ports are not published. Demo credentials are local development defaults. This is an educational application with unauthenticated fault controls, not an internet-facing service.

For browser development, Node.js 22.12+ (24 recommended):

```sh
npm ci
npm run dev
npm test
npm run build
```

Vite defaults to `/failure-lab/` for GitHub Pages. Compose builds with `VITE_BASE=/` and `VITE_MODE=live`. Both modes implement the same typed `Adapter` interface; live mode polls HTTP, simulation advances discrete checkpoints on each poll. Fault selection affects the first invoice of subsequent batches.

## Architecture and correctness

React/TypeScript provides the operational console. Fastify/Node.js validates batches, persists invoices and outbox rows in one PostgreSQL transaction, dispatches confirmed RabbitMQ messages, records delivery and serves PDFs. The Python worker generates real PDFs with ReportLab.

`POST /api/batches` accepts `{count: 1..20, key: string}`. Reusing a key does not create more invoices. `POST /api/fault` accepts `none`, `duplicate`, `outage`, or `crash`. `GET /api/snapshot` returns jobs, events and current fault. `POST /api/jobs/:id/replay` recovers dead jobs; other stages return 409. `GET /api/jobs/:id/pdf` returns finished output. `POST /api/reset` resets the lab only while idle. `GET /api/health` verifies API/database readiness.

Each outbox record stays pending until the broker confirms its message. A crash in that interval can duplicate transport messages, which is expected. Row locks and stage checkpoints make the consumer effects idempotent. PDF output uses a stable invoice path and atomic rename. The crash fault exits the Python process after recording the crash checkpoint, before acknowledging the message; Compose restarts it and RabbitMQ redelivers. Render completion and its delivery outbox row commit together. Delivery transitions only `rendered` jobs, so duplicate completion events cannot create duplicate delivery records.

The outage fault deliberately fails three times and adds an explicit message to the durable `dead` queue using the outbox. This is an application-managed dead-letter queue, not RabbitMQ's automatic dead-letter exchange. Replay clears the injected fault and retries the same invoice. Dead queue entries are retained as historical transport records until reset, while PostgreSQL is the current-state authority. Healthy invoices in the same batch continue.

## Tests and deployment

`npm test` verifies simulation batch idempotency, partial progress, retry exhaustion, safe replay, crash recovery and reset. `npm run build` type-checks UI and server. After `pip install -r worker/requirements.txt`, `python3 tests/pdf_test.py` checks actual PDF output and idempotent file reuse. `python3 tests/integration.py` runs real HTTP scenarios, duplicate submissions, PDF signatures and single delivery records against Compose. It resets demo state first, so use it only on a disposable local stack.

GitHub Actions runs these checks and the full Compose integration suite before deploying the static build to Pages. Enable **Settings → Pages → Source: GitHub Actions**. The deployment needs no runtime credentials or paid infrastructure.

## Tradeoffs

A single dispatcher and worker keep the experiment readable. This v1 demonstrates fault recovery, not production scale. Transport is at least once; application outcomes are idempotent. Injected renderer failures retry promptly rather than using production exponential backoff. Persistent PDF volumes require lifecycle management in a long-lived system; reset removes database rows, not historic PDF files. A real deployment would add authorization, TLS, secrets management, retention and alerting.

### Broker restart recovery

RabbitMQ keeps its durable queues in the named `broker` volume with a stable hostname, so replacement containers reopen the same broker data. The API treats an unexpected AMQP connection or channel error/close as fatal and exits with a nonzero status. Compose's `restart: on-failure` creates a fresh connection and consumer; startup attempts may repeat while RabbitMQ recovers. Pending PostgreSQL outbox rows are republished, and confirmed persistent messages survive in the broker volume. Stage checkpoints tolerate redelivery. Nginx resolves the API through Docker's DNS with a five-second cache, so a changed container IP does not leave the browser proxy pointing at a stale address. Intentional SIGTERM/SIGINT shutdown sets a separate graceful-shutdown flag so normal connection closure does not trigger failure handling.

`/api/health` checks both PostgreSQL and an AMQP queue RPC, with a two-second deadline; a closed or unresponsive broker cannot be reported as ready. Run `python3 tests/broker_restart.py` after the integration suite to stop the renderer, enqueue confirmed work, restart RabbitMQ, verify the API restarts, and check that queued and newly submitted invoices each deliver once. This test resets demo state and temporarily stops/restarts local containers. Add `--recreate` to replace the broker container and verify persistence across recreation as well. CI runs both variants before Pages deployment.

### Browser contrast regression checks

Run `npx playwright install chromium` once, then `npm run test:browser`. CI checks rendered text contrast on desktop and mobile, including populated workflow states, using axe. Tests serve the built app under its repository subpath. These focused checks do not establish full accessibility conformance.
