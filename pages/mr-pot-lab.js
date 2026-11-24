import Head from "next/head";
import Link from "next/link";
import { useState } from "react";
import BrowserActionPlan from "../src/components/BrowserActionPlan";
import RunReplay from "../src/components/RunReplay";
import MrPotAvatar from "../src/components/MrPotAvatar";
import { POT_REACTIONS, POT_STATES } from "../src/lib/mrPotRig.mjs";

const CASES = [
  ["Publishing, step 3", { type: "diagram_step", flow: "publish-content", step: 3 }],
  ["Globe: Tokyo", { type: "globe_city", city: "Tokyo", lat: 35.68, lng: 139.69 }],
  ["Terminal: projects", { type: "terminal_command", command: "ls projects" }],
  ["Portfolio Platform", { type: "open_project", projectId: "7c3715bf-7722-4df5-9e83-5d7e9493ea2c" }],
];

export default function MrPotLab() {
  const [selected, setSelected] = useState(null);
  const [mood, setMood] = useState("idle");
  const [reaction, setReaction] = useState(null);
  return <main style={{ maxWidth: 920, margin: "40px auto", padding: 24 }}>
    <Head><title>Mr. Pot | Local interaction lab</title><meta name="robots" content="noindex,nofollow" /></Head>
    <Link href="/"><a>Home</a></Link>
    <h1 style={{ fontSize: 28, marginTop: 24 }}>Mr. Pot / Interaction lab</h1>
    <p>Local controls preview. These buttons do not call a model.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{CASES.map(([label, action]) =>
      <button type="button" key={label} onClick={() => setSelected({ label, action })}>{label}</button>)}</div>
    {selected && <BrowserActionPlan key={selected.label} plan={{ schemaVersion: 1, autoStart: false, actions: [selected.action] }} />}
    <h2 style={{ fontSize: 20, marginTop: 40 }}>Mr. Pot / every look</h2>
    <p>States come from the conversation. Reactions are short and only play while he is at rest or has just finished.</p>
    <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
      <div style={{ padding: 28, borderRadius: 16, background: "#fbf5ee" }}><MrPotAvatar state={mood} size="large" reaction={reaction} announce /></div>
      <div style={{ display: "grid", gap: 12 }}>
        <div role="group" aria-label="State" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{POT_STATES.map(name =>
          <button type="button" key={name} aria-pressed={mood === name} onClick={() => setMood(name)} style={{ height: 36, padding: "0 14px" }}>{name}</button>)}</div>
        <div role="group" aria-label="Reaction" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{Object.keys(POT_REACTIONS).map(name =>
          <button type="button" key={name} onClick={() => setReaction(current => ({ name, id: (current?.id || 0) + 1 }))} style={{ height: 36, padding: "0 14px" }}>{name}</button>)}</div>
      </div>
    </div>
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
