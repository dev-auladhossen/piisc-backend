const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMISSION_ACADEMIC_SESSIONS = '2027-2028';
const AdmissionApplication = require('../src/models/AdmissionApplication');

const validApplication = () => ({
  studentFullName: ' Amina Rahman ',
  applyingClass: 'Class 5',
  academicSession: '2027-2028',
  guardianFullName: ' Farhana Rahman ',
  guardianRelationship: 'Mother',
  guardianPhone: '+8801712345678',
  guardianEmail: 'FARHANA@example.com',
  consentConfirmed: true,
});

async function getValidationError(data) {
  const application = new AdmissionApplication(data);
  try {
    await application.validate();
  } catch (error) {
    return error;
  }
  assert.fail('Expected validation to fail');
}

test('creates a valid application and applies normalization and backend defaults', async () => {
  const application = new AdmissionApplication(validApplication());
  await application.validate();

  assert.match(application.applicationNumber, /^ADM-\d{4}-[A-F0-9]{16}$/);
  assert.equal(application.studentFullName, 'Amina Rahman');
  assert.equal(application.guardianFullName, 'Farhana Rahman');
  assert.equal(application.guardianEmail, 'farhana@example.com');
  assert.equal(application.consentAt instanceof Date, true);
  assert.equal(application.status, 'Pending');
  assert.equal(application.isRead, false);
  assert.equal(application.internalNotes, '');
});

test('rejects missing required fields', async () => {
  const error = await getValidationError({});
  // applicationNumber is assigned by the model before validation.
  for (const field of ['studentFullName', 'applyingClass', 'academicSession', 'guardianFullName', 'guardianRelationship', 'guardianPhone', 'guardianEmail', 'consentConfirmed']) {
    assert.ok(error.errors[field], `Expected ${field} validation error`);
  }
});

test('rejects invalid email', async () => {
  const error = await getValidationError({ ...validApplication(), guardianEmail: 'not-an-email' });
  assert.ok(error.errors.guardianEmail);
});

test('requires true consent and records consent on the backend', async () => {
  const error = await getValidationError({ ...validApplication(), consentConfirmed: false });
  assert.ok(error.errors.consentConfirmed);

  const app = new AdmissionApplication({ ...validApplication(), consentAt: new Date('2000-01-01') });
  await app.validate();
  assert.ok(app.consentAt > new Date('2000-01-01'));
});

test('rejects an invalid status', async () => {
  const error = await getValidationError({ ...validApplication(), status: 'Processing' });
  assert.ok(error.errors.status);
});

test('allows optional application fields to be omitted', async () => {
  const app = new AdmissionApplication(validApplication());
  await app.validate();
  for (const field of ['dateOfBirth', 'address', 'previousSchool', 'message']) {
    assert.equal(app[field], undefined);
  }
});

test('rejects values that exceed field length limits', async () => {
  const error = await getValidationError({
    ...validApplication(),
    studentFullName: 'A'.repeat(121),
    address: 'A'.repeat(501),
  });
  assert.ok(error.errors.studentFullName);
  assert.ok(error.errors.address);
});

test('defines a unique application number index', () => {
  assert.equal(AdmissionApplication.schema.path('applicationNumber').options.unique, true);
  assert.ok(AdmissionApplication.schema.indexes().some(([fields, options]) => (
    fields.applicationNumber === 1 && options.unique === true
  )));
});

test('rejects sessions until they are explicitly configured', async () => {
  const previous = process.env.ADMISSION_ACADEMIC_SESSIONS;
  delete process.env.ADMISSION_ACADEMIC_SESSIONS;
  try {
    const error = await getValidationError(validApplication());
    assert.ok(error.errors.academicSession);
  } finally {
    process.env.ADMISSION_ACADEMIC_SESSIONS = previous;
  }
});
