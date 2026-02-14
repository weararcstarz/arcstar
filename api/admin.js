const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 hours
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const API_WINDOW_MS = 60 * 1000;
const API_MAX_REQUESTS = 120;
const loginAttempts = new Map();
const apiBursts = new Map();

function json(res, status, body) {
  return res.status(status).json(body);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getClientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers['x-real-ip'] || '').trim();
  return fwd || real || 'unknown';
}

function getOrInit(map, key, seed) {
  const now = Date.now();
  const item = map.get(key);
  if (item && now - item.startedAt < seed.windowMs) return item;
  const next = { startedAt: now, count: 0, lockedUntil: 0 };
  map.set(key, next);
  return next;
}

function checkApiRateLimit(ip) {
  const entry = getOrInit(apiBursts, ip, { windowMs: API_WINDOW_MS });
  entry.count += 1;
  return entry.count <= API_MAX_REQUESTS;
}

function checkLoginAllowed(ip) {
  const entry = getOrInit(loginAttempts, ip, { windowMs: LOGIN_WINDOW_MS });
  const now = Date.now();
  if (entry.lockedUntil && now < entry.lockedUntil) {
    return { ok: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  return { ok: true };
}

function noteFailedLogin(ip) {
  const entry = getOrInit(loginAttempts, ip, { windowMs: LOGIN_WINDOW_MS });
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOGIN_WINDOW_MS;
  }
}

function resetLoginAttempts(ip) {
  loginAttempts.delete(ip);
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

function writeWaitlist(data) {
  const waitlistFile = path.join(process.cwd(), 'waitlist.json');
  fs.writeFileSync(waitlistFile, JSON.stringify(data, null, 2));
}

function normalizeWaitlist(entries) {
  const seen = new Map();
  for (const item of entries || []) {
    const email = String(item.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    const existing = seen.get(email);
    const clean = {
      id: item.id || Date.now(),
      name: String(item.name || '').trim() || 'Subscriber',
      email,
      timestamp: item.timestamp || new Date().toISOString(),
      unsubscribed: Boolean(item.unsubscribed),
    };
    if (!existing) {
      seen.set(email, clean);
      continue;
    }
    // Keep the latest state for duplicates.
    if (existing.timestamp < clean.timestamp) {
      seen.set(email, clean);
    }
  }
  return Array.from(seen.values()).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

function parseImportText(text) {
  const rows = String(text || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const parsed = [];
  for (const row of rows) {
    // Supports: "name,email" or "email"
    const parts = row.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
      parsed.push({ name: parts.slice(0, -1).join(', '), email: parts[parts.length - 1] });
    } else {
      parsed.push({ name: 'Subscriber', email: row });
    }
  }
  return parsed;
}

function makeUnsubscribeToken(email, secret) {
  const normalized = String(email || '').trim().toLowerCase();
  return sign(normalized, secret);
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const baseUrl = process.env.APP_BASE_URL || 'https://www.arcstarz.shop';
  const logoUrl = process.env.BRAND_LOGO_URL || `${baseUrl}/newwebicon.png`;
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, '<br>');
  const html = (recipient) => `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;">
      <tr>
        <td align="center">
          <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e8e8e8;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#111111;padding:28px;text-align:center;">
                <img src="${logoUrl}" alt="ARCSTARZ" width="56" height="56" style="display:block;margin:0 auto 12px;border-radius:12px;">
                <div style="color:#ffffff;font-size:14px;letter-spacing:3px;">ARCSTARZ</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px;color:#111111;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${safeSubject}</h1>
                <p style="margin:0;font-size:15px;line-height:1.7;color:#303030;">${safeMessage}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;border-top:1px solid #ededed;color:#7a7a7a;font-size:12px;line-height:1.6;">
                You are receiving this because you joined the ARCSTARZ waitlist.
                <br>
                <a href="${baseUrl}/unsubscribe?email=${encodeURIComponent(recipient)}&token=${encodeURIComponent(
    makeUnsubscribeToken(recipient, getTokenSecret())
  )}" style="color:#666666;">Unsubscribe</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
  const text = (recipient) =>
    `ARCSTARZ\n\n${subject}\n\n${message}\n\nUnsubscribe: ${baseUrl}/unsubscribe?email=${encodeURIComponent(
      recipient
    )}&token=${encodeURIComponent(makeUnsubscribeToken(recipient, getTokenSecret()))}`;

  const results = [];
  for (const to of recipients) {
    try {
      await transporter.sendMail({
        from: EMAIL_USER,
        to,
        subject,
        html: html(to),
        text: text(to),
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
  const ip = getClientIp(req);

  if (!checkApiRateLimit(ip)) {
    return json(res, 429, { status: 'error', message: 'Too many requests. Try again soon.' });
  }

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
    const gate = checkLoginAllowed(ip);
    if (!gate.ok) {
      return json(res, 429, {
        status: 'error',
        message: `Too many failed logins. Try again in ${gate.retryAfter}s.`,
      });
    }
    const password = String(req.body.password || '');
    const passBuf = Buffer.from(password);
    const adminBuf = Buffer.from(adminPassword);
    const valid =
      passBuf.length === adminBuf.length && crypto.timingSafeEqual(passBuf, adminBuf);
    if (!valid) {
      noteFailedLogin(ip);
      return json(res, 401, { status: 'error', message: 'Invalid password' });
    }
    resetLoginAttempts(ip);
    const token = makeToken(tokenSecret);
    return json(res, 200, { status: 'success', token });
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = parseToken(token, tokenSecret);
  if (!payload) return json(res, 401, { status: 'error', message: 'Unauthorized' });

  if (req.method === 'GET') {
    const list = normalizeWaitlist(readWaitlist());
    if (String(req.query && req.query.format || '').toLowerCase() === 'csv') {
      const csv = [
        'name,email,timestamp,unsubscribed',
        ...list.map((x) =>
          `"${String(x.name || '').replace(/"/g, '""')}","${String(x.email || '').replace(
            /"/g,
            '""'
          )}","${String(x.timestamp || '').replace(/"/g, '""')}","${x.unsubscribed ? 'yes' : 'no'}"`
        ),
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=\"arcstarz-subscribers.csv\"');
      return res.status(200).send(csv);
    }
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

    const recipients = normalizeWaitlist(readWaitlist())
      .filter((x) => !x.unsubscribed)
      .map((x) => String(x.email || '').trim())
      .filter((x) => x.includes('@'));

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

  if (req.method === 'POST' && req.body && req.body.action === 'merge-subscribers') {
    const imports = parseImportText(req.body.rows || '');
    if (!imports.length) {
      return json(res, 400, { status: 'error', message: 'No rows found to import' });
    }
    const current = readWaitlist();
    const merged = normalizeWaitlist([
      ...current,
      ...imports.map((x) => ({
        id: Date.now() + Math.floor(Math.random() * 9999),
        name: x.name || 'Subscriber',
        email: x.email || '',
        timestamp: new Date().toISOString(),
      })),
    ]);
    try {
      writeWaitlist(merged);
    } catch (error) {
      return json(res, 500, { status: 'error', message: 'Failed to save merged subscribers' });
    }
    return json(res, 200, {
      status: 'success',
      message: 'Subscribers merged',
      count: merged.length,
    });
  }

  return json(res, 405, { status: 'error', message: 'Method not allowed' });
};
