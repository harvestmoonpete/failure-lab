export type Fault = "none" | "duplicate" | "outage" | "crash";
export type Stage = "queued" | "validated" | "rendered" | "delivered" | "dead";
export interface Job {
  id: string;
  customer: string;
  amount: number;
  stage: Stage;
  attempts: number;
  fault: Fault;
  created_at: string;
}
export interface Event {
  id: number;
  job_id: string;
  message: string;
  created_at: string;
}
export interface Snapshot {
  jobs: Job[];
  events: Event[];
  fault: Fault;
}
export interface Adapter {
  snapshot(): Promise<Snapshot>;
  submit(count: number, key: string): Promise<void>;
  fault(fault: Fault): Promise<void>;
  replay(id: string): Promise<void>;
  reset(): Promise<void>;
  pdf(id: string): string;
}
export const maxAttempts = 3;
export function canReplay(stage: Stage) {
  return stage === "dead";
}
export function nextStage(stage: Stage): Stage {
  return (
    {
      queued: "validated",
      validated: "rendered",
      rendered: "delivered",
      delivered: "delivered",
      dead: "dead",
    } as const
  )[stage];
}
