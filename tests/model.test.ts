import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/adapter";
test("duplicates do not create invoices twice", async () => {
  const a = new Simulation();
  await a.submit(3, "key");
  await a.submit(3, "key");
  assert.equal((await a.snapshot()).jobs.length, 3);
});
test("outage isolates one invoice; exhausted jobs safely replay", async () => {
  const a = new Simulation();
  await a.fault("outage");
  await a.submit(3, "key");
  for (let n = 0; n < 5; n++) await a.snapshot();
  let s = await a.snapshot();
  assert.equal(s.jobs.filter((j) => j.stage === "dead").length, 1);
  assert.equal(s.jobs.filter((j) => j.stage === "delivered").length, 2);
  await a.replay(s.jobs[0].id);
  await a.snapshot();
  s = await a.snapshot();
  assert.ok(s.jobs.every((j) => j.stage === "delivered"));
  await a.replay(s.jobs[0].id);
  assert.equal(
    (await a.snapshot()).events.filter((e) =>
      e.message.startsWith("Manual replay"),
    ).length,
    1,
  );
});
test("crash recovers and delivers once", async () => {
  const a = new Simulation();
  await a.fault("crash");
  await a.submit(1, "key");
  for (let i = 0; i < 5; i++) await a.snapshot();
  const s = await a.snapshot();
  assert.equal(s.jobs[0].stage, "delivered");
  assert.equal(
    s.events.filter((e) => e.message.startsWith("delivered")).length,
    1,
  );
});
test("reset restores seed and key availability", async () => {
  const a = new Simulation();
  await a.submit(1, "key");
  await a.reset();
  assert.equal((await a.snapshot()).jobs.length, 0);
  await a.submit(1, "key");
  assert.equal((await a.snapshot()).jobs.length, 1);
});
test("duplicate fault records suppression and only one delivered checkpoint", async () => {
  const a = new Simulation();
  await a.fault("duplicate");
  await a.submit(1, "dup");
  for (let i = 0; i < 5; i++) await a.snapshot();
  const s = await a.snapshot();
  assert.equal(s.jobs.length, 1);
  assert.equal(
    s.events.filter((e) => e.message.startsWith("delivered")).length,
    1,
  );
  assert.ok(
    s.events.some((e) => e.message.startsWith("Duplicate event ignored")),
  );
});
