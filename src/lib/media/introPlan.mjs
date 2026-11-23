// Keep the overview at one minute; each source remains independently playable in its article.
export const INTRO_SEGMENTS = Object.freeze([
  { source: 'platform-walkthrough', start: 0, end: 19.208333, seconds: 8, title: 'Portfolio', caption: 'Yuqi Guo / Backend and distributed systems\nExplore the portfolio and its projects.' },
  { source: 'open-source', start: 0, end: 6, seconds: 6, title: 'Open source', caption: 'Eight merged pull requests across five projects\nActual GitHub PR pages' },
  { source: 'content-intelligence', start: 0, end: 24, seconds: 14, title: 'Content + AI', caption: 'Publish through Postgres, Outbox and Kafka\nSearch indexing and grounded AI retrieval' },
  { source: 'talknest', start: 0, end: 14, seconds: 8, title: 'TalkNest', caption: 'TalkNest / Messages and call controls\nRecorded from the live app interactive preview' },
  { source: 'notifications', start: 0, end: 10, seconds: 6, title: 'Notifications', caption: 'Subscriptions and notifications\nChoose interests and delivery channels' },
  { source: 'blog-github-operations', start: 12, end: 18, seconds: 6, title: 'CI/CD', caption: 'GitHub Operations / Deploy and verify\nIllustrative article animation' },
  { source: 'blog-docker-kubernetes', start: 12, end: 18, seconds: 6, title: 'Containers', caption: 'Docker and Kubernetes / Reconcile workloads\nIllustrative article animation' },
  { source: 'blog-e2e-testing', start: 12, end: 18, seconds: 6, title: 'End-to-end tests', caption: 'End-to-end testing / Verify the complete outcome\nExplore the articles for the full walkthroughs.' },
]);
