import Fastify from "fastify";
import pg from "pg";
import amqp from "amqplib";
import { readFile } from "node:fs/promises";
import { type Fault } from "../src/model.js";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const mq = await amqp.connect(process.env.AMQP_URL ?? "amqp://localhost");
const channel = await mq.createConfirmChannel();
await channel.assertQueue("render", { durable: true });
await channel.assertQueue("dead", { durable: true });
await channel.assertQueue("completed", { durable: true });
await channel.prefetch(1);
await db.query(
  `CREATE TABLE IF NOT EXISTS jobs(id text PRIMARY KEY,customer text NOT NULL,amount integer NOT NULL,stage text NOT NULL DEFAULT 'validated',attempts integer NOT NULL DEFAULT 0,fault text NOT NULL,created_at timestamptz DEFAULT now());CREATE TABLE IF NOT EXISTS events(id serial PRIMARY KEY,job_id text,message text,created_at timestamptz DEFAULT now());CREATE TABLE IF NOT EXISTS batches(key text PRIMARY KEY);CREATE TABLE IF NOT EXISTS outbox(id serial PRIMARY KEY,queue text NOT NULL,payload jsonb NOT NULL,sent boolean DEFAULT false);CREATE TABLE IF NOT EXISTS settings(id integer PRIMARY KEY,fault text NOT NULL);INSERT INTO settings VALUES(1,'none') ON CONFLICT DO NOTHING;`,
);
const app = Fastify({ logger: true });
let dispatching = false;
const timer = setInterval(async () => {
  if (dispatching) return;
  dispatching = true;
  try {
    const rows = await db.query(
      "SELECT * FROM outbox WHERE sent=false ORDER BY id LIMIT 100",
    );
    for (const row of rows.rows) {
      channel.sendToQueue(row.queue, Buffer.from(JSON.stringify(row.payload)), {
        persistent: true,
      });
      await channel.waitForConfirms();
      await db.query("UPDATE outbox SET sent=true WHERE id=$1", [row.id]);
    }
  } catch (e) {
    app.log.error(e);
  } finally {
    dispatching = false;
  }
}, 300);
channel.consume("completed", async (msg) => {
  if (!msg) return;
  try {
    const body = JSON.parse(msg.content.toString());
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        "UPDATE jobs SET stage='delivered' WHERE id=$1 AND stage='rendered' RETURNING id",
        [body.id],
      );
      if (r.rowCount)
        await client.query(
          "INSERT INTO events(job_id,message) VALUES($1,'Delivered · recorded once, no external message')",
          [body.id],
        );
      await client.query("COMMIT");
      channel.ack(msg);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    app.log.error(e);
    channel.nack(msg, false, true);
  }
});
app.get("/api/health", async () => {
  await db.query("SELECT 1");
  return { ok: true };
});
app.get("/api/snapshot", async () => ({
  jobs: (await db.query("SELECT * FROM jobs ORDER BY created_at,id")).rows,
  events: (await db.query("SELECT * FROM events ORDER BY id DESC LIMIT 200"))
    .rows,
  fault: (await db.query("SELECT fault FROM settings WHERE id=1")).rows[0]
    .fault,
}));
app.post<{ Body: { count: number; key: string } }>(
  "/api/batches",
  async (req, reply) => {
    const { count, key } = req.body;
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 20 ||
      typeof key !== "string" ||
      key.length < 1 ||
      key.length > 100
    )
      return reply
        .code(400)
        .send({
          message:
            "Provide count 1–20 and an idempotency key of 1–100 characters",
        });
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      const inserted = await c.query(
        "INSERT INTO batches VALUES($1) ON CONFLICT DO NOTHING RETURNING key",
        [key],
      );
      if (inserted.rowCount) {
        const fault = (await c.query("SELECT fault FROM settings WHERE id=1"))
          .rows[0].fault;
        for (let i = 0; i < count; i++) {
          const id = `INV-${crypto.randomUUID().slice(0, 8)}`;
          await c.query(
            "INSERT INTO jobs(id,customer,amount,fault) VALUES($1,$2,$3,$4)",
            [
              id,
              ["Northstar Studio", "Acme Supply", "Juniper Works"][i % 3],
              12500 + i * 750,
              i === 0 ? fault : "none",
            ],
          );
          await c.query(
            "INSERT INTO events(job_id,message) VALUES($1,'Accepted and validated → transactional outbox')",
            [id],
          );
          await c.query(
            "INSERT INTO outbox(queue,payload) VALUES('render',$1)",
            [JSON.stringify({ id })],
          );
          if (i === 0 && fault === "duplicate")
            await c.query(
              "INSERT INTO outbox(queue,payload) VALUES('render',$1)",
              [JSON.stringify({ id })],
            );
        }
      }
      await c.query("COMMIT");
      return { ok: true };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  },
);
app.post<{ Body: { fault: Fault } }>("/api/fault", async (req, reply) => {
  if (!["none", "duplicate", "outage", "crash"].includes(req.body.fault))
    return reply.code(400).send({ message: "Unknown fault" });
  await db.query("UPDATE settings SET fault=$1 WHERE id=1", [req.body.fault]);
  return { ok: true };
});
app.post<{ Params: { id: string } }>(
  "/api/jobs/:id/replay",
  async (req, reply) => {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query(
        "UPDATE jobs SET stage='validated',fault='none',attempts=0 WHERE id=$1 AND stage='dead' RETURNING id",
        [req.params.id],
      );
      if (!r.rowCount) {
        await c.query("ROLLBACK");
        return reply
          .code(409)
          .send({ message: "Only dead-lettered jobs may be replayed" });
      }
      await c.query(
        "INSERT INTO events(job_id,message) VALUES($1,'Manual replay · renderer recovered')",
        [req.params.id],
      );
      await c.query("INSERT INTO outbox(queue,payload) VALUES('render',$1)", [
        JSON.stringify({ id: req.params.id }),
      ]);
      await c.query("COMMIT");
      return { ok: true };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  },
);
app.get<{ Params: { id: string } }>("/api/jobs/:id/pdf", async (req, reply) => {
  if (!/^INV-[a-f0-9]{8}$/.test(req.params.id))
    return reply.code(404).send({ message: "Invoice not found" });
  const r = await db.query(
    "SELECT id FROM jobs WHERE id=$1 AND stage IN ('rendered','delivered')",
    [req.params.id],
  );
  if (!r.rowCount) return reply.code(404).send({ message: "PDF not ready" });
  return reply
    .type("application/pdf")
    .header("Content-Disposition", `inline; filename="${req.params.id}.pdf"`)
    .send(await readFile(`/data/${req.params.id}.pdf`));
});
// Reset is only safe when the pipeline is idle: purging messages during processing loses work.
app.post("/api/reset", async (_req, reply) => {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("LOCK TABLE jobs IN EXCLUSIVE MODE");
    const r = await c.query(
      "SELECT id FROM jobs WHERE stage NOT IN ('delivered','dead')",
    );
    const pending = await c.query("SELECT id FROM outbox WHERE sent=false");
    if (r.rowCount || pending.rowCount) {
      await c.query("ROLLBACK");
      return reply
        .code(409)
        .send({
          message: "Wait for active invoices to settle before resetting",
        });
    }
    await c.query("TRUNCATE jobs,events,batches,outbox RESTART IDENTITY");
    await c.query("UPDATE settings SET fault='none'");
    await c.query("COMMIT");
    await channel.purgeQueue("dead");
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
app.addHook("onClose", async () => {
  clearInterval(timer);
  await mq.close();
  await db.end();
});
await app.listen({ host: "0.0.0.0", port: 3000 });
