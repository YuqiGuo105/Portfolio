import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import BrowserActionPlan from "../src/components/BrowserActionPlan";
import RunReplay from "../src/components/RunReplay";
import MrPotAvatar from "../src/components/MrPotAvatar";
import { POT_REACTIONS, POT_STATES } from "../src/lib/mrPotRig.mjs";
import TourPetFigure from "../src/components/tour/TourPetFigure";
import useTourPet from "../src/components/tour/useTourPet";
import { PET_ART } from "../src/lib/tourPetDrawing.mjs";
import { PET_GESTURES } from "../src/lib/tourPetRig.mjs";
import { tourPetGround } from "../src/lib/tourScene.mjs";

const STAGE = { width: 760, height: 380 };
const PET = { width: 144, height: 168 };
const SPOTS = { "top left": [24, 16], "top right": [592, 16], middle: [308, 106], "bottom left": [24, 196], "bottom right": [592, 196] };

// The guide's Mr. Pot on a small stage: everything he can do in the Vibe Guide, without starting it.
function GuidePetLab() {
  const { rig, wrapper, body, shadow, figure } = useTourPet({ width: PET.width });
  const [speaking, setSpeaking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => { rig.current.place({ x: SPOTS.middle[0], y: SPOTS.middle[1] }); rig.current.attend({ x: STAGE.width / 2, y: STAGE.height }); }, [rig]);
  useEffect(() => { rig.current.speak(speaking); }, [rig, speaking]);
  useEffect(() => { rig.current.wait(waiting); }, [rig, waiting]);
  const carry = event => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const stage = event.currentTarget.parentElement.getBoundingClientRect();
    if (!rig.current.held) rig.current.grab();
    rig.current.carry({ x: Math.min(Math.max(event.clientX - stage.left - PET.width / 2, 0), STAGE.width - PET.width), y: Math.min(Math.max(event.clientY - stage.top - PET.height / 2, 0), STAGE.height - PET.height) });
  };
  const button = { height: 36, padding: "0 14px" };
  return <div>
    <div style={{ position: "relative", width: "100%", maxWidth: STAGE.width, height: STAGE.height, borderRadius: 16, background: "#eef3ef", overflow: "hidden", "--st-pet-ground": `${tourPetGround(PET.width, PET.height)}px` }}>
      <div ref={wrapper} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={carry}
        onPointerUp={() => rig.current.release()} onPointerCancel={() => rig.current.release()}
        style={{ position: "absolute", left: 0, top: 0, width: PET.width, height: PET.height, cursor: "grab", touchAction: "none" }}>
        <div ref={body} style={{ width: "100%", height: "100%", transformOrigin: "50% var(--st-pet-ground)" }}><TourPetFigure ref={figure} /></div>
        <span ref={shadow} style={{ position: "absolute", left: "19%", right: "19%", top: "calc(var(--st-pet-ground) - 3px)", height: 8, borderRadius: "50%", background: "rgba(15,23,42,.22)", filter: "blur(3px)" }} />
      </div>
    </div>
    <div role="group" aria-label="Go to" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>{Object.entries(SPOTS).map(([name, [x, y]]) =>
      <button type="button" key={name} style={button} onClick={() => rig.current.travel({ x, y })}>{name}</button>)}
      <button type="button" style={button} onClick={() => { const at = rig.current.position; rig.current.travel({ x: Math.min(at.x + 150, STAGE.width - PET.width), y: at.y }); }}>a few steps right</button>
      <button type="button" style={button} onClick={() => { const at = rig.current.position; rig.current.travel({ x: Math.max(at.x - 150, 0), y: at.y }); }}>a few steps left</button>
      <button type="button" style={button} onClick={() => rig.current.travel(rig.current.position)}>new chapter, same spot</button></div>
    <div role="group" aria-label="Performance" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>{PET_GESTURES.map(name =>
      <button type="button" key={name} style={button} onClick={() => rig.current.perform(name, 4)}>{name}</button>)}
      <button type="button" style={button} aria-pressed={speaking} onClick={() => setSpeaking(value => !value)}>narrating</button>
      <button type="button" style={button} aria-pressed={waiting} onClick={() => setWaiting(value => !value)}>page on its way</button></div>
    <p style={{ fontSize: 13 }}>Drag him to carry him. The illustration is {PET_ART.width} × {PET_ART.height}; his face and steam are drawn over it.</p>
  </div>;
}

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
    <h2 style={{ fontSize: 20, marginTop: 40 }}>Mr. Pot / the guide</h2>
    <p>The figure that leads the Vibe Guide. He walks a short way, jumps a long one, and performs while you read.</p>
    <GuidePetLab />
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
