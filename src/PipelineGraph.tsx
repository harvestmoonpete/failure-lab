import { useState, type RefObject } from "react";
import type { Job, Snapshot } from "./model";
import { invoiceEvents } from "./evidence";
import {
  currentPipelineStage,
  nodeLabel,
  pipelineStages,
  pipelineState,
  stageEvents,
  type PipelineStage,
  type NodeState,
} from "./pipeline";

function StateIcon({ state }: { state: NodeState }) {
  return (
    <span className={"pipeline-icon " + state} aria-hidden="true">
      {state === "active" || state === "retrying" ? (
        <span className="thinking-dots">
          <i />
          <i />
          <i />
        </span>
      ) : (
        { passed: "✓", failed: "×", blocked: "−", waiting: "○" }[state]
      )}
    </span>
  );
}

export function PipelineGraph({
  headingRef,
  snapshot,
  selected,
  onSelect,
  onInspect,
  live,
  stale,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  snapshot: Snapshot;
  selected?: Job;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
  live: boolean;
  stale: boolean;
}) {
  const [motionPaused, setMotionPaused] = useState(false);
  const [focus, setFocus] = useState<{
    jobId: string;
    stage: PipelineStage;
  } | null>(null);
  const stage = selected
    ? focus?.jobId === selected.id
      ? focus.stage
      : currentPipelineStage(selected)
    : "validation";
  const descriptor = pipelineStages.find((item) => item.id === stage)!;
  const state = selected ? pipelineState(selected)[stage] : "waiting";
  const events = selected
    ? stageEvents(invoiceEvents(snapshot, selected.id), stage)
    : [];
  const activeCount = snapshot.jobs.filter(
    (job) => !["dead", "delivered"].includes(job.stage),
  ).length;
  return (
    <section
      className={
        "panel pipeline-graph " + (motionPaused || stale ? "motion-paused" : "")
      }
      aria-labelledby="pipeline-graph-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">TRACE EACH RUN</p>
          <h2 id="pipeline-graph-title" ref={headingRef} tabIndex={-1}>
            Execution pipeline
          </h2>
          <p>Click a stage to open its checkpoint log.</p>
        </div>
        <div className="pipeline-controls">
          <span className="pipeline-run-count">{activeCount} in progress</span>
          <button
            className="text-button"
            aria-pressed={motionPaused}
            onClick={() => setMotionPaused(!motionPaused)}
          >
            {motionPaused ? "Resume animation" : "Pause animation"}
          </button>
        </div>
      </div>
      <div
        className="pipeline-scroll"
        role="group"
        aria-label="Invoice execution lanes"
        tabIndex={0}
      >
        <div className="pipeline-columns" aria-hidden="true">
          <span>INVOICE</span>
          {pipelineStages.map((item, i) => (
            <span key={item.id}>
              0{i + 1} / {item.title}
              <small>{item.owner}</small>
            </span>
          ))}
        </div>
        {!snapshot.jobs.length ? (
          <div className="pipeline-placeholder">
            <span>No runs yet</span>
            {pipelineStages.map((item) => (
              <div className="pipeline-empty-node" key={item.id}>
                <StateIcon state="waiting" />
                <span>
                  {item.title}
                  <small>Waiting for a batch</small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          snapshot.jobs.map((job) => {
            const states = pipelineState(job);
            return (
              <div
                className={
                  "pipeline-lane " +
                  (selected?.id === job.id ? "selected-lane" : "")
                }
                key={job.id}
              >
                <div className="lane-identity">
                  <strong>{job.id}</strong>
                  <small>{job.customer}</small>
                </div>
                {pipelineStages.map((item) => (
                  <div
                    className={"pipeline-stage-cell " + states[item.id]}
                    key={item.id}
                  >
                    <button
                      className={"pipeline-node " + states[item.id]}
                      aria-pressed={
                        selected?.id === job.id && stage === item.id
                      }
                      aria-label={`${job.id} · ${item.title}: ${nodeLabel(states[item.id], job.attempts)}`}
                      aria-controls="pipeline-stage-detail"
                      onClick={() => {
                        onSelect(job.id);
                        setFocus({ jobId: job.id, stage: item.id });
                      }}
                    >
                      <StateIcon state={states[item.id]} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {nodeLabel(states[item.id], job.attempts)}
                        </small>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
      {selected && (
        <div
          className="pipeline-detail"
          id="pipeline-stage-detail"
          role="region"
          aria-label="Selected stage log"
        >
          <div className="stage-log-heading">
            <div>
              <p className="eyebrow">
                {selected.id} / {descriptor.owner}
              </p>
              <h3>
                {descriptor.title}
                <span className={"stage-result " + state}>
                  {nodeLabel(state, selected.attempts)}
                </span>
              </h3>
            </div>
            <button
              className="secondary"
              onClick={() => onInspect(selected.id)}
            >
              Inspect invoice →
            </button>
          </div>
          <p className="stage-explanation">
            {state === "blocked"
              ? "Delivery is blocked until the PDF stage recovers. Inspect this invoice to replay it."
              : state === "failed"
                ? "Renderer retries are exhausted. The invoice is parked for manual replay; healthy lanes continue."
                : state === "waiting"
                  ? "This stage is waiting for the preceding checkpoint."
                  : state === "active" || state === "retrying"
                    ? "This is the current stage: queued or processing. Dots indicate pending work, not worker CPU activity."
                    : "This checkpoint has completed. Repeated messages can reuse the saved result."}
          </p>
          <ol
            className="stage-log"
            aria-label="Stage checkpoint events"
            tabIndex={0}
          >
            {events.map((event) => (
              <li key={event.id}>
                <time dateTime={event.created_at}>
                  {new Date(event.created_at).toISOString().slice(11, 19)}
                </time>
                <span>{event.message}</span>
              </li>
            ))}
          </ol>
          {!events.length && (
            <p className="stage-log-empty">
              No events for this stage in the available snapshot.
            </p>
          )}
        </div>
      )}
      <div className="pipeline-caption">
        <span>
          {stale
            ? "Connection interrupted. Animation stopped; showing the last known checkpoint."
            : live
              ? "Latest service snapshot. Fast stages may finish between polls."
              : "Browser simulation · paced checkpoints so you can follow each transition."}
        </span>
        <span>Pausing animation does not pause processing.</span>
      </div>
    </section>
  );
}
