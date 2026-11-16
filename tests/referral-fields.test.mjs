import test from 'node:test';
import assert from 'node:assert/strict';
import { ReferralError, firstPersonWords, hasPlaceholder, httpsUrl, idempotencyKey, introTemplate, introVoice, referralFields } from '../src/lib/referral/fields.mjs';
import { inspectResume, resumeMeta, safeFilename } from '../src/lib/referral/resume.mjs';
import { RESUME_MAX_BYTES } from '../src/lib/referral/config.mjs';
import { INTRO, form, pdf } from './referral-fixtures.mjs';

const code = fn => { try { fn(); } catch (error) { assert.ok(error instanceof ReferralError, String(error)); return `${error.code}:${error.field}`; } return 'ok'; };

test('a complete form is normalised and carries nothing the applicant did not type', () => {
  const fields = referralFields(form());
  assert.equal(fields.email, 'alex@example.com');
  assert.equal(fields.years, 5);
  assert.equal(fields.jobUrl, 'https://higher.gs.com/roles/123456');
  assert.deepEqual(Object.keys(fields).sort(), ['currentTitle', 'email', 'intro', 'jobId', 'jobUrl', 'location', 'name', 'profileUrl',
    'relationship', 'relationshipNote', 'requirements', 'roleTitle', 'whyRole', 'years']);
});

test('optional fields may be left empty', () => {
  const fields = referralFields(form({ profileUrl: '', jobId: '', location: '', requirements: '', relationshipNote: '', currentTitle: '', years: '', whyRole: '' }));
  assert.equal(fields.years, null); assert.equal(fields.profileUrl, ''); assert.equal(fields.requirements, '');
});

for (const [label, change, expected] of [
  ['missing name', { name: ' ' }, 'missing_field:name'],
  ['bad email', { email: 'nope' }, 'invalid_field:email'],
  ['missing role', { roleTitle: '' }, 'missing_field:roleTitle'],
  ['missing posting link', { jobUrl: '' }, 'missing_field:jobUrl'],
  ['http posting link', { jobUrl: 'http://higher.gs.com/roles/1' }, 'invalid_field:jobUrl'],
  ['script posting link', { jobUrl: 'javascript:alert(1)' }, 'invalid_field:jobUrl'],
  ['profile link with credentials', { profileUrl: 'https://user:pw@example.com' }, 'invalid_field:profileUrl'],
  ['unknown relationship', { relationship: 'best_friend' }, 'invalid_field:relationship'],
  ['no relationship', { relationship: '' }, 'missing_field:relationship'],
  ['negative years', { years: -1 }, 'invalid_field:years'],
  ['fractional years', { years: 2.5 }, 'invalid_field:years'],
  ['short introduction', { intro: 'Alex Chen is an engineer.' }, 'intro_too_short:intro'],
  ['first-person introduction', { intro: INTRO.replaceAll('Alex Chen is', 'I am').replaceAll('Alex', 'I') }, 'intro_not_third_person:intro'],
  ['an unfilled template', { intro: `Alex Chen is a [current title] with [N] years of experience in payments. ${'Alex builds reliable services. '.repeat(8)}` }, 'intro_placeholder:intro'],
  ['role too long', { roleTitle: 'x'.repeat(141) }, 'too_long:roleTitle'],
  ['object instead of text', { name: { a: 1 } }, 'invalid_field:name'],
  ['no consent', { consent: 'yes' }, 'consent_required:consent'],
]) test(`rejects ${label}`, () => assert.equal(code(() => referralFields(form(change))), expected));

test('rejects a body that is not an object', () => {
  for (const body of [null, [], 'text']) assert.equal(code(() => referralFields(body)), 'invalid_fields:null');
});

test('single-line fields cannot smuggle line breaks or hidden characters', () => {
  const fields = referralFields(form({ name: 'Alex\r\nBcc: x@example.com', roleTitle: 'Engineer‮ gnitset' }));
  assert.equal(fields.name, 'Alex Bcc: x@example.com');
  assert.equal(fields.roleTitle, 'Engineer gnitset');
});

test('first-person wording is recognised without flagging ordinary words', () => {
  assert.deepEqual(firstPersonWords("I'm a developer. My team and I shipped it; we own our service."), ['I', 'My', 'I', 'we', 'our']);
  assert.deepEqual(firstPersonWords('Maya built pipelines for the US market, tuned MySQL, worked on IoT at Meta and gave their team a demo.'), []);
  assert.equal(introVoice('Alex Chen is an engineer. He led the migration.'), 'third_person');
  assert.equal(introVoice('Alex often says "I love infrastructure" and means it.'), 'mixed');
  assert.equal(introVoice('I am an engineer.'), 'first_person');
  assert.equal(introVoice('我是一名后端工程师。'), 'first_person');
});

test('links must be https, have a real host and carry no credentials', () => {
  assert.equal(httpsUrl('https://example.com/a?b=1', 300), 'https://example.com/a?b=1');
  for (const bad of ['http://example.com', 'https://localhost/x', 'ftp://example.com', 'https://u:p@example.com', '', null, `https://example.com/${'a'.repeat(400)}`]) {
    assert.equal(httpsUrl(bad, 300), null);
  }
});

test('the fill-in template is third person and names the role', () => {
  const template = introTemplate({ name: 'Alex Chen', roleTitle: 'Associate', company: 'Goldman Sachs' });
  assert.match(template, /^Alex Chen is a /); assert.match(template, /Associate role at Goldman Sachs/);
  assert.equal(introVoice(template), 'third_person');
});

test('an unfilled template is recognised by its brackets', () => {
  assert.equal(hasPlaceholder('Alex is a [current title] at Northwind.'), true);
  assert.equal(hasPlaceholder('Alex is a backend engineer at Northwind.'), false);
});

test('the idempotency key must be a UUID', () => {
  assert.equal(idempotencyKey('6F9619FF-8B86-4D01-B42D-00CF4FC964FF'), '6f9619ff-8b86-4d01-b42d-00cf4fc964ff');
  for (const bad of [undefined, '', 'abc', 42, '6f9619ff8b864d01b42d00cf4fc964ff', "6f9619ff-8b86-4d01-b42d-00cf4fc964ff' or 1=1"]) {
    assert.equal(code(() => idempotencyKey(bad)), 'invalid_fields:null');
  }
});

test('what the browser declares about the résumé is checked before an upload link is given', () => {
  assert.deepEqual(resumeMeta({ name: '../../etc/Alex Chen <Resume>.PDF', size: 120000, type: 'application/pdf' }), { filename: 'Alex Chen Resume.pdf', size: 120000 });
  assert.equal(safeFilename(''), 'resume.pdf'); assert.equal(safeFilename('履历 2026.pdf'), '履历 2026.pdf');
  for (const [input, expected] of [
    [undefined, 'resume_required:resume'], [{ name: 'a.pdf', type: 'application/pdf' }, 'resume_required:resume'],
    [{ name: 'a.pdf', size: 0, type: 'application/pdf' }, 'resume_required:resume'],
    [{ name: 'a.pdf', size: RESUME_MAX_BYTES + 1, type: 'application/pdf' }, 'resume_too_large:resume'],
    [{ name: 'a.docx', size: 5000, type: 'application/msword' }, 'resume_not_pdf:resume'],
  ]) assert.equal(code(() => resumeMeta(input)), expected);
});

test('a small valid PDF passes the stored-file check and gets a hash', () => {
  const resume = inspectResume(pdf());
  assert.equal(resume.size, pdf().length); assert.match(resume.sha256, /^[0-9a-f]{64}$/); assert.equal(resume.bytes.equals(pdf()), true);
});

for (const [label, bytes, expected] of [
  ['something that is not a buffer', 'text', 'resume_not_pdf:resume'],
  ['a Word document', Buffer.from('PK\u0003\u0004' + 'x'.repeat(400)), 'resume_not_pdf:resume'],
  ['a truncated PDF', pdf().subarray(0, 220), 'resume_not_pdf:resume'],
  ['a password-protected PDF', pdf('4 0 obj\n<< /Encrypt 5 0 R >>\nendobj'), 'resume_protected:resume'],
  ['a PDF with a script', pdf('4 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj'), 'resume_active_content:resume'],
  ['a PDF that launches a program', pdf('4 0 obj\n<< /S /Launch /F (cmd.exe) >>\nendobj'), 'resume_active_content:resume'],
  ['a PDF with an embedded file', pdf('4 0 obj\n<< /Type /EmbeddedFile >>\nendobj'), 'resume_active_content:resume'],
  ['a file over 2 MB', pdf('', { pad: RESUME_MAX_BYTES }), 'resume_too_large:resume'],
]) test(`the stored-file check refuses ${label}`, () => assert.equal(code(() => inspectResume(bytes)), expected));
