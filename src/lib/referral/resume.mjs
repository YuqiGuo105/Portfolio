// Résumé checks. The browser uploads the PDF straight to private storage (it never passes through
// a serverless function), so the checks happen in two places:
//   resumeMeta()     at submit time, on what the browser declares (name, size, type);
//   inspectResume()  in the worker, on the stored bytes, before anything reads or links the file.
import { createHash } from 'node:crypto';
import { RESUME_MAX_BYTES } from './config.mjs';
import { ReferralError } from './fields.mjs';

// Features that make a PDF do something when opened. A résumé needs none of them. Best effort:
// compressed object streams can still hide them.
const ACTIVE = [/\/JavaScript\b/, /\/JS\s*[(<\d]/, /\/Launch\b/, /\/EmbeddedFile\b/, /\/RichMedia\b/];

export function safeFilename(value) {
  const base = typeof value === 'string' ? value.normalize('NFKC').split(/[\\/]/).pop() : '';
  const stem = base.replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '').slice(0, 70);
  return `${stem || 'resume'}.pdf`;
}

// What the browser says it is about to upload. Storage enforces the same size and type again.
export function resumeMeta(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ReferralError('resume_required', 400, 'resume');
  const size = Number(input.size);
  if (!Number.isInteger(size) || size < 1) throw new ReferralError('resume_required', 400, 'resume');
  if (size > RESUME_MAX_BYTES) throw new ReferralError('resume_too_large', 413, 'resume');
  if (input.type !== 'application/pdf') throw new ReferralError('resume_not_pdf', 400, 'resume');
  return { filename: safeFilename(input.name), size };
}

// The stored file, read once by the worker. Throws ReferralError with the reason it is refused.
export function inspectResume(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 200) throw new ReferralError('resume_not_pdf', 400, 'resume');
  if (bytes.length > RESUME_MAX_BYTES) throw new ReferralError('resume_too_large', 413, 'resume');
  const head = bytes.subarray(0, 1024).toString('latin1');
  const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString('latin1');
  if (!/^\s{0,8}%PDF-[12]\.\d/.test(head) || !tail.includes('%%EOF')) throw new ReferralError('resume_not_pdf', 400, 'resume');
  const text = bytes.toString('latin1');
  if (/\/Encrypt\b/.test(text)) throw new ReferralError('resume_protected', 400, 'resume');
  if (ACTIVE.some(pattern => pattern.test(text))) throw new ReferralError('resume_active_content', 400, 'resume');
  return { bytes, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
