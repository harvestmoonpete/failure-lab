import type { Job, Snapshot, Stage } from "./model";

export const stageLabels: Record<Stage, string> = {
  queued: "Queued",
  validated: "Validated",
  rendered: "PDF ready",
  delivered: "Delivered",
  dead: "Needs replay",
};
export function invoiceEvents(snapshot: Snapshot, id: string) {
  return snapshot.events
    .filter((event) => event.job_id === id)
    .sort((a, b) => a.id - b.id);
}
export function explainJob(job: Job) {
  switch (job.stage) {
    case "dead":
      return "Three renderer attempts failed. This invoice is parked for manual replay; other invoices can continue. Replay clears the injected fault and keeps the same invoice ID.";
    case "delivered":
      return "Delivery is recorded. No email was sent and no money moved. Inspect the timeline to see how this invoice reached its final checkpoint.";
    case "rendered":
      return "The PDF checkpoint is saved. The delivery stage can record the outcome without generating the document again.";
    case "validated":
      return "Validation is complete. The invoice is waiting for the PDF worker, or retrying a renderer failure.";
    case "queued":
      return "The invoice was accepted and is waiting for its validation checkpoint.";
  }
}
export function evidenceReport(snapshot: Snapshot, id: string, live: boolean) {
  const job = snapshot.jobs.find((job) => job.id === id);
  if (!job)
    throw new Error(
      "This invoice is no longer available. Select another invoice.",
    );
  return {
    schemaVersion: 1,
    mode: live ? "local-services" : "browser-simulation",
    limitations: live
      ? "Available event history from the latest snapshot (at most 200 events across all invoices). This is not a complete audit-log export. Delivery is an internal record."
      : "Deterministic browser simulation. Event timestamps and processing are simulated; PDF output is a bundled sample. This is not a backend benchmark.",
    invoice: { ...job },
    events: invoiceEvents(snapshot, id),
  };
}
