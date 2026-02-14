const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function json(res, status, body) {
  return res.status(status).json(body);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || '';
}

function getTokenSecret() {
  const seed = process.env.ADMIN_TOKEN_SECRET || process.env.EMAIL_PASS || '';
  return seed ? `arcstarz-admin-${seed}` : '';
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function makeToken(secret) {
  const payload = {
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const payloadEncoded = base64url(JSON.stringify(payload));
  const sig = sign(payloadEncoded, secret);
  return `${payloadEncoded}.${sig}`;
}

function parseToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadEncoded, sig] = token.split('.');
  if (!payloadEncoded || !sig) return null;
  const expected = sign(payloadEncoded, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
    if (!payload || payload.role !== 'admin' || !payload.exp) return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function readWaitlist() {
  const waitlistFile = path.join(process.cwd(), 'waitlist.json');
  if (!fs.existsSync(waitlistFile)) return [];
  try {
    const raw = fs.readFileSync(waitlistFile, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

function getTransporter() {
  const EMAIL_USER = process.env.EMAIL_USER || 'weararcstarz@gmail.com';
  const EMAIL_PASS = process.env.EMAIL_PASS;
  const SMTP_SERVER = process.env.SMTP_SERVER || 'smtp.gmail.com';
  const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
  if (!EMAIL_PASS) return null;
  const transporter = nodemailer.createTransport({
    host: SMTP_SERVER,
    port: SMTP_PORT,
    secure: false,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  });
  return { transporter, EMAIL_USER };
}

async function sendBroadcast(subject, message, recipients) {
  const config = getTransporter();
  if (!config) {
    return { ok: false, message: 'Email service not configured' };
  }
  const { transporter, EMAIL_USER } = config;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #111;">
      <h2 style="margin: 0 0 16px;">ARCSTARZ Update</h2>
      <div style="line-height: 1.6; white-space: pre-wrap;">${String(message)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</div>
    </div>
  `;

  const results = [];
  for (const to of recipients) {
    try {
      await transporter.sendMail({
        from: EMAIL_USER,
        to,
        subject,
        html,
      });
      results.push({ to, status: 'sent' });
    } catch (error) {
      results.push({ to, status: 'failed', error: error.message || 'send failed' });
    }
  }
  const sent = results.filter((r) => r.status === 'sent').length;
  return {
    ok: true,
    sent,
    failed: results.length - sent,
    results,
  };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminPassword = getAdminPassword();
  const tokenSecret = getTokenSecret();
  if (!adminPassword || !tokenSecret) {
    return json(res, 500, {
      status: 'error',
      message: 'Admin auth is not configured',
    });
  }

  if (req.method === 'POST' && req.body && req.body.action === 'login') {
    const password = String(req.body.password || '');
    const passBuf = Buffer.from(password);
    const adminBuf = Buffer.from(adminPassword);
    const valid =
      passBuf.length === adminBuf.length && crypto.timingSafeEqual(passBuf, adminBuf);
    if (!valid) return json(res, 401, { status: 'error', message: 'Invalid password' });
    const token = makeToken(tokenSecret);
    return json(res, 200, { status: 'success', token });
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = parseToken(token, tokenSecret);
  if (!payload) return json(res, 401, { status: 'error', message: 'Unauthorized' });

  if (req.method === 'GET') {
    const list = readWaitlist()
      .map((entry) => ({
        id: entry.id || 0,
        name: entry.name || '',
        email: entry.email || '',
        timestamp: entry.timestamp || '',
      }))
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return json(res, 200, {
      status: 'success',
      count: list.length,
      subscribers: list,
    });
  }

  if (req.method === 'POST' && req.body && req.body.action === 'send-broadcast') {
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    if (!subject) return json(res, 400, { status: 'error', message: 'Subject is required' });
    if (!message) return json(res, 400, { status: 'error', message: 'Message is required' });

    const recipients = Array.from(
      new Set(
        readWaitlist()
          .map((x) => String(x.email || '').trim())
          .filter((x) => x.includes('@'))
      )
    );

    if (!recipients.length) {
      return json(res, 400, { status: 'error', message: 'No subscribers found' });
    }

    const sendResult = await sendBroadcast(subject, message, recipients);
    if (!sendResult.ok) {
      return json(res, 500, { status: 'error', message: sendResult.message });
    }
    return json(res, 200, {
      status: 'success',
      sent: sendResult.sent,
      failed: sendResult.failed,
    });
  }

  return json(res, 405, { status: 'error', message: 'Method not allowed' });
};
