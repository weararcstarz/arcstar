const EMAIL_FORMAT =
  /^(?=.{1,254}$)(?=.{1,64}@)[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9]))+$/;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (normalized.includes('..')) return false;
  if (normalized.indexOf('@') !== normalized.lastIndexOf('@')) return false;

  const [local, domain] = normalized.split('@');
  if (!local || !domain) return false;
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.')) return false;

  return EMAIL_FORMAT.test(normalized);
}

module.exports = {
  normalizeEmail,
  isValidEmail,
};
