import nodemailer from 'nodemailer';
import { isRateLimited } from '../../src/lib/rateLimiter';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function textField(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
  const limited = await isRateLimited(ip, 'contact', {
    limit: Number(process.env.CONTACT_RATE_LIMIT || 5),
    windowMs: Number(process.env.CONTACT_RATE_WINDOW_MS || 600_000),
  });
  if (limited) {
    return res.status(429).json({ error: 'Too many contact requests. Please try again later.' });
  }

  const name = textField(req.body?.name, 120) || 'Portfolio visitor';
  const email = textField(req.body?.email, 320).toLowerCase();
  const message = textField(req.body?.message, 5_000);
  if (!email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const toAddress = process.env.EMAIL_TO;

  if (!user || !pass || !toAddress) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass,
    },
  });

  const mailOptions = {
    from: `"Website Contact Form" <${user}>`,
    to: toAddress,
    replyTo: email,
    subject: `New message from ${name.replace(/[\r\n]/g, ' ')}`,
    text: `Message from ${name} (${email}):\n\n${message}`,
    html: `<p><strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p><p><strong>Message:</strong><br/>${escapeHtml(message).replaceAll('\n', '<br/>')}</p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ ok: true, message: 'Your message was sent to the site owner.' });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
}
