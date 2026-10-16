import { useId, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, CheckCircle2, Code2, Database,
  GitPullRequest, Layers, Mail, Monitor, Network, Search, Server,
  ShieldCheck, Users, Video, BarChart3,
} from "lucide-react";
import styles from "./ProjectArchitectureOverview.module.css";

const icons = {
  browser: Monitor, server: Server, database: Database, events: Network,
  layers: Layers, search: Search, users: Users, mail: Mail,
  shield: ShieldCheck, chart: BarChart3, check: CheckCircle2,
  code: Code2, git: GitPullRequest, video: Video,
};

export default function ProjectArchitectureOverview({ architecture }) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef([]);
  const id = useId();
  const { steps } = architecture;
  const step = steps[selected];
  const Icon = icons[step.icon] || Server;

  const onKeyDown = (event, index) => {
    let next;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % steps.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + steps.length - 1) % steps.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = steps.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  };

  return (
    <section className={styles.overview} aria-labelledby={`${id}-title`}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>{architecture.label}</p>
        <h2 id={`${id}-title`}>{architecture.title}</h2>
        <p>{architecture.summary}</p>
      </header>
      <div className={styles.flow} role="tablist" aria-label="Architecture steps" style={{ "--step-count": steps.length }}>
        {steps.map((item, index) => {
          const StepIcon = icons[item.icon] || Server;
          return (
            <div className={styles.node} key={item.title} role="presentation">
              <button
                type="button" role="tab" id={`${id}-step-${index}`}
                aria-controls={`${id}-detail`} aria-selected={selected === index}
                tabIndex={selected === index ? 0 : -1}
                ref={element => { tabs.current[index] = element; }}
                onClick={() => setSelected(index)} onKeyDown={event => onKeyDown(event, index)}
                className={styles.step}
              >
                <span className={styles.stepTop}><StepIcon size={20} aria-hidden="true" /><span>{String(index + 1).padStart(2, "0")}</span></span>
                <strong>{item.title}</strong>
                <span className={styles.subtitle}>{item.subtitle}</span>
              </button>
              {index < steps.length - 1 && <span className={styles.connector} aria-hidden="true"><ArrowRight className={styles.horizontal} size={16} /><ArrowDown className={styles.vertical} size={16} /></span>}
            </div>
          );
        })}
      </div>
      <div id={`${id}-detail`} role="tabpanel" aria-labelledby={`${id}-step-${selected}`} className={styles.detail} tabIndex={0}>
        <div className={styles.detailHeading}>
          <h3><Icon size={20} aria-hidden="true" />{step.title}</h3>
          <div className={styles.navigation}>
            <span>{selected + 1} / {steps.length}</span>
            <button type="button" aria-label="Previous step" title="Previous step" disabled={selected === 0} onClick={() => setSelected(selected - 1)}><ArrowLeft size={18} /></button>
            <button type="button" aria-label="Next step" title="Next step" disabled={selected === steps.length - 1} onClick={() => setSelected(selected + 1)}><ArrowRight size={18} /></button>
          </div>
        </div>
        <dl className={styles.facts}>
          <div><dt>Responsibility</dt><dd>{step.role}</dd></div>
          <div><dt>Data</dt><dd>{step.data}</dd></div>
          <div><dt>Design boundary</dt><dd>{step.boundary}</dd></div>
        </dl>
      </div>
      <p className={styles.outcome}><CheckCircle2 size={17} aria-hidden="true" /><span>{architecture.outcome}</span></p>
    </section>
  );
}
