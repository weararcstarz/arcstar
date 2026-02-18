const crypto = require('crypto');
const nodemailer = require('nodemailer');
const store = require('../lib/subscriber-store');
const { normalizeEmail, isValidEmail } = require('../lib/email-validator');

const TOKEN_TTL_SECONDS = 60 * 60 * 4; // 4 hours
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_BASE_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MAX_MS = 24 * 60 * 60 * 1000;
const LOGIN_DELAY_MIN_MS = 350;
const LOGIN_DELAY_JITTER_MS = 450;
const API_WINDOW_MS = 60 * 1000;
const API_MAX_REQUESTS = 90;
const SUBJECT_MAX_LENGTH = 140;
const MESSAGE_MAX_LENGTH = 10000;
const IMPORT_MAX_ROWS = 5000;
const ADMIN_PASSWORD_MIN_LENGTH = 12;
const ADMIN_TOKEN_SECRET_MIN_LENGTH = 32;
const AUTH_COOKIE_NAME = 'arcstarz_admin';
const loginAttempts = new Map();
const apiBursts = new Map();

function json(res, status, body) {
  return res.status(status).json(body);
}

function normalizeOrigin(input) {
  if (!input) return '';
  try {
    const parsed = new URL(String(input));
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return '';
  }
}

function addOriginVariants(set, rawInput) {
  const origin = normalizeOrigin(rawInput);
  if (!origin) return;
  set.add(origin);

  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';
    if (host.startsWith('www.')) {
      set.add(`${parsed.protocol}//${host.slice(4)}${port}`);
    } else if (!host.startsWith('localhost') && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      set.add(`${parsed.protocol}//www.${host}${port}`);
    }
  } catch {
    // no-op
  }
}

function getAllowedOrigins(req) {
  const allowed = new Set();
  addOriginVariants(allowed, process.env.APP_BASE_URL);
  addOriginVariants(allowed, process.env.BRAND_WEBSITE_URL);

  const host = String(req.headers.host || '').trim();
  if (host) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const protocol = forwardedProto || (host.startsWith('localhost') ? 'http' : 'https');
    addOriginVariants(allowed, `${protocol}://${host}`);
  }

  const vercelUrl = String(process.env.VERCEL_URL || '').trim();
  if (vercelUrl) addOriginVariants(allowed, `https://${vercelUrl}`);

  addOriginVariants(allowed, 'http://localhost:3000');
  addOriginVariants(allowed, 'http://127.0.0.1:3000');
  addOriginVariants(allowed, 'http://localhost:5173');
  addOriginVariants(allowed, 'http://127.0.0.1:5173');

  const extra = String(process.env.ADMIN_ALLOWED_ORIGINS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const origin of extra) addOriginVariants(allowed, origin);

  return allowed;
}

function setCors(req, res) {
  const origin = normalizeOrigin(req.headers.origin);
  const allowed = getAllowedOrigins(req);
  if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
}

function isAllowedRequestOrigin(req) {
  const origin = normalizeOrigin(req.headers.origin);
  if (!origin) return true;
  return getAllowedOrigins(req).has(origin);
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
  const next = { startedAt: now, count: 0, lockedUntil: 0, lockLevel: 0 };
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
  if (entry.count < LOGIN_MAX_ATTEMPTS) return 0;

  entry.lockLevel = Math.min((entry.lockLevel || 0) + 1, 8);
  const lockMs = Math.min(LOGIN_LOCK_BASE_MS * (2 ** (entry.lockLevel - 1)), LOGIN_LOCK_MAX_MS);
  entry.lockedUntil = Date.now() + lockMs;
  entry.startedAt = Date.now();
  entry.count = 0;
  return Math.ceil(lockMs / 1000);
}

function resetLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function getAdminPassword() {
  return String(process.env.ADMIN_PASSWORD || '');
}

function getTokenSecret() {
  const seed = String(process.env.ADMIN_TOKEN_SECRET || '');
  return seed ? `arcstarz-admin-${seed}` : '';
}

function isStrongAdminConfig(adminPassword, tokenSecret) {
  return (
    adminPassword.length >= ADMIN_PASSWORD_MIN_LENGTH &&
    tokenSecret.length >= ADMIN_TOKEN_SECRET_MIN_LENGTH + 'arcstarz-admin-'.length
  );
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function makeToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    role: 'admin',
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    nonce: crypto.randomBytes(12).toString('base64url'),
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
    if (!payload || payload.role !== 'admin' || !payload.exp || !payload.iat) return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.iat > now + 60) return null;
    if (now > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const cookies = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

function isSecureCookieEnv() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

function makeAuthCookie(token) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${TOKEN_TTL_SECONDS}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (isSecureCookieEnv()) parts.push('Secure');
  return parts.join('; ');
}

function makeClearAuthCookie() {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (isSecureCookieEnv()) parts.push('Secure');
  return parts.join('; ');
}

function extractAuthToken(req) {
  const cookies = parseCookies(req);
  if (cookies[AUTH_COOKIE_NAME]) return cookies[AUTH_COOKIE_NAME];
  const authHeader = String(req.headers.authorization || '');
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
}

async function randomLoginDelay() {
  const delayMs = LOGIN_DELAY_MIN_MS + Math.floor(Math.random() * LOGIN_DELAY_JITTER_MS);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function secureCompare(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB) && String(a).length === String(b).length;
}

function parseImportText(text) {
  const rows = String(text || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  const parsed = [];
  for (const row of rows) {
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
  const websiteUrl = process.env.BRAND_WEBSITE_URL || baseUrl;
  const logoUrl = process.env.BRAND_LOGO_URL || `${baseUrl}/newwebicon.png`;
  const instagramUrl = process.env.BRAND_INSTAGRAM_URL || 'https://instagram.com/arcstarzke';
  const tiktokUrl = process.env.BRAND_TIKTOK_URL || 'https://tiktok.com/@arcstarzke';
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
                Follow us:
                <a href="${instagramUrl}" style="color:#666666;">Instagram</a>
                |
                <a href="${tiktokUrl}" style="color:#666666;">TikTok</a>
                |
                <a href="${websiteUrl}" style="color:#666666;">Website</a>
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
    `ARCSTARZ\n\n${subject}\n\n${message}\n\nFollow us: Instagram ${instagramUrl} | TikTok ${tiktokUrl} | Website ${websiteUrl}\n\nUnsubscribe: ${baseUrl}/unsubscribe?email=${encodeURIComponent(
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
  setSecurityHeaders(res);
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    if (!isAllowedRequestOrigin(req)) {
      return json(res, 403, { status: 'error', message: 'Forbidden origin' });
    }
    return res.status(200).end();
  }

  if (!isAllowedRequestOrigin(req)) {
    return json(res, 403, { status: 'error', message: 'Forbidden origin' });
  }

  const ip = getClientIp(req);
  if (!checkApiRateLimit(ip)) {
    return json(res, 429, { status: 'error', message: 'Too many requests. Try again soon.' });
  }

  const adminPassword = getAdminPassword();
  const tokenSecret = getTokenSecret();
  if (!adminPassword || !tokenSecret || !isStrongAdminConfig(adminPassword, tokenSecret)) {
    return json(res, 500, {
      status: 'error',
      message: 'Admin auth is misconfigured',
    });
  }

  const action = String((req.body && req.body.action) || '');

  if (req.method === 'POST' && action === 'logout') {
    res.setHeader('Set-Cookie', makeClearAuthCookie());
    return json(res, 200, { status: 'success' });
  }

  if (req.method === 'POST' && action === 'login') {
    const gate = checkLoginAllowed(ip);
    if (!gate.ok) {
      return json(res, 429, {
        status: 'error',
        message: `Too many failed logins. Try again in ${gate.retryAfter}s.`,
      });
    }

    const password = String((req.body && req.body.password) || '');
    const valid = password.length <= 512 && secureCompare(password, adminPassword);
    if (!valid) {
      const retryAfter = noteFailedLogin(ip);
      await randomLoginDelay();
      if (retryAfter > 0) {
        return json(res, 429, {
          status: 'error',
          message: `Too many failed logins. Try again in ${retryAfter}s.`,
        });
      }
      return json(res, 401, { status: 'error', message: 'Invalid credentials' });
    }

    resetLoginAttempts(ip);
    const token = makeToken(tokenSecret);
    res.setHeader('Set-Cookie', makeAuthCookie(token));
    return json(res, 200, { status: 'success' });
  }

  const payload = parseToken(extractAuthToken(req), tokenSecret);
  if (!payload) {
    res.setHeader('Set-Cookie', makeClearAuthCookie());
    return json(res, 401, { status: 'error', message: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      const list = await store.getAllSubscribers();
      if (String((req.query && req.query.format) || '').toLowerCase() === 'csv') {
        const csv = [
          'name,email,timestamp,unsubscribed',
          ...list.map(
            (x) =>
              `"${String(x.name || '').replace(/"/g, '""')}","${String(x.email || '').replace(
                /"/g,
                '""'
              )}","${String(x.timestamp || '').replace(/"/g, '""')}","${
                x.unsubscribed ? 'yes' : 'no'
              }"`
          ),
        ].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="arcstarz-subscribers.csv"');
        return res.status(200).send(csv);
      }
      return json(res, 200, {
        status: 'success',
        count: list.length,
        subscribers: list,
      });
    } catch {
      return json(res, 500, { status: 'error', message: 'Failed to load subscribers' });
    }
  }

  if (req.method === 'POST' && action === 'send-broadcast') {
    const subject = String((req.body && req.body.subject) || '').replace(/[\r\n]+/g, ' ').trim();
    const message = String((req.body && req.body.message) || '').trim();
    if (!subject) return json(res, 400, { status: 'error', message: 'Subject is required' });
    if (!message) return json(res, 400, { status: 'error', message: 'Message is required' });
    if (subject.length > SUBJECT_MAX_LENGTH) {
      return json(res, 400, {
        status: 'error',
        message: `Subject must be ${SUBJECT_MAX_LENGTH} characters or less`,
      });
    }
    if (message.length > MESSAGE_MAX_LENGTH) {
      return json(res, 400, {
        status: 'error',
        message: `Message must be ${MESSAGE_MAX_LENGTH} characters or less`,
      });
    }

    const recipients = Array.from(
      new Set(
        (await store.getAllSubscribers())
          .filter((x) => !x.unsubscribed)
          .map((x) => normalizeEmail(x.email))
          .filter((x) => isValidEmail(x))
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

  if (req.method === 'POST' && action === 'merge-subscribers') {
    const imports = parseImportText((req.body && req.body.rows) || '');
    if (!imports.length) {
      return json(res, 400, { status: 'error', message: 'No rows found to import' });
    }
    if (imports.length > IMPORT_MAX_ROWS) {
      return json(res, 400, {
        status: 'error',
        message: `Too many rows. Max ${IMPORT_MAX_ROWS} per import.`,
      });
    }
    try {
      const merged = await store.mergeSubscribers(imports);
      return json(res, 200, {
        status: 'success',
        message: 'Subscribers merged',
        count: merged.count,
      });
    } catch {
      return json(res, 500, { status: 'error', message: 'Failed to save merged subscribers' });
    }
  }

  return json(res, 405, { status: 'error', message: 'Method not allowed' });
};
