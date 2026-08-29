import styles from "./OpenSourceContributionCover.module.css";

const CONTRIBUTIONS = [
  {
    key: "alibaba",
    name: "Spring AI Alibaba",
    detail: "Agent recovery",
    logo: "/assets/images/open-source/alibaba-cloud.svg",
  },
  {
    key: "google",
    name: "Google LangExtract",
    detail: "Bounded retries",
    logo: "/assets/images/open-source/google.svg",
  },
  {
    key: "kubernetes",
    name: "Kubernetes Java",
    detail: "API correctness",
    logo: "/assets/images/open-source/kubernetes.svg",
  },
];

export default function OpenSourceContributionCover() {
  return (
    <div className={styles.cover} aria-label="Merged open-source contributions">
      <div className={styles.header}>
        <span className={styles.status} aria-hidden="true" />
        <span>Merged upstream</span>
        <strong>03</strong>
      </div>

      <div className={styles.panels}>
        {CONTRIBUTIONS.map((contribution, index) => (
          <div
            className={`${styles.panel} ${styles[contribution.key]}`}
            key={contribution.key}
          >
            <span
              className={styles.logo}
              style={{ backgroundImage: `url(${contribution.logo})` }}
              aria-hidden="true"
            />
            <div className={styles.copy}>
              <strong>{contribution.name}</strong>
              <span>{contribution.detail}</span>
            </div>
            <span className={styles.index}>0{index + 1}</span>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <strong>Reliability engineering</strong>
        <span>Recovery · Retry · Typed APIs</span>
      </div>
    </div>
  );
}
