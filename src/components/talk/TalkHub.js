import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { Handshake, Mail, MessagesSquare } from "lucide-react";
import MessageForm from "./MessageForm";
import LiveChatPanel from "./LiveChatPanel";
import { TALK_PATH } from "./links";
import styles from "./Talk.module.css";

// The full form is only needed on /talk, so the home page does not download it.
const ReferralWizard = dynamic(() => import("./ReferralWizard"), { ssr: false });

export const INTENTS = [
  { id: "message", title: "Send a message", label: "Message", hint: "A note to my inbox. I reply by email.", icon: Mail },
  { id: "referral", title: "Ask for a referral", label: "Referral", hint: "About five minutes.", icon: Handshake },
  { id: "chat", title: "Chat or call live", label: "Live chat", hint: "On TalkNest, my chat and calling app.", icon: MessagesSquare },
];
const known = (value) => INTENTS.some((item) => item.id === value);
const CONTACT_INTENTS = INTENTS.filter(({ id }) => id !== "referral");
// The referral tab names the company it is for, or says that requests are closed.
const hintFor = (item, referral) => (item.id !== "referral" ? item.hint : referral?.company ? `At ${referral.company}. About five minutes.` : "Not open right now.");

// Shown instead of the form when there is nowhere to refer to (between jobs) or requests are switched off.
function ReferralClosed({ reason, onMessage }) {
  return (
    <div className={styles.hub}><div className={styles.explain}>
      <h3 className={styles.panelTitle}>Referral requests are closed right now</h3>
      <p>{reason === "no_employer"
        ? "I am between roles, so there is no company I can refer you to at the moment. This page opens again when that changes."
        : reason === "unknown"
          ? "This page could not check where I can refer you. Please try again in a few minutes."
          : "I am not taking referral requests at the moment. Please check back later."}</p>
      <div className={styles.explainActions}>
        <button type="button" className={styles.primary} onClick={onMessage}>Send me a message instead</button>
      </div>
    </div></div>
  );
}

// The home section offers message/chat; its separate referral link opens the full /talk form.
// `referral` comes from the page's static props: { company, reason } (src/lib/referral/availability.mjs).
// `syncUrl` keeps /talk's address in step with the open tab. A page with its own address (/referral) turns it off.
// `only` shows one panel with no chooser: the referral page is about one thing.
export default function TalkHub({ mode = "section", initialIntent = "message", referral = null, syncUrl = true, only = null }) {
  const router = useRouter();
  const choices = mode === "section" ? CONTACT_INTENTS : INTENTS;
  const startingIntent = choices.some(({ id }) => id === initialIntent) ? initialIntent : "message";
  const [intent, setIntent] = useState(startingIntent);
  // A panel stays mounted once opened, so switching tabs never discards a half-written form.
  const [opened, setOpened] = useState(() => new Set([startingIntent]));
  const tabs = useRef({});

  const show = (id) => {
    setIntent(id);
    setOpened((current) => (current.has(id) ? current : new Set(current).add(id)));
  };

  // /talk?intent=referral opens the referral form directly (static page, so the query arrives after hydration).
  useEffect(() => {
    if (mode !== "page" || !router.isReady) return;
    const wanted = Array.isArray(router.query.intent) ? router.query.intent[0] : router.query.intent;
    if (known(wanted)) show(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, router.isReady, router.query.intent]);

  const choose = (id) => {
    show(id);
    if (mode === "page" && syncUrl) {
      router.replace({ pathname: TALK_PATH, query: id === "message" ? {} : { intent: id } }, undefined, { shallow: true, scroll: false });
    }
  };

  const onKeyDown = (event) => {
    const index = choices.findIndex((item) => item.id === intent);
    const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: choices.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = choices[(next + choices.length) % choices.length].id;
    choose(target);
    tabs.current[target]?.focus();
  };

  return (
    <div className={styles.root} data-talk-hub={mode}>
      <div className={styles.hub} hidden={Boolean(only)}>
        <p className={mode === "section" ? styles.srOnly : styles.question} id={`talk-question-${mode}`}>What would you like to do?</p>
        <div className={styles.intents} role="tablist" aria-labelledby={`talk-question-${mode}`} onKeyDown={onKeyDown}>
          {choices.map(({ id, title, label, icon: Icon, ...item }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`talk-tab-${id}`}
              ref={(node) => { tabs.current[id] = node; }}
              className={styles.intent}
              aria-selected={intent === id}
              aria-label={title}
              aria-describedby={`talk-hint-${mode}-${id}`}
              aria-controls={`talk-panel-${id}`}
              tabIndex={intent === id ? 0 : -1}
              onClick={() => choose(id)}
            >
              <Icon size={20} className={styles.intentIcon} aria-hidden="true" />
              <span className={styles.intentTitle}>{mode === "section" ? label : title}</span>
              <span id={`talk-hint-${mode}-${id}`} className={`${styles.intentHint} ${mode === "section" ? styles.srOnly : ""}`}>{hintFor({ id, ...item }, referral)}</span>
            </button>
          ))}
        </div>
      </div>
      {choices.map(({ id }) => (
        <div key={id} className={styles.panel} role="tabpanel" id={`talk-panel-${id}`} aria-labelledby={`talk-tab-${id}`} hidden={intent !== id}>
          {opened.has(id) && id === "message" && <MessageForm />}
          {opened.has(id) && id === "referral" && (!referral?.company
            ? <ReferralClosed reason={referral?.reason} onMessage={() => { choose("message"); tabs.current.message?.focus(); }} />
            : <ReferralWizard key={referral.company} company={referral.company} plain={only === "referral"} />)}
          {opened.has(id) && id === "chat" && <LiveChatPanel onMessage={() => { choose("message"); tabs.current.message?.focus(); }} />}
        </div>
      ))}
    </div>
  );
}
