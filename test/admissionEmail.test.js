const test = require('node:test');
const assert = require('node:assert/strict');
const { notifyAdmissionsAdmin } = require('../src/services/admissionEmail');

const configKeys = ['RESEND_API_KEY', 'ADMISSIONS_NOTIFICATION_EMAIL', 'ADMISSIONS_FROM_EMAIL', 'ADMISSIONS_ADMIN_EMAIL', 'RESEND_FROM_EMAIL'];
const originalConfig = Object.fromEntries(configKeys.map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;
const originalConsoleError = console.error;
const application = {
  applicationNumber: 'ADM-2027-AB12CD34',
  studentFullName: 'Amina Rahman',
  applyingClass: 'Class 5',
  academicSession: '2027-2028',
  createdAt: new Date('2026-10-28T07:00:00.000Z'),
};

test.beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.ADMISSIONS_NOTIFICATION_EMAIL = 'admissions@example.com';
  process.env.ADMISSIONS_FROM_EMAIL = 'PIISC Admissions <admissions@verified.example>';
  delete process.env.ADMISSIONS_ADMIN_EMAIL;
  delete process.env.RESEND_FROM_EMAIL;
  console.error = () => {};
});

test('sends the application summary to the configured school address', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 202 };
  };
  assert.equal(await notifyAdmissionsAdmin(application), 'sent');
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.to, ['admissions@example.com']);
  assert.equal(body.from, 'PIISC Admissions <admissions@verified.example>');
  assert.match(body.text, /ADM-2027-AB12CD34/);
  assert.match(body.text, /Student: Amina Rahman/);
  assert.match(body.text, /Applying class: Class 5/);
  assert.match(body.text, /Academic session: 2027-2028/);
  assert.match(body.text, /2026-10-28T07:00:00.000Z/);
  assert.doesNotMatch(body.text, /guardianEmail|guardianPhone|internalNotes/);
  assert.match(body.html, /<dt>Application number<\/dt><dd>ADM-2027-AB12CD34<\/dd>/);
  assert.doesNotMatch(body.html, /guardianEmail|guardianPhone|internalNotes/);
  assert.doesNotMatch(body.html, /<a\s/i);
});

test('reports missing email configuration without making a request', async () => {
  delete process.env.RESEND_API_KEY;
  let requested = false;
  global.fetch = async () => { requested = true; return { ok: true, status: 202 }; };
  assert.equal(await notifyAdmissionsAdmin(application), 'unavailable');
  assert.equal(requested, false);
});

test('supports the earlier recipient and sender variable names as fallbacks', async () => {
  delete process.env.ADMISSIONS_NOTIFICATION_EMAIL;
  delete process.env.ADMISSIONS_FROM_EMAIL;
  process.env.ADMISSIONS_ADMIN_EMAIL = 'legacy@example.com';
  process.env.RESEND_FROM_EMAIL = 'PIISC <legacy-sender@verified.example>';
  let request;
  global.fetch = async (url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, status: 202 };
  };
  assert.equal(await notifyAdmissionsAdmin(application), 'sent');
  assert.deepEqual(request.to, ['legacy@example.com']);
  assert.equal(request.from, 'PIISC <legacy-sender@verified.example>');
});

test('reports rejected and unavailable email delivery as failed', async () => {
  global.fetch = async () => ({ ok: false, status: 503 });
  assert.equal(await notifyAdmissionsAdmin(application), 'failed');
  global.fetch = async () => { throw new Error('network down'); };
  assert.equal(await notifyAdmissionsAdmin(application), 'failed');
});

test('escapes user supplied content in HTML email', async () => {
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.html, /&lt;img src=x onerror=&quot;alert\(&#39;x&#39;\)&quot;&gt;/);
    assert.doesNotMatch(body.html, /<img src=x/);
    return { ok: true, status: 202 };
  };
  assert.equal(await notifyAdmissionsAdmin({
    ...application,
    studentFullName: `<img src=x onerror="alert('x')">`,
  }), 'sent');
});

test('logs useful provider error details while redacting secrets and application data', async () => {
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  global.fetch = async () => ({
    ok: false,
    status: 403,
    async json() {
      return {
        name: 'validation_error',
        message: 'Sender domain example.org is not verified for Amina Rahman at student@example.com; re_testsecret Bearer private-token test-key',
      };
    },
  });
  assert.equal(await notifyAdmissionsAdmin(application), 'failed');
  const output = logs.join('\n');
  assert.match(output, /HTTP 403, validation_error/);
  assert.match(output, /Sender domain example\.org is not verified/);
  assert.match(output, /\[APPLICATION DATA REDACTED\]/);
  assert.match(output, /\[EMAIL REDACTED\]/);
  assert.equal(output.includes('Amina Rahman'), false);
  assert.equal(output.includes('student@example.com'), false);
  assert.equal(output.includes('re_testsecret'), false);
  assert.equal(output.includes('private-token'), false);
  assert.equal(output.includes('test-key'), false);
  assert.ok(output.length < 500);
});

test('handles non-JSON provider error responses safely', async () => {
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  global.fetch = async () => ({
    ok: false,
    status: 403,
    async json() { throw new SyntaxError('not json'); },
  });
  assert.equal(await notifyAdmissionsAdmin(application), 'failed');
  assert.match(logs.join('\n'), /HTTP 403, unknown\): No provider message/);
});

test.after(() => {
  for (const [key, value] of Object.entries(originalConfig)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  global.fetch = originalFetch;
  console.error = originalConsoleError;
});
