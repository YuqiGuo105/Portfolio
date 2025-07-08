import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
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
    cc: email,
    replyTo: email,
    subject: `New message from ${name}`,
    text: `Message from ${name} (${email}):\n\n${message}`,
    html: `<p><strong>From:</strong> ${name} (${email})</p><p><strong>Message:</strong><br/>${message}</p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
}
