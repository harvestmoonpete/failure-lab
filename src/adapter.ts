import {
  type Adapter,
  type Fault,
  type Snapshot,
  nextStage,
  maxAttempts,
} from "./model";
export class Simulation implements Adapter {
  private state: Snapshot = { jobs: [], events: [], fault: "none" };
  private keys = new Set<string>();
  private tick = 0;
  private event(id: string, message: string) {
    this.state.events.unshift({
      id: this.state.events.length + 1,
      job_id: id,
      message,
      created_at: new Date(
        Date.UTC(2026, 0, 1, 12, 0, this.tick++),
      ).toISOString(),
    });
  }
  async snapshot() {
    for (const j of this.state.jobs) {
      if (j.stage === "dead" || j.stage === "delivered") continue;
      if (j.stage === "validated" && j.fault === "outage") {
        j.attempts++;
        this.event(
          j.id,
          `Renderer unavailable · attempt ${j.attempts}/${maxAttempts}`,
        );
        if (j.attempts >= maxAttempts) {
          j.stage = "dead";
          this.event(j.id, "Retries exhausted → dead-letter queue");
        }
        continue;
      }
      if (j.stage === "validated" && j.fault === "crash" && j.attempts === 0) {
        j.attempts++;
        this.event(
          j.id,
          "Worker crashed after PDF write; redelivery will reuse output",
        );
        continue;
      }
      j.stage = nextStage(j.stage);
      this.event(j.id, `${j.stage} · idempotent checkpoint`);
    }
    return structuredClone(this.state);
  }
  async submit(count: number, key: string) {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    for (let i = 0; i < count; i++) {
      const id = `INV-${String(this.state.jobs.length + 1).padStart(4, "0")}`;
      this.state.jobs.push({
        id,
        customer: ["Northstar Studio", "Acme Supply", "Juniper Works"][i % 3],
        amount: 12500 + i * 750,
        stage: "queued",
        attempts: 0,
        fault: i === 0 ? this.state.fault : "none",
        created_at: "2026-01-01T12:00:00Z",
      });
      this.event(id, "Accepted → transactional outbox");
      if (i === 0 && this.state.fault === "duplicate")
        this.event(id, "Duplicate event ignored by stage checkpoint");
    }
  }
  async fault(fault: Fault) {
    this.state.fault = fault;
  }
  async replay(id: string) {
    const j = this.state.jobs.find((x) => x.id === id);
    if (j?.stage === "dead") {
      j.stage = "validated";
      j.attempts = 0;
      j.fault = "none";
      this.event(id, "Manual replay → renderer recovered");
    }
  }
  async reset() {
    this.state = { jobs: [], events: [], fault: "none" };
    this.keys.clear();
    this.tick = 0;
  }
  pdf() {
    return `${import.meta.env?.BASE_URL ?? "/failure-lab/"}sample.pdf`;
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    `/api${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!r.ok) throw Error((await r.json()).message ?? "Request failed");
  return r.json();
}
export const http: Adapter = {
  snapshot: () => request("/snapshot"),
  submit: (count, key) => request("/batches", { count, key }),
  fault: (fault) => request("/fault", { fault }),
  replay: (id) => request(`/jobs/${id}/replay`, {}),
  reset: () => request("/reset", {}),
  pdf: (id) => `/api/jobs/${id}/pdf`,
};
export const isLive = import.meta.env?.VITE_MODE === "live";
export const adapter = isLive ? http : new Simulation();
