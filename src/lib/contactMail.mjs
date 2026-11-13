import nodemailer from 'nodemailer';

const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
export async function sendContactMail({ name, email, message }) {
  const { EMAIL_USER: user, EMAIL_PASS: pass, EMAIL_TO: to } = process.env;
  if (!user || !pass || !to) throw new Error('Contact email is not configured');
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass }, connectionTimeout: 10000, socketTimeout: 15000 });
  await transporter.sendMail({
    from: `"Website Contact Form" <${user}>`, to, replyTo: email, subject: `New message from ${name}`,
    text: `Message from ${name} (${email}):\n\n${message}`,
    html: `<p><strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p><p><strong>Message:</strong><br/>${escapeHtml(message).replaceAll('\n', '<br/>')}</p>`,
  });
}
