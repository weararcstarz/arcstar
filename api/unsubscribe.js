const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function json(res, status, body) {
  return res.status(status).json(body);
}

function getSecret() {
  const seed = process.env.ADMIN_TOKEN_SECRET || process.env.EMAIL_PASS || '';
  return seed ? `arcstarz-admin-${seed}` : '';
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function readWaitlist() {
  const waitlistFile = path.join(process.cwd(), 'waitlist.json');
  if (!fs.existsSync(waitlistFile)) return [];
  try {
    const raw = fs.readFileSync(waitlistFile, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeWaitlist(data) {
  const waitlistFile = path.join(process.cwd(), 'waitlist.json');
  fs.writeFileSync(waitlistFile, JSON.stringify(data, null, 2));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = req.method === 'POST' ? req.body || {} : req.query || {};
  const email = String(payload.email || '').trim().toLowerCase();
  const token = String(payload.token || '').trim();

  if (!email || !email.includes('@')) {
    return json(res, 400, { status: 'error', message: 'Invalid email' });
  }

  const secret = getSecret();
  if (!secret) {
    return json(res, 500, { status: 'error', message: 'Server not configured' });
  }

  const expected = sign(email, secret);
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  const valid =
    tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf);
  if (!valid) return json(res, 401, { status: 'error', message: 'Invalid unsubscribe link' });

  const list = readWaitlist();
  const match = list.find((x) => String(x.email || '').trim().toLowerCase() === email);
  if (!match) return json(res, 404, { status: 'error', message: 'Subscriber not found' });

  match.unsubscribed = true;
  try {
    writeWaitlist(list);
  } catch {
    return json(res, 500, { status: 'error', message: 'Failed to update subscription' });
  }

  return json(res, 200, { status: 'success', message: 'You have been unsubscribed.' });
};
