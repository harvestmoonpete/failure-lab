import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { adapter, isLive } from "./adapter";
import { type Snapshot, type Fault } from "./model";
import {
  evidenceReport,
  explainJob,
  invoiceEvents,
  stageLabels,
} from "./evidence";
import { PipelineGraph } from "./PipelineGraph";
import "./style.css";

const faults: { id: Fault; title: string; description: string }[] = [
  {
    id: "none",
    title: "Healthy pipeline",
    description: "Every invoice follows the happy path.",
  },
  {
    id: "duplicate",
    title: "Duplicate event",
    description: "Publish twice. Observe one stage outcome.",
  },
  {
    id: "outage",
    title: "Renderer outage",
    description: "Exhaust three retries on one invoice.",
  },
  {
    id: "crash",
    title: "Worker crash",
    description: "Stop after PDF output, before acknowledgment.",
  },
];
const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    amount / 100,
  );

function App() {
  const [s, setS] = useState<Snapshot>({ jobs: [], events: [], fault: "none" });
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(4);
  const [tab, setTab] = useState("pipeline");
  const [custom, setCustom] = useState(false);
  const [jobFilter, setJobFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [challengeIds, setChallengeIds] = useState<string[]>([]);
  const [isolated, setIsolated] = useState(false);
  const lock = useRef(false);
  const pendingPoll = useRef<Promise<void> | null>(null);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const pipelineHeading = useRef<HTMLHeadingElement>(null);
  function revealPipeline() {
    requestAnimationFrame(() => {
      pipelineHeading.current?.focus();
      pipelineHeading.current?.scrollIntoView({ block: "start" });
    });
  }
  const challengeJobs = s.jobs.filter((job) => challengeIds.includes(job.id));
  const challengeDead = challengeJobs.find((job) => job.stage === "dead");
  const challengeDelivered = challengeJobs.filter(
    (job) => job.stage === "delivered",
  ).length;
  const challengeComplete =
    isolated && challengeIds.length === 4 && challengeDelivered === 4;
  const selected = s.jobs.find((job) => job.id === selectedId);
  const timeline = selected ? invoiceEvents(s, selected.id) : [];
  const active = s.jobs.filter(
    (job) => !["dead", "delivered"].includes(job.stage),
  ).length;
  const completed = s.jobs.filter((job) => job.stage === "delivered").length;
  const dead = s.jobs.filter((job) => job.stage === "dead").length;
  const visibleJobs = s.jobs.filter(
    (job) =>
      jobFilter === "all" ||
      (jobFilter === "active"
        ? !["dead", "delivered"].includes(job.stage)
        : job.stage === jobFilter),
  );

  useEffect(() => {
    if (challengeDead && challengeDelivered === 3) setIsolated(true);
  }, [challengeDead, challengeDelivered]);

  async function refresh() {
    const snapshot = await adapter.snapshot();
    setS(snapshot);
    setConnection("ready");
  }
  useEffect(() => {
    let disposed = false;
    async function poll() {
      if (lock.current || pendingPoll.current || disposed) return;
      pendingPoll.current = refresh().catch(() => {
        if (!disposed) setConnection("error");
      });
      await pendingPoll.current;
      pendingPoll.current = null;
    }
    void poll();
    const timer = setInterval(poll, 1200);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  async function action(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await pendingPoll.current;
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function startChallenge() {
    await action(async () => {
      const previous = new Set(
        (await adapter.snapshot()).jobs.map((job) => job.id),
      );
      await adapter.fault("outage");
      await adapter.submit(4, crypto.randomUUID());
      const snapshot = await adapter.snapshot();
      const jobs = snapshot.jobs.filter((job) => !previous.has(job.id));
      if (jobs.length !== 4)
        throw new Error(
          "Could not identify four challenge invoices. Inspect the pipeline before retrying.",
        );
      setIsolated(false);
      setChallengeIds(jobs.map((job) => job.id));
      setSelectedId((jobs.find((job) => job.fault === "outage") ?? jobs[0]).id);
      setJobFilter("all");
      setCustom(false);
      setS(snapshot);
      revealPipeline();
    });
  }
  function inspect(id: string) {
    setSelectedId(id);
    // Focus after React has committed the selected invoice heading.
    requestAnimationFrame(() => {
      inspectorHeading.current?.focus();
      inspectorHeading.current?.scrollIntoView({ block: "start" });
    });
  }
  function downloadEvidence() {
    try {
      const report = evidenceReport(s, selectedId, isLive);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `failure-lab-${selectedId}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(String(e));
    }
  }
  const disabled = busy || connection === "loading";
  return (
    <div className="shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <span className="brand-icon" aria-hidden="true">
            ƒ
          </span>
          Failure Lab<span className="brand-tag">ENGINEERING SANDBOX</span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={tab === "pipeline" ? "nav active" : "nav"}
            aria-current={tab === "pipeline" ? "page" : undefined}
            onClick={() => setTab("pipeline")}
          >
            The lab
          </button>
          <button
            className={tab === "architecture" ? "nav active" : "nav"}
            aria-current={tab === "architecture" ? "page" : undefined}
            onClick={() => setTab("architecture")}
          >
            Under the hood
          </button>
          <a href="https://github.com/harvestmoonpete/failure-lab">Source ↗</a>
        </nav>
      </header>
      <main id="workspace">
        <div className="mode-bar">
          <span className="mode">
            <i aria-hidden="true" />
            {isLive ? "Local services" : "Browser simulation"}
          </span>
          <span>
            {isLive
              ? "PostgreSQL · RabbitMQ · Python worker"
              : "No setup. Synthetic invoices. Sample PDFs."}
          </span>
          <span className="connection">
            {connection === "loading"
              ? "Loading pipeline…"
              : connection === "error"
                ? "Connection interrupted"
                : isLive
                  ? "Snapshot connected"
                  : "In-memory session"}
          </span>
        </div>
        {connection === "error" && (
          <div role="alert" className="error">
            Unable to refresh the pipeline. Showing the last available state.
            Check that the Compose services are running; reconnection is
            automatic.
          </div>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
            <button className="text-button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {tab === "architecture" ? (
          <section className="architecture">
            <p className="eyebrow">THE ENGINEERING STORY</p>
            <h1>
              Expect duplicate messages.
              <br />
              Protect the outcome.
            </h1>
            <p className="lede">
              A small distributed system built around a practical question: how
              do you finish a batch when one worker fails?
            </p>
            <div className="architecture-grid">
              <article className="panel">
                <span className="step-number">01</span>
                <h2>Accept atomically</h2>
                <p>
                  Node.js validates the batch. A PostgreSQL transaction saves
                  the invoices and outbox records together. Reusing a submission
                  key does not create another batch.
                </p>
                <span className="technology">
                  TypeScript / Fastify / PostgreSQL
                </span>
              </article>
              <article className="panel">
                <span className="step-number">02</span>
                <h2>Render durably</h2>
                <p>
                  The outbox dispatcher publishes to RabbitMQ with confirms.
                  Python writes a PDF to a stable path. Redelivery can reuse the
                  output after a crash.
                </p>
                <span className="technology">
                  Python / ReportLab / RabbitMQ
                </span>
              </article>
              <article className="panel">
                <span className="step-number">03</span>
                <h2>Recover deliberately</h2>
                <p>
                  Stage checkpoints prevent duplicate delivery records. Three
                  renderer failures park a job for manual replay. Healthy
                  invoices continue independently.
                </p>
                <span className="technology">
                  Bounded retries / Idempotency
                </span>
              </article>
            </div>
            <div className="architecture-grid two">
              <article className="panel">
                <h2>What this demo proves</h2>
                <p>
                  The browser models failure and recovery using deterministic
                  transitions. Its timestamps and throughput are simulated. The
                  same interface can connect to the real backend through Docker
                  Compose.
                </p>
                <p>
                  Neither mode sends email or processes payments. The local API
                  has demo fault controls and is intended for a local
                  development environment.
                </p>
              </article>
              <article className="panel">
                <h2>Run the real pipeline</h2>
                <p>Clone the repository, then run:</p>
                <pre>
                  <code>docker compose up --build -d --wait</code>
                </pre>
                <p>
                  Open <code>http://localhost:8081</code>. CI tests duplicate
                  submissions, retry exhaustion, replay, real PDFs, worker
                  crashes, and broker restart/recreation before deployment.
                </p>
                <a href="https://github.com/harvestmoonpete/failure-lab#run-locally">
                  Setup, tests & tradeoffs ↗
                </a>
              </article>
            </div>
          </section>
        ) : (
          <>
            <section className="hero">
              <div>
                <p className="eyebrow">A HANDS-ON DISTRIBUTED SYSTEMS LAB</p>
                <h1>
                  One failed invoice.
                  <br />
                  <span>Not a failed batch.</span>
                </h1>
                <p className="lede">
                  Break the PDF worker. Follow the evidence. Recover the invoice
                  without starting over.
                </p>
              </div>
              <div className="hero-note">
                <span className="note-label">THE QUESTION</span>
                <p>What happens to the other invoices when one job fails?</p>
                <span>Run the challenge to find out. ↓</span>
              </div>
            </section>
            <section className="challenge" aria-labelledby="challenge-title">
              <div className="challenge-intro">
                <p className="eyebrow">START HERE · ABOUT 2 MINUTES</p>
                <h2 id="challenge-title">
                  Recover an invoice without stopping the batch.
                </h2>
                <p>
                  Four invoices. One renderer outage. Follow the failed invoice
                  while the other three finish.
                </p>
                {!challengeIds.length && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={startChallenge}
                  >
                    {busy ? "Starting…" : "Run recovery challenge"}
                    <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
              <div className="challenge-progress">
                <ol className="challenge-steps">
                  <li className={challengeIds.length ? "done" : ""}>
                    <span>{challengeIds.length ? "✓" : "1"}</span>
                    <div>
                      <strong>Inject</strong>
                      <small>Submit a batch with one fault</small>
                    </div>
                  </li>
                  <li className={isolated ? "done" : ""}>
                    <span>{isolated ? "✓" : "2"}</span>
                    <div>
                      <strong>Investigate</strong>
                      <small>Three delivered, one needs replay</small>
                    </div>
                  </li>
                  <li className={challengeComplete ? "done" : ""}>
                    <span>{challengeComplete ? "✓" : "3"}</span>
                    <div>
                      <strong>Recover</strong>
                      <small>Replay the same invoice ID</small>
                    </div>
                  </li>
                </ol>
                {!!challengeIds.length && (
                  <>
                    <p className="challenge-status" role="status">
                      {challengeComplete
                        ? "Challenge complete: all four invoices delivered after isolated failure and replay."
                        : isolated
                          ? "Partial failure confirmed. Replay the exhausted invoice to finish the challenge."
                          : `${challengeDelivered} of 4 challenge invoices delivered. Watch the remaining invoice reach the dead-letter queue.`}
                    </p>
                    <div className="challenge-actions">
                      {!challengeComplete ? (
                        <button
                          className="primary"
                          disabled={busy || !isolated || !challengeDead}
                          onClick={() =>
                            action(() => adapter.replay(challengeDead!.id))
                          }
                        >
                          Replay challenge invoice
                        </button>
                      ) : (
                        <a
                          className="button-link"
                          href={adapter.pdf(challengeIds[0])}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {isLive
                            ? "Download a generated PDF"
                            : "Open the sample PDF"}{" "}
                          ↗
                        </a>
                      )}
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setChallengeIds([]);
                          setIsolated(false);
                        }}
                      >
                        Exit challenge
                      </button>
                    </div>
                    {challengeComplete && (
                      <p className="takeaway">
                        The failed invoice kept its identity. Healthy invoices
                        never needed a replay. Select an invoice below to
                        compare its checkpoints and export the evidence.
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
            <div className="section-heading">
              <div>
                <p className="eyebrow">OBSERVE THE OUTCOME</p>
                <h2>Pipeline overview</h2>
              </div>
              <div className="toolbar">
                <button
                  className="secondary"
                  aria-expanded={custom}
                  aria-controls="custom-experiment"
                  onClick={() => setCustom(!custom)}
                >
                  Custom experiment{" "}
                  <span aria-hidden="true">{custom ? "−" : "+"}</span>
                </button>
                <button
                  className="text-button"
                  disabled={disabled || (isLive && active > 0)}
                  onClick={() =>
                    action(async () => {
                      await adapter.reset();
                      setChallengeIds([]);
                      setIsolated(false);
                      setSelectedId("");
                      setJobFilter("all");
                    })
                  }
                >
                  Reset lab
                </button>
              </div>
            </div>
            {custom && (
              <section
                id="custom-experiment"
                className="panel experiment"
                aria-label="Custom experiment"
              >
                <div className="panel-heading">
                  <div>
                    <h3>Choose the failure to investigate</h3>
                    <p>
                      Only the first invoice in each new batch receives the
                      selected fault.
                    </p>
                  </div>
                </div>
                <div className="faults">
                  {faults.map((f) => (
                    <button
                      key={f.id}
                      disabled={disabled}
                      className={
                        "fault " + (s.fault === f.id ? "selected" : "")
                      }
                      aria-pressed={s.fault === f.id}
                      onClick={() => action(() => adapter.fault(f.id))}
                    >
                      <strong>{f.title}</strong>
                      <small>{f.description}</small>
                    </button>
                  ))}
                </div>
                <form
                  className="batch"
                  onSubmit={(e) => {
                    e.preventDefault();
                    action(async () => {
                      const previous = new Set(s.jobs.map((job) => job.id));
                      await adapter.submit(count, crypto.randomUUID());
                      const snapshot = await adapter.snapshot();
                      setS(snapshot);
                      setSelectedId(
                        snapshot.jobs.find((job) => !previous.has(job.id))
                          ?.id ?? selectedId,
                      );
                      setJobFilter("all");
                      revealPipeline();
                    });
                  }}
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
                  <button className="primary" disabled={disabled}>
                    Process batch →
                  </button>
                </form>
              </section>
            )}
            <PipelineGraph
              headingRef={pipelineHeading}
              snapshot={s}
              selected={selected}
              onSelect={setSelectedId}
              onInspect={inspect}
              live={isLive}
              stale={connection === "error"}
            />
            <section className="metrics" aria-label="Pipeline totals">
              {[
                ["Accepted", s.jobs.length, "Total invoices"],
                ["In flight", active, "Awaiting next checkpoint"],
                ["Delivered", completed, "Recorded outcomes"],
                ["Needs replay", dead, "Exhausted renderer retries"],
              ].map(([label, value, detail]) => (
                <div
                  className={
                    "metric " +
                    (label === "Needs replay" && dead ? "attention" : "")
                  }
                  key={label}
                >
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{detail}</small>
                </div>
              ))}
            </section>
            <div className="workbench">
              <section className="panel jobs" aria-labelledby="invoices-title">
                <div className="panel-heading">
                  <div>
                    <h2 id="invoices-title">Invoices</h2>
                    <p>Select an ID to inspect its journey.</p>
                  </div>
                  <span className="count-label">{s.jobs.length} total</span>
                </div>
                <div className="job-filter">
                  <label htmlFor="filter">Show invoices</label>
                  <select
                    id="filter"
                    value={jobFilter}
                    onChange={(e) => setJobFilter(e.target.value)}
                  >
                    <option value="all">All invoices</option>
                    <option value="active">In flight</option>
                    <option value="dead">Needs replay</option>
                    <option value="delivered">Delivered</option>
                  </select>
                  <span role="status" aria-label="Invoice count">
                    {visibleJobs.length} of {s.jobs.length} invoices
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">
                      Invoice checkpoints. Select an invoice to inspect its
                      event history.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Invoice / customer</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Checkpoint</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleJobs.map((job) => (
                        <tr
                          key={job.id}
                          className={
                            selectedId === job.id ? "selected-row" : ""
                          }
                        >
                          <td>
                            <button
                              className="invoice-link"
                              aria-pressed={selectedId === job.id}
                              onClick={() => inspect(job.id)}
                            >
                              {job.id}
                              <span aria-hidden="true"> ↗</span>
                            </button>
                            <small>{job.customer}</small>
                          </td>
                          <td>{money(job.amount)}</td>
                          <td>
                            <span className={"badge " + job.stage}>
                              {stageLabels[job.stage]}
                            </span>
                            {job.attempts > 0 && (
                              <small>
                                {job.attempts} failed attempt
                                {job.attempts === 1 ? "" : "s"}
                              </small>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!s.jobs.length ? (
                    <div className="empty">
                      <span className="empty-symbol" aria-hidden="true">
                        ↳
                      </span>
                      <h3>No invoices yet</h3>
                      <p>
                        Run the recovery challenge above to create your first
                        batch. Its progress will appear here.
                      </p>
                    </div>
                  ) : (
                    !visibleJobs.length && (
                      <p className="empty">
                        No invoices match this filter. Choose All invoices to
                        see the pipeline.
                      </p>
                    )
                  )}
                </div>
              </section>
              <section
                className="panel inspector"
                aria-labelledby="inspector-title"
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">FOLLOW THE EVIDENCE</p>
                    <h2
                      id="inspector-title"
                      ref={inspectorHeading}
                      tabIndex={-1}
                    >
                      {selected ? selected.id : "Invoice inspector"}
                    </h2>
                  </div>
                  {selected && (
                    <span className="count-label">
                      {stageLabels[selected.stage]}
                    </span>
                  )}
                </div>
                {selected ? (
                  <>
                    <div className="inspection-summary">
                      <p>{explainJob(selected)}</p>
                      <dl>
                        <div>
                          <dt>Customer</dt>
                          <dd>{selected.customer}</dd>
                        </div>
                        <div>
                          <dt>Amount</dt>
                          <dd>{money(selected.amount)}</dd>
                        </div>
                      </dl>
                      <div className="inspector-actions">
                        {selected.stage === "dead" && (
                          <button
                            className="primary"
                            disabled={
                              busy ||
                              (challengeIds.includes(selected.id) && !isolated)
                            }
                            onClick={() =>
                              action(() => adapter.replay(selected.id))
                            }
                          >
                            Replay this invoice
                          </button>
                        )}
                        {["rendered", "delivered"].includes(selected.stage) && (
                          <a
                            className="button-link"
                            href={adapter.pdf(selected.id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {isLive ? "Open generated PDF" : "Open sample PDF"}{" "}
                            ↗
                          </a>
                        )}
                        <button
                          className="secondary"
                          onClick={downloadEvidence}
                        >
                          Export evidence ↓
                        </button>
                      </div>
                    </div>
                    <div className="timeline-heading">
                      <h3>Checkpoint timeline</h3>
                      <span>{timeline.length} events · oldest first</span>
                    </div>
                    <ol
                      className="timeline"
                      aria-label="Invoice event timeline"
                      tabIndex={0}
                    >
                      {timeline.map((event) => (
                        <li key={event.id}>
                          <div>
                            <span className="event-id">
                              EVENT {String(event.id).padStart(3, "0")}
                            </span>
                            <time dateTime={event.created_at}>
                              {new Date(event.created_at)
                                .toISOString()
                                .slice(11, 19)}{" "}
                              UTC
                            </time>
                          </div>
                          <p>{event.message}</p>
                        </li>
                      ))}
                    </ol>
                    {!timeline.length && (
                      <p className="timeline-note">
                        No events for this invoice in the available snapshot.
                      </p>
                    )}
                    <p className="timeline-note">
                      {isLive
                        ? "Available history only. The service returns the latest 200 events across all invoices."
                        : "These event times and transitions are simulated in your browser."}
                    </p>
                  </>
                ) : (
                  <div className="empty inspector-empty">
                    <span className="empty-symbol" aria-hidden="true">
                      ◎
                    </span>
                    <h3>Every checkpoint has a story</h3>
                    <p>
                      Select an invoice to see its retries, delivery outcome,
                      and available event history.
                    </p>
                    <span className="preview-path">
                      Accepted → PDF → Delivered
                    </span>
                  </div>
                )}
              </section>
            </div>
            <p className="mode-footnote">
              {isLive
                ? "Connected to the local Compose application. Reset is available once in-flight jobs finish. Delivery stays inside this application."
                : "This demo runs entirely in your browser. Timing is simulated, PDFs are samples, and refreshing clears the session. Use Compose to exercise the real services."}
            </p>
          </>
        )}
        <footer>
          <span>
            Failure Lab{" "}
            <span className="muted">/ Built to explain failure.</span>
          </span>
          <a href="https://github.com/harvestmoonpete/failure-lab">
            Explore the implementation ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
