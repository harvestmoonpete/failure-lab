import { test } from "node:test";
import assert from "node:assert/strict";
import type { Job } from "../src/model";
import { pipelineState, stageEvents } from "../src/pipeline";
import { Simulation } from "../src/adapter";

test("pipeline checkpoints distinguish active, failed, blocked, and recovered stages", () => {
  const job: Job = {
    id: "test",
    customer: "Synthetic",
    amount: 100,
    stage: "queued",
    attempts: 0,
    fault: "none",
    created_at: "2026-01-01T00:00:00Z",
  };
  assert.deepEqual(pipelineState(job), {
    validation: "active",
    render: "waiting",
    delivery: "waiting",
  });
  assert.deepEqual(pipelineState({ ...job, stage: "validated", attempts: 1 }), {
    validation: "passed",
    render: "retrying",
    delivery: "waiting",
  });
  assert.deepEqual(pipelineState({ ...job, stage: "dead", attempts: 3 }), {
    validation: "passed",
    render: "failed",
    delivery: "blocked",
  });
  assert.deepEqual(pipelineState({ ...job, stage: "validated" }), {
    validation: "passed",
    render: "active",
    delivery: "waiting",
  });
  assert.deepEqual(pipelineState({ ...job, stage: "rendered" }), {
    validation: "passed",
    render: "passed",
    delivery: "active",
  });
  assert.deepEqual(pipelineState({ ...job, stage: "delivered" }), {
    validation: "passed",
    render: "passed",
    delivery: "passed",
  });
});

test("paced snapshots do not accelerate when controls read state repeatedly", async () => {
  let now = 0;
  const simulation = new Simulation(1800, () => now);
  await simulation.fault("outage");
  await simulation.submit(2, "paced");
  for (let i = 0; i < 5; i++)
    assert.equal((await simulation.snapshot()).jobs[0].stage, "queued");
  now = 1800;
  assert.equal((await simulation.snapshot()).jobs[0].stage, "validated");
  for (let i = 0; i < 3; i++)
    assert.equal((await simulation.snapshot()).jobs[0].attempts, 0);
  for (let i = 0; i < 3; i++) {
    now += 1800;
    await simulation.snapshot();
  }
  const failed = await simulation.snapshot();
  assert.equal(failed.jobs[0].stage, "dead");
  assert.equal(failed.jobs[1].stage, "delivered");
  const renderEvents = stageEvents(
    failed.events.filter((event) => event.job_id === failed.jobs[0].id),
    "render",
  );
  assert.equal(
    renderEvents.filter((event) =>
      event.message.includes("Renderer unavailable"),
    ).length,
    3,
  );
  assert.ok(
    renderEvents.some((event) => event.message.includes("Retries exhausted")),
  );
  await simulation.replay(failed.jobs[0].id);
  assert.equal((await simulation.snapshot()).jobs[0].stage, "validated");
  now += 1800;
  assert.equal((await simulation.snapshot()).jobs[0].stage, "rendered");
  now += 1800;
  assert.equal((await simulation.snapshot()).jobs[0].stage, "delivered");
  await simulation.reset();
  await simulation.submit(1, "paced");
  assert.equal((await simulation.snapshot()).jobs[0].stage, "queued");
});
