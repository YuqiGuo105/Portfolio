import { ArrowLeft, ArrowRight, ArrowUpRight, GitCommitHorizontal, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./ArchitectureTimeMachine.module.css";
import { evolutionBoxes, evolutionScene, formatMilestoneDate } from "../lib/architectureEvolution.mjs";

const TYPE_LABEL = { decision: "Decision", incident: "Incident", milestone: "Milestone" };
const STEP_MS = 4800;
// Up to this many changed connections are listed openly; more fold into a disclosure.
const OPEN_LIST = 3;

/** Contiguous runs of milestones that share a phase, for the labels above the timeline. */
function phaseRuns(milestones) {
  const runs = [];
  milestones.forEach((milestone, index) => {
    const last = runs[runs.length - 1];
    if (last && last.phase === milestone.phase) last.end = index;
    else runs.push({ phase: milestone.phase, start: index, end: index });
  });
  return runs;
}

/** Band backgrounds meet halfway between neighbouring bands. */
function bandRows(layout) {
  return layout.bands.map((band, index) => {
    const previous = layout.bands[index - 1];
    const next = layout.bands[index + 1];
    const top = previous ? (previous.y + band.y) / 2 : 0;
    const bottom = next ? (band.y + next.y) / 2 : layout.height;
    return { ...band, top, height: bottom - top };
  });
}

/**
 * The architecture time machine. On /architecture it fills the page; `variant="embedded"` drops it into a project
 * page: stacked (diagram, timeline, story), themed for the site's dark skin, with a link to the full view.
 */
export default function ArchitectureTimeMachine({ data, initialId, onChange, variant = "page", heading }) {
  const { milestones, layout } = data;
  const count = milestones.length;
  const [index, setIndex] = useState(() => Math.max(0, milestones.findIndex((item) => item.id === initialId)));
  const [playing, setPlaying] = useState(false);
  const boxes = useMemo(() => evolutionBoxes(data), [data]);
  const order = useMemo(() => new Map(milestones.map((item, position) => [item.id, position])), [milestones]);
  const runs = useMemo(() => phaseRuns(milestones), [milestones]);
  const rows = useMemo(() => bandRows(layout), [layout]);
  const { state, focus, links, labels, tags, touched } = useMemo(() => evolutionScene(data, index, boxes), [data, index, boxes]);
  const milestone = state.milestone;
  const percent = (position) => (count > 1 ? (position / (count - 1)) * 100 : 0);
  const graphRef = useRef(null);
  const embedded = variant === "embedded";
  const titleId = `time-machine-title${useId().replace(/:/g, "")}`;

  // On narrow screens the diagram scrolls sideways: bring the part that changed into view.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.scrollWidth <= graph.clientWidth + 1) return;
    const changed = [...state.nodes.filter((node) => node.status !== "active").map((node) => node.id), ...focus.nodes];
    const ids = changed.length ? changed : [...touched];
    const xs = ids.map((id) => boxes.get(id)).filter(Boolean).flatMap((box) => [box.x, box.x + box.w]);
    if (!xs.length) return;
    const scale = graph.scrollWidth / layout.width;
    const center = ((Math.min(...xs) + Math.max(...xs)) / 2) * scale;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    graph.scrollTo({ left: Math.max(0, center - graph.clientWidth / 2), behavior: reduced ? "auto" : "smooth" });
  }, [state, touched, focus, boxes, layout.width]);

  useEffect(() => {
    const target = milestones.findIndex((item) => item.id === initialId);
    if (target >= 0) setIndex(target);
  }, [initialId, milestones]);

  const go = useCallback((next, { stop = true } = {}) => {
    const clamped = Math.min(count - 1, Math.max(0, next));
    if (stop) setPlaying(false);
    setIndex(clamped);
    onChange?.(milestones[clamped].id);
  }, [count, milestones, onChange]);

  useEffect(() => {
    if (!playing) return undefined;
    if (index >= count - 1) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => go(index + 1, { stop: false }), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, count, go]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Playing from the last step starts the story over.
    if (index >= count - 1) go(0, { stop: false });
    setPlaying(true);
  };

  const onKeyDown = (event) => {
    if (event.target.closest("input, a, summary")) return;
    if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
    if (event.key === "Home") { event.preventDefault(); go(0); }
    if (event.key === "End") { event.preventDefault(); go(count - 1); }
  };

  const liveCount = state.nodes.filter((node) => node.status !== "retired").length;
  const summary = `${formatMilestoneDate(milestone.date)}: ${liveCount} components. ${milestone.title}.`;
  const changedLinks = [
    ...state.addedLinks.map((text) => ({ text, kind: "added" })),
    ...state.retiredLinks.map((text) => ({ text, kind: "retired" })),
  ];
  const linkList = (
    <ul className={styles.linkList}>
      {changedLinks.map((item) => <li key={`${item.kind}${item.text}`} className={styles[item.kind]}>{item.text}</li>)}
    </ul>
  );
  const countText = [
    state.addedLinks.length ? `${state.addedLinks.length} new connection${state.addedLinks.length > 1 ? "s" : ""}` : "",
    state.retiredLinks.length ? `${state.retiredLinks.length} retired` : "",
  ].filter(Boolean).join(" · ");

  const renderLink = (link) => {
    const { d } = link.geometry;
    const draws = link.role === "new" && !link.dashed;
    const dashed = link.dashed || link.role === "retired";
    return (
      <g key={link.id} className={`${styles.link} ${styles[`link_${link.kind}`]} ${styles[`role_${link.role}`]}`} data-link={`${link.from}>${link.to}`}>
        <title>{`${link.label || `${link.from} → ${link.to}`} · since ${formatMilestoneDate(milestones[order.get(link.since)].date)}`}</title>
        <path d={d} className={styles.halo} />
        {/* New solid links draw themselves in; pathLength=1 makes the dash animation length-independent. */}
        <path d={d} className={`${styles.stroke} ${draws ? styles.draw : ""}`} pathLength={draws ? 1 : undefined}
          strokeDasharray={dashed ? "6 5" : undefined} markerEnd={`url(#tm-arrow-${link.kind})`} />
      </g>
    );
  };
  const layer = (role) => links.filter((link) => link.role === role).map(renderLink);

  return (
    <section className={`${styles.machine} ${embedded ? styles.embedded : ""}`} aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className={styles.toolbar}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{heading?.eyebrow || "ARCHITECTURE TIME MACHINE"}</span>
          <h2 id={titleId}>{heading?.title || "From one Next.js app to an event-driven platform"}</h2>
          <p>{heading?.intro || `${count} steps, each with the decision or incident behind it and the commits that prove it. Drag the timeline, use the arrow keys or press play.`}</p>
          {embedded && (
            <a className={styles.fullLink} href={`/architecture#evolution/${milestone.id}`}>
              Open the full time machine <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          )}
        </div>
        <div className={styles.transport} role="group" aria-label="Time machine controls">
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous step" title="Previous step">
            <ArrowLeft size={18} />
          </button>
          <button type="button" className={styles.play} onClick={togglePlay} aria-pressed={playing} title={playing ? "Pause" : "Play the history"}>
            {playing ? <Pause size={17} /> : index >= count - 1 ? <RotateCcw size={17} /> : <Play size={17} />}
            <span>{playing ? "Pause" : index >= count - 1 ? "Replay" : "Play"}</span>
          </button>
          <button type="button" onClick={() => go(index + 1)} disabled={index === count - 1} aria-label="Next step" title="Next step">
            <ArrowRight size={18} />
          </button>
          <output className={styles.counter} aria-live="off">{String(index + 1).padStart(2, "0")}<span> / {String(count).padStart(2, "0")}</span></output>
        </div>
      </header>

      <div className={styles.stage}>
        <div className={styles.main}>
          <div className={styles.graph} ref={graphRef}>
            <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={summary} className={styles.svg}>
              <defs>
                {["request", "event", "data"].map((kind) => (
                  <marker key={kind} id={`tm-arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className={styles[`arrow_${kind}`]} />
                  </marker>
                ))}
              </defs>
              {rows.map((band, position) => (
                <g key={band.id}>
                  <rect x="0" y={band.top} width={layout.width} height={band.height} className={position % 2 ? styles.bandOdd : styles.bandEven} data-band={band.id} />
                  <text x="16" y={band.sub ? band.y - 1 : band.y + 4} className={styles.bandLabel}>{band.label}</text>
                  {band.sub && <text x="16" y={band.y + 12} className={styles.bandSub}>{band.sub}</text>}
                </g>
              ))}
              <g>{layer("active")}</g>
              <g>{layer("retired")}</g>
              <g>{layer("focus")}</g>
              <g>{layer("new")}</g>
              {state.nodes.map((node) => {
                const box = boxes.get(node.id);
                const origin = order.get(node.since);
                const focused = focus.nodes.has(node.id);
                const quiet = node.status === "active" && !focused && !touched.has(node.id);
                const classes = [
                  styles.node,
                  styles[`is_${node.status}`],
                  focused ? styles.focused : "",
                  focused && milestone.type === "incident" ? styles.incident : "",
                  quiet ? styles.quiet : "",
                ].join(" ");
                return (
                  <g key={node.id} className={classes} data-node={node.id} style={{ transformOrigin: `${box.cx}px ${box.cy}px` }}
                    role="button" tabIndex={0} aria-label={`${node.label}: added ${formatMilestoneDate(milestones[origin].date)}, ${milestones[origin].title}. Jump there.`}
                    onClick={() => go(origin)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); go(origin); } }}>
                    <title>{`Since ${formatMilestoneDate(milestones[origin].date)}: ${milestones[origin].title}`}</title>
                    <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="8" className={styles.nodeBox} />
                    <rect x={box.x} y={box.y + 6} width="3.5" height={box.h - 12} rx="1.75" className={styles[`accent_${node.band}`]} />
                    <text x={box.cx} y={box.cy - 3} textAnchor="middle" className={styles.nodeTitle}>{node.label}</text>
                    <text x={box.cx} y={box.cy + 12} textAnchor="middle" className={styles.nodeSub}>{node.sub}</text>
                    {tags.has(node.id) && <text x={tags.get(node.id).x} y={tags.get(node.id).y} textAnchor={tags.get(node.id).anchor} className={styles.newTag}>NEW</text>}
                  </g>
                );
              })}
              {links.map((link) => {
                const spot = labels.get(link.id);
                if (!spot) return null;
                return (
                  <text key={`label-${link.id}`} x={spot.x} y={spot.y} textAnchor={spot.anchor}
                    className={`${styles.linkLabel} ${styles[`label_${link.kind}`]}`}>
                    {link.label}
                  </text>
                );
              })}
            </svg>
          </div>

          <div className={styles.timeline}>
            <div className={styles.phases} aria-hidden="true">
              {runs.map((run) => (
                <span key={`${run.phase}-${run.start}`} className={index >= run.start && index <= run.end ? styles.phaseActive : ""}
                  style={{ left: `${percent(run.start)}%`, width: `${Math.max(percent(run.end) - percent(run.start), 0)}%` }}>
                  <i>{run.phase}</i>
                </span>
              ))}
            </div>
            <div className={styles.track}>
              <div className={styles.progress} style={{ width: `${percent(index)}%` }} />
              {milestones.map((item, position) => (
                <button key={item.id} type="button" onClick={() => go(position)}
                  className={[styles.dot, styles[`dot_${item.type}`], position === index ? styles.dotCurrent : "", position < index ? styles.dotPast : ""].join(" ")}
                  style={{ left: `${percent(position)}%` }}
                  aria-label={`${formatMilestoneDate(item.date)}: ${item.title} (${TYPE_LABEL[item.type].toLowerCase()})`}
                  aria-current={position === index ? "step" : undefined} title={`${formatMilestoneDate(item.date)} · ${item.title}`}>
                  <span className={styles.dotDate}>{position === 0 || item.date.slice(0, 4) !== milestones[position - 1].date.slice(0, 4) ? formatMilestoneDate(item.date).replace(/ \d+,/, "") : formatMilestoneDate(item.date, { short: true })}</span>
                </button>
              ))}
              <input type="range" min="0" max={count - 1} step="1" value={index} className={styles.range}
                onChange={(event) => go(Number(event.target.value))}
                aria-label="Timeline" aria-valuetext={`${formatMilestoneDate(milestone.date)}: ${milestone.title}`} />
            </div>
            <div className={styles.legend} aria-hidden="true">
              <span><i className={styles.key_decision} />Decision</span>
              <span><i className={styles.key_incident} />Incident</span>
              <span><i className={styles.key_milestone} />Milestone</span>
              <span className={styles.legendLine}><b className={styles.line_request} />request</span>
              <span className={styles.legendLine}><b className={styles.line_event} />event</span>
              <span className={styles.legendLine}><b className={styles.line_data} />data</span>
              <span className={styles.legendNew}>NEW · added in this step</span>
            </div>
          </div>
        </div>

        <aside className={`${styles.detail} ${styles[`type_${milestone.type}`]}`} aria-live="polite" key={milestone.id}>
          <div className={styles.story}>
            <div className={styles.meta}>
              <span className={styles.badge}>{TYPE_LABEL[milestone.type]}</span>
              <time dateTime={milestone.date}>{formatMilestoneDate(milestone.date)}</time>
              <span className={styles.phase}>{milestone.phase}</span>
            </div>
            <h3>{milestone.title}</h3>
            <p className={styles.summary}>{milestone.summary}</p>
            <dl className={styles.sections}>
              {milestone.sections.map((section) => (
                <div key={section.label}>
                  <dt>{section.label}</dt>
                  <dd>{section.text}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className={styles.record}>
            {(state.addedNodes.length > 0 || state.retiredNodes.length > 0 || changedLinks.length > 0) && (
              <div className={styles.changes}>
                <span className={styles.changesTitle}>On the diagram</span>
                {(state.addedNodes.length > 0 || state.retiredNodes.length > 0) && (
                  <ul className={styles.chips}>
                    {state.addedNodes.map((text) => <li key={`+${text}`} className={styles.chipAdded}>{text}</li>)}
                    {state.retiredNodes.map((text) => <li key={`-${text}`} className={styles.chipRetired}>{text}</li>)}
                  </ul>
                )}
                {changedLinks.length > 0 && changedLinks.length <= OPEN_LIST && linkList}
                {changedLinks.length > OPEN_LIST && (
                  <details className={styles.more}>
                    <summary>{countText}</summary>
                    {linkList}
                  </details>
                )}
              </div>
            )}
            <div className={styles.evidence}>
              <span className={styles.changesTitle}>Evidence</span>
              <ul>
                {milestone.evidence.map((item) => (
                  <li key={`${item.repo}@${item.sha}`}>
                    <a href={`https://github.com/${data.owner}/${item.repo}/commit/${item.sha}`} target="_blank" rel="noreferrer">
                      <GitCommitHorizontal size={15} aria-hidden="true" />
                      <span className={styles.sha}>{item.repo}@{item.sha}</span>
                      <span className={styles.commitText}>{item.text}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
