import { ArrowUpRight } from "lucide-react";
import { TALKNEST_URL } from "./links";
import styles from "./Talk.module.css";

// TalkNest is a separate app (sign-in, real-time messages, voice and video). This panel sets
// expectations before sending anyone there, and points back to the message form for anything
// that needs a dependable answer.
export default function LiveChatPanel({ onMessage }) {
  return (
    <div className={styles.hub}><div className={styles.explain}>
      <h3 className={styles.panelTitle}>Chat or call me on TalkNest</h3>
      <p>TalkNest is the chat and calling app I built. Text is saved, so you can write even when I am offline; voice and video calls need both of us there at the same time.</p>
      <ol className={styles.sequence}>
        <li>Open TalkNest and sign in with Google or an email address.</li>
        <li>You land in a conversation with me. No need to search for my name.</li>
        <li>Write a message, or use the call buttons when I am online.</li>
      </ol>
      <div className={styles.explainActions}>
        <a className={styles.primary} href={TALKNEST_URL} target="_blank" rel="noopener noreferrer">
          Open TalkNest <ArrowUpRight size={17} aria-hidden="true" />
        </a>
        <button type="button" className={styles.textButton} onClick={onMessage}>Send a message instead</button>
      </div>
      <p className={styles.small} style={{ marginTop: 14 }}>TalkNest opens in a new tab and runs on a small free server, so the first load can take up to a minute. For anything that needs a reply by a certain day, a message is the safer choice.</p>
    </div></div>
  );
}
