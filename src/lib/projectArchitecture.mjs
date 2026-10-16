// Editorial overviews, not live telemetry. Only the selected project is sent to the browser.
const step = (title, subtitle, icon, role, data, boundary) => ({ title, subtitle, icon, role, data, boundary });

const architectures = {
  "7c3715bf-7722-4df5-9e83-5d7e9493ea2c": {
    label: "Architecture overview",
    title: "One publish, several independent consumers",
    summary: "The platform commits content once, then builds search, AI knowledge and notifications from durable events.",
    outcome: "PostgreSQL owns the content. Downstream projections can be rebuilt independently.",
    steps: [
      step("Admin API", "Validate a change", "server", "An authenticated publishing request enters the content service.", "Content, publication state and version.", "Authorization and validation happen before the write."),
      step("PostgreSQL", "Commit + outbox", "database", "Content and its outgoing event are recorded in the same database transaction.", "Canonical content and a durable outbox entry.", "The event is not dependent on an in-memory callback after saving."),
      step("Kafka", "Distribute the event", "events", "The outbox publisher forwards committed changes to the event stream.", "Versioned content-change events.", "Delivery can repeat. Consumers must handle duplicates."),
      step("Consumers", "Index, enrich, notify", "layers", "Separate workers update search, RAG knowledge and notification delivery.", "OpenSearch documents, vector chunks and delivery work.", "A slow consumer does not need to block the original content write."),
      step("Website + AI", "Read the results", "browser", "Visitors browse published content, search it or ask the assistant a question.", "Public articles, search hits and cited answers.", "Public reads still apply publication and access rules."),
    ],
  },
  "8edf9020-39b6-4db4-83b3-43c459bef1cf": {
    label: "Architecture overview",
    title: "From published content to searchable knowledge",
    summary: "Search and RAG share a source of truth, but maintain separate, rebuildable indexes.",
    outcome: "Publishing is authoritative; keyword and vector indexes are derived views.",
    steps: [
      step("Publish", "Admin service", "server", "The content API validates the document and its publication state.", "Article or project content with its version.", "Draft and restricted content are not automatically public."),
      step("Save", "PostgreSQL + outbox", "database", "The document and a content-change event are committed together.", "Canonical content and its pending event.", "Indexing failures do not roll back an already committed publication."),
      step("Distribute", "Kafka", "events", "Workers receive the committed content change from the event stream.", "Content identity, version and change type.", "Independent consumers can retry and catch up separately."),
      step("Build indexes", "Search + RAG workers", "layers", "Search workers build documents; RAG workers prepare chunks and embeddings.", "Keyword fields and semantic chunks.", "Version and visibility must stay aligned with the source record."),
      step("Retrieve", "OpenSearch + pgvector", "search", "Queries retrieve keyword matches or semantic evidence for answers.", "Matching content, excerpts and source references.", "These indexes support retrieval; they do not replace the source of truth."),
    ],
  },
  "c049c604-50bd-4265-9318-866fd5f1a69e": {
    label: "Architecture overview",
    title: "A content event becomes a consent-aware email",
    summary: "Recipient selection and delivery are separate stages, with durable work between them.",
    outcome: "A subscription preference controls eligibility; delivery status records what happened next.",
    steps: [
      step("Content event", "Kafka", "events", "A published-content event starts notification processing.", "Content identity and notification category.", "Repeated events must not create uncontrolled duplicate work."),
      step("Recipients", "Consent + preferences", "users", "Fanout selects verified, active subscribers who opted into the category.", "Subscription status and topic preferences.", "An unsubscribed record is retained as inactive, not treated as a new recipient."),
      step("Delivery queue", "Durable recipient work", "database", "The service records delivery work for eligible recipients.", "Recipient, event and delivery state.", "Pending work survives a service restart."),
      step("Dispatch", "Claim + SMTP", "mail", "A worker claims pending work and attempts email delivery.", "Rendered email and provider response.", "Failures are recorded for controlled retry; an SMTP acceptance is not proof of reading."),
      step("Preferences", "Recipient-controlled", "shield", "Email links let recipients manage which updates they receive.", "Topic choices and unsubscribe status.", "Preference changes affect future eligibility without deleting delivery history."),
    ],
  },
  "37789a93-f60a-44e4-ab63-1479d036e686": {
    label: "Architecture overview",
    title: "From a page event to a privacy-aware aggregate",
    summary: "The browser sends a small event. The backend handles deduplication, aggregation and reporting.",
    outcome: "Public views show aggregates; detailed visitor records remain protected.",
    steps: [
      step("Browser", "First-party event", "browser", "The page reports a visit or a coarse reading milestone.", "An event ID, page and event type.", "Collection should not block rendering or require continuous scroll reporting."),
      step("Track API", "/api/track", "server", "The ingestion endpoint accepts the event and forwards it into the pipeline.", "A validated event envelope.", "The browser does not run the aggregation workload."),
      step("Kafka", "Event transport", "events", "The event stream decouples request handling from downstream processing.", "Queued visitor events.", "Repeated delivery is possible, so identity must survive transport."),
      step("Aggregator", "Deduplicate + roll up", "layers", "The worker deduplicates events and updates reporting aggregates.", "Session, page and coarse location aggregates.", "Retries should not inflate the same event's count."),
      step("Insights", "PostgreSQL + views", "chart", "Stored aggregates power trends and the public visitor globe.", "Summary counts and protected operator records.", "Public globe points are not precise individual locations."),
    ],
  },
  "da8e70ff-57f5-4a76-9250-b93677dae43c": {
    label: "Architecture overview",
    title: "Assisted form filling, with the owner in control",
    summary: "A browser extension requests governed field values; the user reviews them before filling.",
    outcome: "The final application submission remains a manual action.",
    steps: [
      step("Extension", "Inspect the form", "browser", "The owner-only MV3 extension identifies fields on the current application page.", "Field names and page context.", "The extension is a client, not an unrestricted submission agent."),
      step("MCP gateway", "Govern the request", "shield", "Tool requests pass through the gateway's authorization and policy boundary.", "A structured request for permitted field values.", "Access to applicant data stays behind the authenticated tool boundary."),
      step("Domain service", "Resolve values", "server", "The Java service resolves values from the applicant's stored information.", "Profile-backed field suggestions.", "Unknown values need user input rather than invented answers."),
      step("Review + fill", "Human approval", "check", "The user reviews the proposed values and approves filling the form.", "Reviewed values for the selected fields.", "Filling fields is separate from submitting an application."),
    ],
  },
  "0470298d-c74d-4d4b-be33-d948b033002a": {
    label: "Engineering workflow",
    title: "From a reproducible failure to an upstream fix",
    summary: "Reliability contributions across Spring AI Alibaba, LangExtract and the Kubernetes Java client.",
    outcome: "The evidence is in the upstream changes and regression tests, not a simulated service diagram.",
    steps: [
      step("Reproduce", "Isolate the failure", "search", "Start with the reported behavior and identify a minimal failing case.", "Inputs, expected behavior and observed failure.", "A plausible explanation is not enough without a reproducible case."),
      step("Fix", "Keep the scope focused", "code", "Change the behavior at the responsible boundary in the upstream codebase.", "A focused patch and its rationale.", "Preserve unrelated behavior and the project's conventions."),
      step("Verify", "Add regression coverage", "check", "Tests capture the failure and confirm the intended behavior after the change.", "Regression cases and test results.", "Coverage should exercise the failure mode, not only the happy path."),
      step("Contribute", "Upstream review", "git", "Submit the change for maintainer review and link the resulting pull request.", "Reviewed patches and merged pull-request evidence.", "Contribution scope is distinct from ownership of the entire upstream project."),
    ],
  },
  "a9b53277-08e9-4727-b136-86cd12e21f22": {
    label: "Architecture overview",
    title: "A request crosses explicit service boundaries",
    summary: "PolyglotBot combines a gateway, resilient microservices, asynchronous messaging and distributed tracing.",
    outcome: "Synchronous calls serve the request; asynchronous messages decouple follow-up work.",
    steps: [
      step("Client", "Send a request", "browser", "The client enters through the API gateway instead of calling every service directly.", "An authenticated API request.", "The gateway provides a consistent public entry point."),
      step("API gateway", "Authenticate + route", "shield", "The gateway handles authentication, TLS termination, rate limiting and routing.", "A validated request routed to its service.", "Routing and access control are separate from domain behavior."),
      step("Microservices", "Resilient execution", "server", "Services perform their domain work with Resilience4j protection around dependencies.", "Service requests, responses and trace context.", "Circuit breaking limits the effect of an unhealthy dependency."),
      step("Kafka", "Asynchronous work", "events", "Messages let consumers process work independently of the initiating request.", "Service events with traceable boundaries.", "Zipkin traces help follow calls across services; they are not the message store."),
    ],
  },
  "7e42b9d7-c888-429e-8b61-5a6888bf6699": {
    label: "Architecture overview",
    title: "Signal the call, then connect the peers",
    summary: "TalkNest uses Socket.IO for coordination and WebRTC for the audio/video connection.",
    outcome: "Call signaling and media are different paths. Chat messages and user state use Firestore.",
    steps: [
      step("Caller", "React client", "browser", "The caller chooses another user and starts a call from the web client.", "The target user and a WebRTC offer.", "User identity and socket identity serve different purposes."),
      step("Signaling", "Socket.IO", "events", "The signaling server relays call offers and answers to the intended peer.", "Connection-negotiation messages, not the video stream.", "Socket.IO coordinates the call; it is not the media transport."),
      step("Callee", "Accept + answer", "users", "The receiving client accepts the call and returns its negotiation response.", "A WebRTC answer and peer connection state.", "Acceptance precedes the active media session."),
      step("Media", "WebRTC / simple-peer", "video", "The negotiated peer connection carries audio and video between clients.", "Live media on the WebRTC connection.", "Persistent chat data is stored separately in Firebase Firestore."),
    ],
  },
  "e592bf77-4279-4a95-8257-3bd95f8f7eb9": {
    label: "Architecture overview",
    title: "From ingress to independently deployed services",
    summary: "GiftGalaxy routes requests into containerized services, with separate stores for different data needs.",
    outcome: "Docker, Helm and Skaffold support the service development and deployment workflow.",
    steps: [
      step("Client", "REST request", "browser", "The application sends a request to the platform's entry point.", "JSON API requests and responses.", "Clients do not need to discover individual service instances."),
      step("NGINX", "Ingress routing", "shield", "Ingress routes incoming traffic to the appropriate backend service.", "Requests matched to service routes.", "Public routing is separate from internal service discovery."),
      step("Kubernetes", "Containerized services", "layers", "Services run in containers and use Kubernetes service discovery.", "Domain requests between service boundaries.", "Deployment configuration and service code can evolve independently."),
      step("Data stores", "MongoDB + PostgreSQL", "database", "MongoDB stores user data; PostgreSQL holds recommendation data.", "Persistent data for each service's responsibilities.", "Persistent storage must outlive individual containers."),
    ],
  },
};

export function getProjectArchitecture(projectId) {
  return Object.hasOwn(architectures, projectId) ? architectures[projectId] : null;
}
