import type { Event, Job } from "./model";

export type PipelineStage = "validation" | "render" | "delivery";
export type NodeState =
  "waiting" | "active" | "retrying" | "passed" | "failed" | "blocked";
export const pipelineStages: {
  id: PipelineStage;
  title: string;
  owner: string;
}[] = [
  { id: "validation", title: "Validate invoice", owner: "Node.js" },
  { id: "render", title: "Generate PDF", owner: "Python" },
  { id: "delivery", title: "Record delivery", owner: "Node.js" },
];
export function pipelineState(job: Job): Record<PipelineStage, NodeState> {
  switch (job.stage) {
    case "queued":
      return { validation: "active", render: "waiting", delivery: "waiting" };
    case "validated":
      return {
        validation: "passed",
        render: job.attempts ? "retrying" : "active",
        delivery: "waiting",
      };
    case "rendered":
      return { validation: "passed", render: "passed", delivery: "active" };
    case "delivered":
      return { validation: "passed", render: "passed", delivery: "passed" };
    case "dead":
      return { validation: "passed", render: "failed", delivery: "blocked" };
  }
}
export function currentPipelineStage(job: Job): PipelineStage {
  return job.stage === "queued"
    ? "validation"
    : ["rendered", "delivered"].includes(job.stage)
      ? "delivery"
      : "render";
}
export function nodeLabel(state: NodeState, attempts: number) {
  return {
    waiting: "Waiting",
    active: "In progress",
    retrying: `Retrying · ${attempts}/3`,
    passed: "Passed",
    failed: "Failed · 3/3",
    blocked: "Blocked",
  }[state];
}
export function stageEvents(events: Event[], stage: PipelineStage) {
  // Both adapters emit these checkpoint messages. Unknown messages stay in the full invoice timeline.
  const pattern = {
    validation: /accepted|validated|duplicate event ignored/i,
    render: /render|pdf|worker|retries exhausted|manual replay/i,
    delivery: /^delivered/i,
  }[stage];
  return events.filter((event) => pattern.test(event.message));
}
