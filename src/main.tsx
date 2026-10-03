import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { adapter, isLive } from "./adapter";
import { type Snapshot, type Fault } from "./model";
import "./style.css";
const faults: {
  id: Fault;
  title: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "none",
    title: "Healthy pipeline",
    description: "Every invoice follows the happy path.",
    icon: "✓",
  },
  {
    id: "duplicate",
    title: "Duplicate event",
    description: "Deliver the same message twice.",
    icon: "⧉",
  },
  {
    id: "outage",
    title: "Renderer outage",
    description: "Exhaust retries on one invoice.",
    icon: "↯",
  },
  {
    id: "crash",
    title: "Worker crash",
    description: "Crash after writing, before ACK.",
    icon: "⌁",
  },
];
function App() {
  const [s, setS] = useState<Snapshot>({ jobs: [], events: [], fault: "none" }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [count, setCount] = useState(4),
    [tab, setTab] = useState("pipeline");
  const refresh = async () => setS(await adapter.snapshot());
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const t = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      1200,
    );
    return () => clearInterval(t);
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const completed = s.jobs.filter((j) => j.stage === "delivered").length;
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="#">
          <span className="brand-icon">F</span> Failure Lab
          <span className="version">01</span>
        </a>
        <p className="eyebrow">WORKSPACE</p>
        <button
          className={tab === "pipeline" ? "nav active" : "nav"}
          onClick={() => setTab("pipeline")}
        >
          ▦ <span>Pipeline console</span>
        </button>
        <button
          className={tab === "architecture" ? "nav active" : "nav"}
          onClick={() => setTab("architecture")}
        >
          ⌘ <span>How it works</span>
        </button>
        <div className="aside-bottom">
          <span className="status-dot" /> All systems observable
          <p>
            TypeScript + Python
            <br />A resilience engineering playground
          </p>
        </div>
      </aside>
      <main>
        <header>
          <span>
            WORKSPACE <b>/</b> INVOICE PROCESSING
          </span>
          <span className="mode">
            {isLive ? "● Connected to local services" : "◉ Browser simulation"}
          </span>
        </header>
        <div className="heading">
          <div>
            <p className="eyebrow">BREAK THINGS. BUILD CONFIDENCE.</p>
            <h1>Resilience, made visible.</h1>
            <p>
              Inject a failure. Follow the recovery. See why correctness
              matters.
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => action(() => adapter.reset())}
          >
            ↻ Reset lab
          </button>
        </div>
        <div className="notice">
          <strong>
            {isLive ? "Live local pipeline" : "Deterministic sandbox"}
          </strong>
          <span>
            {isLive
              ? "Real PostgreSQL, RabbitMQ and Python PDF generation. Synthetic invoices only."
              : "Runs entirely in your browser. Timing and throughput are simulated; PDFs are samples."}
          </span>
        </div>
        {error && (
          <div role="alert" className="error">
            {error} — Check your service connection and retry.
          </div>
        )}
        {tab === "architecture" ? (
          <section className="panel architecture">
            <p className="eyebrow">BUILT TO RECOVER</p>
            <h2>One invoice. Three durable checkpoints.</h2>
            <div className="flow">
              <span>Node.js validation</span>→<span>Python PDF worker</span>→
              <span>Node.js delivery</span>
            </div>
            <p>
              A PostgreSQL transaction writes the job and its outbox event
              together. An outbox dispatcher publishes to RabbitMQ with
              confirms. If it crashes before marking a message sent, delivery
              repeats safely.
            </p>
            <p>
              Stable invoice identifiers and stage checkpoints make retries
              safe. The renderer writes the same PDF path on redelivery;
              delivery is recorded once. After three renderer failures, the job
              is parked in a dead-letter queue for manual replay.
            </p>
            <p>
              Fault injection affects the first invoice of each batch. Other
              invoices continue, so partial failure is visible. No messages or
              financial transactions leave this application.
            </p>
          </section>
        ) : (
          <>
            <section className="metrics">
              {[
                ["Invoices accepted", s.jobs.length, "Across all batches"],
                ["Delivered", completed, "Exactly-once outcome"],
                [
                  "In flight",
                  s.jobs.filter((j) => !["dead", "delivered"].includes(j.stage))
                    .length,
                  "Moving through checkpoints",
                ],
                [
                  "Dead-letter queue",
                  s.jobs.filter((j) => j.stage === "dead").length,
                  "Ready for safe replay",
                ],
              ].map(([a, b, c]) => (
                <div className="metric" key={a}>
                  <span>{a}</span>
                  <strong>{b}</strong>
                  <small>{c}</small>
                </div>
              ))}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Choose your experiment</h2>
                  <p>
                    Faults target one invoice. The rest of the batch keeps
                    moving.
                  </p>
                </div>
                <span className="step">01 / INJECT</span>
              </div>
              <div className="faults">
                {faults.map((f) => (
                  <button
                    key={f.id}
                    disabled={busy}
                    className={"fault " + (s.fault === f.id ? "selected" : "")}
                    aria-pressed={s.fault === f.id}
                    onClick={() => action(() => adapter.fault(f.id))}
                  >
                    <span className="fault-icon">{f.icon}</span>
                    <strong>{f.title}</strong>
                    <small>{f.description}</small>
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action(() => adapter.submit(count, crypto.randomUUID()));
                }}
                className="batch"
              >
                <label>
                  Batch size{" "}
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    required
                  />
                </label>
                <span>Synthetic customers · no external delivery</span>
                <button className="primary" disabled={busy}>
                  Process batch <b>→</b>
                </button>
              </form>
            </section>
            <div className="lower">
              <section className="panel jobs">
                <div className="panel-heading">
                  <h2>
                    Invoice pipeline{" "}
                    <span className="pill">{s.jobs.length}</span>
                  </h2>
                  <span className="step">02 / OBSERVE</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice / customer</th>
                        <th>Amount</th>
                        <th>Checkpoint</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.jobs.map((j) => (
                        <tr key={j.id}>
                          <td>
                            <strong>{j.id}</strong>
                            <small>{j.customer}</small>
                          </td>
                          <td>${(j.amount / 100).toFixed(2)}</td>
                          <td>
                            <span className={"badge " + j.stage}>
                              {j.stage}
                            </span>
                            {j.attempts > 0 && (
                              <small>{j.attempts} attempt(s)</small>
                            )}
                          </td>
                          <td>
                            {j.stage === "dead" ? (
                              <button
                                className="link"
                                disabled={busy}
                                onClick={() =>
                                  action(() => adapter.replay(j.id))
                                }
                              >
                                Replay ↗
                              </button>
                            ) : ["rendered", "delivered"].includes(j.stage) ? (
                              <a
                                className="link"
                                href={adapter.pdf(j.id)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                PDF ↗
                              </a>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {s.jobs.length === 0 && (
                    <div className="empty">
                      <span>◇</span>
                      <h3>Your first experiment starts here</h3>
                      <p>
                        Select a failure above, then process a batch.
                        <br />
                        Watch every invoice find its way through.
                      </p>
                    </div>
                  )}
                </div>
              </section>
              <section className="panel events">
                <div className="panel-heading">
                  <h2>Event stream</h2>
                  <span className="live">
                    <span className="status-dot" /> Polling
                  </span>
                </div>
                <div className="event-list" aria-live="polite">
                  {s.events.slice(0, 24).map((e) => (
                    <div className="event" key={e.id}>
                      <i />
                      <div>
                        <strong>{e.job_id}</strong>
                        <p>{e.message}</p>
                        <time>
                          {new Date(e.created_at).toISOString().slice(11, 19)}{" "}
                          UTC
                        </time>
                      </div>
                    </div>
                  ))}
                  {!s.events.length && (
                    <p className="muted">Waiting for your first batch…</p>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
        <footer>
          FAILURE LAB <span>Designed to fail gracefully.</span>
          <a href="https://github.com/harvestmoonpete/failure-lab">
            View source ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
