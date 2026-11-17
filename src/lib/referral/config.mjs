// Referral requests: shared limits and option lists. Pure data, safe to import in the browser.
// The flow is described in docs/REFERRAL_REQUESTS.md.

// The company Yuqi can refer people to is not configured here: it is the current employer in the
// work history (src/lib/currentRole.mjs, src/lib/referral/availability.mjs).

export const RESUME_MAX_BYTES = 2 * 1024 * 1024;
export const INTRO_MIN = 200;
export const INTRO_MAX = 1500;
export const MAX_REFERRAL_ROLES = 3;

export const LIMITS = Object.freeze({
  name: 120, email: 320, profileUrl: 300, roleTitle: 140, jobUrl: 500, jobId: 60, location: 100,
  requirements: 1500, relationshipNote: 300, currentTitle: 140, whyRole: 800,
});

// How the applicant knows Yuqi. It is context for him, not a gate: "not_yet" is a valid answer.
export const RELATIONSHIPS = Object.freeze([
  { id: 'worked_together', label: 'We worked together' },
  { id: 'school', label: 'Same school or program' },
  { id: 'met', label: 'We met at an event or online' },
  { id: 'introduced', label: 'Someone introduced us' },
  { id: 'not_yet', label: "We haven't met yet" },
]);

// The owner's decision about a request.
export const STATUSES = Object.freeze(['new', 'reviewing', 'referred', 'declined', 'archived']);
// Where a request is in the pipeline: waiting for its file, waiting for the worker, being
// screened, ready to read, or its file was refused.
export const STATES = Object.freeze(['awaiting_upload', 'queued', 'screening', 'ready', 'file_rejected']);
// Closing a request deletes its résumé file straight away; otherwise the file goes after this many days.
export const RESUME_KEEP_DAYS = 30;
export const REQUEST_KEEP_DAYS = 180;
export const CLOSED_STATUSES = Object.freeze(['declined', 'archived']);
export const RECOMMENDATIONS = Object.freeze(['strong', 'promising', 'unclear', 'weak']);
export const RECOMMENDATION_LABELS = Object.freeze({
  strong: 'Strong match', promising: 'Promising', unclear: 'Needs a closer look', weak: 'Weak match',
});
