import styles from "./TalkNestContact.module.css";

// Public TalkNest deployment; the query opens Yuqi's directory search after sign-in.
export default function TalkNestContact() {
  const href = "https://talknest-refresh.onrender.com/?connect=Yuqi%20Guo";
  return (
    <aside className={styles.card} aria-label="TalkNest contact option">
      <span className={styles.mark} aria-hidden="true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M20 11.5a8 8 0 0 1-8 8 8.5 8.5 0 0 1-3.5-.8L4 20l1.3-4.5a8.5 8.5 0 0 1-.8-3.5 8 8 0 0 1 8-8 7.5 7.5 0 0 1 7.5 7.5Z"/>
          <path d="M8 10h8M8 14h5"/>
        </svg>
      </span>
      <div className={styles.copy}>
        <strong>Prefer a conversation?</strong>
        <span>Meet on TalkNest — my chat &amp; calling project.</span>
      </div>
      <a href={href} target="_blank" rel="noopener noreferrer" className={styles.link}>
        Open TalkNest
        <span aria-hidden="true">↗</span>
      </a>
    </aside>
  );
}
