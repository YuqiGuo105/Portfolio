// Shared fixtures for the referral tests: a small valid PDF and a complete form.
import { randomUUID } from 'node:crypto';

export function pdf(extra = '', { pad = 300 } = {}) {
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`
    + `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n${extra}\n% ${'x'.repeat(pad)}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}
export const INTRO = 'Alex Chen is a backend engineer with five years of experience building payment services in Java. At Northwind, Alex led the migration of the ledger service to Kafka and cut settlement delay from hours to minutes. Alex is interested in the Platform role because of its scale.';
export function form(overrides = {}) {
  return {
    name: 'Alex Chen', email: 'Alex@Example.com', profileUrl: 'https://www.linkedin.com/in/alex-example',
    roleTitle: 'Associate, Software Engineering', jobUrl: 'https://higher.gs.com/roles/123456', jobId: '123456', location: 'New York',
    requirements: 'Java services at scale; Kafka; on-call.', relationship: 'school', relationshipNote: 'Syracuse, 2023',
    currentTitle: 'Software Engineer II at Northwind', years: 5, intro: INTRO, whyRole: 'Wants to work on settlement systems.',
    consent: true, website: '', turnstileToken: 'valid-token', idempotencyKey: randomUUID(), company: 'Goldman Sachs',
    resume: { name: 'Alex Chen Resume.pdf', size: pdf().length, type: 'application/pdf' },
    ...overrides,
  };
}
export const AI_NOTE = {
  recommendation: 'strong', fit: 82, summary: 'Five years of Java payments work with a Kafka migration that matches the posting.',
  strengths: ['Led a Kafka ledger migration.'], concerns: ['No on-call evidence.'], followUps: ['Which team owned on-call?'],
  consistency: 'consistent', flags: [],
};
export const request = (body = form()) => ({ method: 'POST', headers: { origin: 'https://www.yuqi.site', host: 'www.yuqi.site', 'content-type': 'application/json' },
  socket: { remoteAddress: '203.0.113.7' }, body });
export const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });

// Where referrals are open, as src/lib/referral/availability.mjs reports it.
export const openFor = (company = 'Goldman Sachs', extra = {}) => {
  const state = { company, accepting: Boolean(company), reason: company ? null : 'no_employer', role: company ? { company, title: 'Software Engineer', since: 'Dec 2024' } : null, switchedOn: true, known: true, ...extra };
  return { state, get: async () => state, clear() { state.cleared = (state.cleared || 0) + 1; } };
};
