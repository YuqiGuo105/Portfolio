import Head from "next/head";
import Link from "next/link";
import { useState } from "react";
import BrowserActionPlan from "../src/components/BrowserActionPlan";
import RunReplay from "../src/components/RunReplay";

const CASES = [
  ["Publishing, step 3", { type: "diagram_step", flow: "publish-content", step: 3 }],
  ["Globe: Tokyo", { type: "globe_city", city: "Tokyo", lat: 35.68, lng: 139.69 }],
  ["Terminal: projects", { type: "terminal_command", command: "ls projects" }],
  ["Portfolio Platform", { type: "open_project", projectId: "7c3715bf-7722-4df5-9e83-5d7e9493ea2c" }],
];

export default function MrPotLab() {
  const [selected, setSelected] = useState(null);
  return <main style={{ maxWidth: 920, margin: "40px auto", padding: 24 }}>
    <Head><title>Mr. Pot | Local interaction lab</title><meta name="robots" content="noindex,nofollow" /></Head>
    <Link href="/"><a>Home</a></Link>
    <h1 style={{ fontSize: 28, marginTop: 24 }}>Mr. Pot / Interaction lab</h1>
    <p>Local controls preview. These buttons do not call a model.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{CASES.map(([label, action]) =>
      <button type="button" key={label} onClick={() => setSelected({ label, action })}>{label}</button>)}</div>
    {selected && <BrowserActionPlan key={selected.label} plan={{ schemaVersion: 1, autoStart: false, actions: [selected.action] }} />}
    <h2 style={{ fontSize: 20, marginTop: 40 }}>Execution record / fixture</h2>
    <RunReplay events={[
      { stage: "safety_check", label: "Input safety", status: "completed", durationMs: 90, inputTokens: null, outputTokens: null, costUsd: null },
      { stage: "routing", label: "Intent", status: "completed", durationMs: 180, inputTokens: null, outputTokens: null, costUsd: null },
      { stage: "generating", label: "Generation", status: "started", durationMs: null, inputTokens: null, outputTokens: null, costUsd: null },
    ]} sources={[{ title: "Public architecture history", url: "https://www.yuqi.site/architecture#evolution" }]} />
  </main>;
}

export function getServerSideProps() {
  return process.env.NODE_ENV === "development" ? { props: {} } : { notFound: true };
}
