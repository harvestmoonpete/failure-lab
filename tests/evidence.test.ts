import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceReport, invoiceEvents } from "../src/evidence";
import { Simulation } from "../src/adapter";

test("invoice evidence isolates one job and retains chronological recovery history", async () => {
  const simulation = new Simulation();
  await simulation.fault("outage");
  await simulation.submit(4, "evidence-test");
  let snapshot = await simulation.snapshot();
  for (let i = 0; i < 6; i++) snapshot = await simulation.snapshot();
  const failed = snapshot.jobs.find((job) => job.stage === "dead")!;
  const report = evidenceReport(snapshot, failed.id, false);
  assert.equal(report.invoice.stage, "dead");
  assert.equal(
    report.events.filter((event) =>
      event.message.includes("Renderer unavailable"),
    ).length,
    3,
  );
  assert.ok(report.events.every((event) => event.job_id === failed.id));
  assert.deepEqual(
    report.events.map((event) => event.id),
    [...report.events.map((event) => event.id)].sort((a, b) => a - b),
  );
  assert.equal(report.mode, "browser-simulation");
  assert.match(report.limitations, /simulated/);
  const originalOrder = snapshot.events.map((event) => event.id);
  invoiceEvents(snapshot, failed.id);
  assert.deepEqual(
    snapshot.events.map((event) => event.id),
    originalOrder,
  );
  await simulation.replay(failed.id);
  await simulation.snapshot();
  snapshot = await simulation.snapshot();
  const recovered = evidenceReport(snapshot, failed.id, false);
  assert.equal(recovered.invoice.id, report.invoice.id);
  assert.equal(recovered.invoice.stage, "delivered");
  assert.ok(
    recovered.events.some((event) => event.message.includes("Manual replay")),
  );
  assert.equal(
    report.invoice.stage,
    "dead",
    "export is an immutable snapshot of the job",
  );
});

test("live evidence discloses the bounded event window and rejects stale IDs", () => {
  const snapshot = {
    jobs: [
      {
        id: "a",
        customer: "Synthetic",
        amount: 100,
        stage: "delivered" as const,
        attempts: 0,
        fault: "none" as const,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    events: [],
    fault: "none" as const,
  };
  const report = evidenceReport(snapshot, "a", true);
  assert.equal(report.mode, "local-services");
  assert.match(report.limitations, /200 events/);
  assert.deepEqual(report.events, []);
  assert.throws(
    () => evidenceReport(snapshot, "missing", false),
    /no longer available/,
  );
});
