const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_PROVIDER_MESSAGE_LENGTH = 400;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeProviderMessage(value, application) {
  if (typeof value !== 'string') return 'No provider message';

  let message = value
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:re|sk|rk)_[A-Za-z0-9_-]+\b/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]');

  // Provider messages can echo request values. Remove every string from the
  // application before logging so student, guardian, and other form data stay private.
  for (const valueToRedact of [...Object.values(application || {}), process.env.RESEND_API_KEY]) {
    if (typeof valueToRedact !== 'string' || valueToRedact.length === 0) continue;
    message = message.replace(new RegExp(escapeRegex(valueToRedact), 'gi'), '[APPLICATION DATA REDACTED]');
  }

  return message.replace(/[\r\n\t]/g, ' ').slice(0, MAX_PROVIDER_MESSAGE_LENGTH);
}

function sanitizeProviderCode(value) {
  if (typeof value !== 'string') return 'unknown';
  let safeValue = value
    .replace(/\b(?:re|sk|rk)_[A-Za-z0-9_-]+\b/gi, '[REDACTED]');
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) safeValue = safeValue.replace(new RegExp(escapeRegex(apiKey), 'gi'), '[REDACTED]');
  const code = safeValue.replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
  return code || 'unknown';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function notifyAdmissionsAdmin(application) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const recipient = (process.env.ADMISSIONS_NOTIFICATION_EMAIL || process.env.ADMISSIONS_ADMIN_EMAIL)?.trim();
  const sender = (process.env.ADMISSIONS_FROM_EMAIL || process.env.RESEND_FROM_EMAIL)?.trim();
  if (!apiKey || !recipient || !sender || typeof fetch !== 'function') return 'unavailable';

  const submittedAt = new Date(application.createdAt).toISOString();
  const details = [
    ['Application number', application.applicationNumber],
    ['Student', application.studentFullName],
    ['Applying class', application.applyingClass],
    ['Academic session', application.academicSession],
    ['Submitted', `${submittedAt} UTC`],
  ];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        subject: `New admission application ${application.applicationNumber}`,
        text: [
          'A new admission application was received.',
          ...details.map(([label, value]) => `${label}: ${value}`),
          'Sign in to the PIISC admissions dashboard to review the application.',
        ].join('\n'),
        html: [
          '<p>A new admission application was received.</p>',
          '<dl>',
          ...details.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`),
          '</dl>',
          '<p>Sign in to the PIISC admissions dashboard to review the application.</p>',
        ].join(''),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const providerError = await response.json().catch(() => ({}));
      const providerCode = sanitizeProviderCode(providerError?.name || providerError?.code);
      const providerMessage = sanitizeProviderMessage(providerError?.message, application);
      console.error(`Admissions notification email failed (HTTP ${response.status}, ${providerCode}): ${providerMessage}`);
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    const failureType = error?.name === 'AbortError' ? 'timeout' : 'request error';
    console.error(`Admissions notification email failed (${failureType})`);
    return 'failed';
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { notifyAdmissionsAdmin, escapeHtml };
