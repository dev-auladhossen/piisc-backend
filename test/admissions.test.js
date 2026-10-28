const test = require('node:test');
const assert = require('node:assert/strict');

const modelPath = require.resolve('../src/models/AdmissionApplication');
const mailPath = require.resolve('../src/services/admissionEmail');
const controllerPath = require.resolve('../src/controllers/admissionController');
const routerPath = require.resolve('../src/routes/admissions');
const records = new Map();
let idSequence = 1;
let saveCollisions = 0;
let saveError = null;
let saveCalls = 0;
let emailResult = 'sent';
let emailCalls = 0;
let emailedApplication = null;
let lastFindFilter = null;

class Query {
  constructor(value) { this.value = value; }
  select(fields) { this.fields = fields; return this; }
  sort(value) {
    this.sortBy = value;
    if (Array.isArray(this.value)) {
      this.value.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt) || String(right._id).localeCompare(String(left._id)));
    }
    return this;
  }
  skip(value) { this.skipBy = value; return this; }
  limit(value) { this.limitBy = value; return this; }
  maxTimeMS() { return this; }
  lean() {
    const rows = Array.isArray(this.value) ? this.value.slice(this.skipBy || 0, (this.skipBy || 0) + (this.limitBy || Infinity)) : this.value;
    if (!Array.isArray(rows) || !this.fields || this.fields.startsWith('-')) return Promise.resolve(rows);
    const fields = this.fields.split(/\s+/);
    return Promise.resolve(rows.map((row) => {
      const selected = Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key)));
      return selected;
    }));
  }
  then(resolve, reject) { return Promise.resolve(this.value).then(resolve, reject); }
}
class FakeAdmissionApplication {
  constructor(data) { Object.assign(this, { status: 'Pending', isRead: false, internalNotes: '', ...data }); this._id = String(idSequence++).padStart(24, '0'); this.applicationNumber ||= `ADM-2027-${String(idSequence).padStart(8, '0')}`; }
  async save() {
    saveCalls += 1;
    if (saveCollisions > 0) { saveCollisions -= 1; throw Object.assign(new Error('duplicate'), { code: 11000, keyPattern: { applicationNumber: 1 } }); }
    if (saveError) throw saveError;
    this.createdAt = this.createdAt || new Date(); this.updatedAt = new Date(); records.set(this._id, this); return this;
  }
  static find(filter = {}) {
    lastFindFilter = filter;
    let values = [...records.values()];
    if (filter.status) values = values.filter((item) => item.status === filter.status);
    if (filter.isRead !== undefined) values = values.filter((item) => item.isRead === filter.isRead);
    if (filter.$or) values = values.filter((item) => filter.$or.some((condition) => Object.entries(condition).some(([key, regex]) => regex.test(String(item[key] || '')))));
    return new Query(values);
  }
  static countDocuments(filter = {}) { return new Query(this.find(filter).value.length); }
  static findById(id) { return new Query(records.get(id) || null); }
  static findByIdAndUpdate(id, update) { const item = records.get(id); if (!item) return new Query(null); Object.assign(item, update, { updatedAt: new Date() }); return new Query(item); }
}
FakeAdmissionApplication.STATUSES = ['Pending', 'Under Review', 'Contacted', 'Accepted', 'Rejected', 'Withdrawn'];
FakeAdmissionApplication.APPLYING_CLASSES = ['Class 5'];
FakeAdmissionApplication.INTERNAL_NOTES_MAX_LENGTH = 5000;
process.env.ADMISSION_ACADEMIC_SESSIONS = '2027-2028';

require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: FakeAdmissionApplication };
require.cache[mailPath] = {
  id: mailPath,
  filename: mailPath,
  loaded: true,
  exports: { async notifyAdmissionsAdmin(application) { emailCalls += 1; emailedApplication = application; return emailResult; } },
};
const controller = require(controllerPath);
const router = require(routerPath);
function response() { return { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, set(key, value) { this.headers[key] = value; return this; } }; }
const validBody = () => ({ studentFullName: 'Amina Rahman', applyingClass: 'Class 5', academicSession: '2027-2028', guardianFullName: 'Farhana Rahman', guardianRelationship: 'Mother', guardianPhone: '+8801712345678', guardianEmail: 'farhana@example.com', consentConfirmed: true });
test.beforeEach(() => { records.clear(); idSequence = 1; saveCollisions = 0; saveError = null; saveCalls = 0; emailResult = 'sent'; emailCalls = 0; emailedApplication = null; lastFindFilter = null; });

test('saves a public application and returns only its application number', async () => {
  const res = response();
  await controller.submit({ body: validBody() }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { message: 'Your admission application has been received.', applicationNumber: 'ADM-2027-00000002', adminNotification: 'sent' });
  assert.equal(records.size, 1);
  assert.equal([...records.values()][0].status, 'Pending');
  assert.equal([...records.values()][0].isRead, false);
  assert.equal(Object.hasOwn(res.body, 'guardianEmail'), false);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(emailCalls, 1);
  assert.equal(emailedApplication.applicationNumber, res.body.applicationNumber);
  assert.equal(emailedApplication.studentFullName, 'Amina Rahman');
  assert.equal(emailedApplication.applyingClass, 'Class 5');
  assert.equal(emailedApplication.academicSession, '2027-2028');
});

test('keeps the application and returns 201 when administrator email delivery fails', async () => {
  emailResult = 'failed';
  const res = response();
  await controller.submit({ body: validBody() }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.adminNotification, 'failed');
  assert.deepEqual(Object.keys(res.body).sort(), ['adminNotification', 'applicationNumber', 'message']);
  assert.equal(records.size, 1);
});

test('keeps the application and reports unavailable email configuration', async () => {
  emailResult = 'unavailable';
  const res = response();
  await controller.submit({ body: validBody() }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.adminNotification, 'unavailable');
  assert.equal(records.size, 1);
});

test('rejects missing required fields', async () => {
  const res = response();
  await controller.submit({ body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(records.size, 0);
});

test('rejects invalid email and phone values', async () => {
  for (const [field, value] of [['guardianEmail', 'not-an-email'], ['guardianPhone', 'call me']]) {
    const res = response();
    await controller.submit({ body: { ...validBody(), [field]: value } }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.errors[field]);
  }
  assert.equal(records.size, 0);
});

test('requires consent to be true', async () => {
  const res = response();
  await controller.submit({ body: { ...validBody(), consentConfirmed: false } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(records.size, 0);
  assert.ok(res.body.errors.consentConfirmed);
});

test('rejects invalid date-of-birth values', async () => {
  for (const dateOfBirth of ['2020-02-30', 'not-a-date', '2999-01-01']) {
    const res = response();
    await controller.submit({ body: { ...validBody(), dateOfBirth } }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.errors.dateOfBirth);
  }
  assert.equal(records.size, 0);
});

test('rejects unsupported class and unconfigured academic session', async () => {
  for (const [field, value] of [['applyingClass', 'Class 6'], ['academicSession', '2028-2029']]) {
    const res = response();
    await controller.submit({ body: { ...validBody(), [field]: value } }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.errors[field]);
  }
  assert.equal(records.size, 0);
});

test('does not accept server-managed fields from public requests', async () => {
  for (const [field, value] of [['status', 'Accepted'], ['internalNotes', 'private'], ['isRead', true], ['applicationNumber', 'ADM-PRIVATE'], ['consentAt', '2020-01-01']]) {
    const res = response();
    await controller.submit({ body: { ...validBody(), [field]: value } }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.errors[field]);
  }
  assert.equal(records.size, 0);
});

test('accepts optional fields when supplied and omits them otherwise', async () => {
  const res = response();
  await controller.submit({ body: validBody() }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(Object.hasOwn([...records.values()][0], 'address'), false);

  const withOptionals = response();
  await controller.submit({ body: { ...validBody(), address: '  Dhaka  ', previousSchool: '  Previous School ', message: '  Please call  ' } }, withOptionals);
  assert.equal(withOptionals.statusCode, 201);
  const saved = [...records.values()][1];
  assert.equal(saved.address, 'Dhaka');
  assert.equal(saved.previousSchool, 'Previous School');
  assert.equal(saved.message, 'Please call');
});

test('retries application number collisions before persisting', async () => {
  saveCollisions = 1;
  const res = response();
  await controller.submit({ body: validBody() }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(records.size, 1);
  assert.equal(saveCalls, 2);
});

test('bounds repeated application number collision retries', async () => {
  saveCollisions = 3;
  const res = response();
  await controller.submit({ body: validBody() }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(saveCalls, 3);
  assert.equal(records.size, 0);
});

test('does not retry unrelated database errors or report success', async () => {
  saveError = Object.assign(new Error('database unavailable'), { name: 'MongoNetworkError' });
  const res = response();
  await controller.submit({ body: validBody() }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { message: 'An unexpected server error occurred' });
  assert.equal(saveCalls, 1);
  assert.equal(records.size, 0);
  assert.equal(emailCalls, 0);
});

test('does not retry a duplicate error from another unique field', async () => {
  saveError = Object.assign(new Error('duplicate guardian email'), { code: 11000, keyPattern: { guardianEmail: 1 } });
  const res = response();
  await controller.submit({ body: validBody() }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(saveCalls, 1);
  assert.equal(records.size, 0);
});

test('reports admissions unavailable when no academic session is configured', async () => {
  const previous = process.env.ADMISSION_ACADEMIC_SESSIONS;
  delete process.env.ADMISSION_ACADEMIC_SESSIONS;
  try {
    const res = response();
    await controller.submit({ body: validBody() }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(records.size, 0);
  } finally {
    process.env.ADMISSION_ACADEMIC_SESSIONS = previous;
  }
});

test('applies the submission-specific limiter to the public route', () => {
  const { admissionsSubmitLimiter } = require('../src/middleware/rateLimiters');
  const postRoute = router.stack.find((layer) => layer.route?.path === '/' && layer.route.methods.post);
  assert.ok(postRoute);
  assert.equal(postRoute.route.stack.length, 2);
  assert.equal(postRoute.route.stack[0].handle, admissionsSubmitLimiter);
  assert.equal(typeof postRoute.route.stack[1].handle, 'function');
});

test('lists paginated admin-safe records with search and status filters', async () => {
  const id = '000000000000000000000001';
  records.set(id, { _id: id, applicationNumber: 'ADM-2027-AB12CD34', studentFullName: 'Amina Rahman', guardianFullName: 'Farhana Rahman', guardianEmail: 'farhana@example.com', guardianPhone: '+8801712345678', applyingClass: 'Class 5', academicSession: '2027-2028', status: 'Pending', isRead: false, internalNotes: 'private', createdAt: new Date() });
  const res = response();
  await controller.list({ query: { page: '1', limit: '20', status: 'Pending', search: 'Amina' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.applications[0]._id, id);
  assert.equal(Object.hasOwn(res.body.applications[0], 'internalNotes'), false);
  assert.deepEqual(res.body.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
  assert.deepEqual(Object.keys(lastFindFilter.$or[0]), ['applicationNumber']);
  assert.deepEqual(lastFindFilter.$or.map((condition) => Object.keys(condition)[0]), [
    'applicationNumber', 'studentFullName', 'guardianFullName', 'guardianEmail', 'guardianPhone',
  ]);
});

test('paginates matching applications newest first', async () => {
  const olderId = '000000000000000000000001';
  const newerId = '000000000000000000000002';
  records.set(olderId, { _id: olderId, applicationNumber: 'ADM-2027-OLD', status: 'Pending', createdAt: new Date('2027-01-01') });
  records.set(newerId, { _id: newerId, applicationNumber: 'ADM-2027-NEW', status: 'Pending', createdAt: new Date('2027-02-01') });
  const res = response();
  await controller.list({ query: { page: '2', limit: '1', status: 'Pending' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.applications[0]._id, olderId);
  assert.deepEqual(res.body.pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });
  assert.deepEqual(lastFindFilter, { status: 'Pending' });
});

test('returns application details and handles invalid or missing IDs', async () => {
  const id = '000000000000000000000001';
  records.set(id, { _id: id, applicationNumber: 'ADM-2027-AB12CD34', status: 'Pending', isRead: false, internalNotes: '' });
  const details = response();
  await controller.getOne({ params: { id } }, details);
  assert.equal(details.statusCode, 200);
  assert.equal(details.body.application._id, id);
  assert.equal(Object.hasOwn(details.body.application, 'internalNotes'), true);

  const invalidId = response();
  await controller.getOne({ params: { id: 'not-an-id' } }, invalidId);
  assert.equal(invalidId.statusCode, 400);
  const missing = response();
  await controller.getOne({ params: { id: '000000000000000000000099' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('updates only valid statuses and rejects missing, invalid, or extra fields', async () => {
  const id = '000000000000000000000001';
  records.set(id, { _id: id, applicationNumber: 'ADM-2027-AB12CD34', status: 'Pending', isRead: false, internalNotes: '' });
  const status = response();
  await controller.updateStatus({ params: { id }, body: { status: 'Under Review' } }, status);
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.application.status, 'Under Review');

  for (const body of [{}, { status: 'Processing' }, { status: 'Accepted', internalNotes: 'not here' }]) {
    const invalid = response();
    await controller.updateStatus({ params: { id }, body }, invalid);
    assert.equal(invalid.statusCode, 400);
  }
  const missing = response();
  await controller.updateStatus({ params: { id: '000000000000000000000099' }, body: { status: 'Accepted' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('marks applications as read and does not allow clearing read state here', async () => {
  const id = '000000000000000000000001';
  records.set(id, { _id: id, applicationNumber: 'ADM-2027-AB12CD34', status: 'Pending', isRead: false });
  const before = response();
  await controller.notificationSummary({}, before);
  assert.deepEqual(before.body, { unreadCount: 1 });

  const read = response();
  await controller.setReadState({ params: { id } }, read);
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.application.isRead, true);

  const afterFirstRead = response();
  await controller.notificationSummary({}, afterFirstRead);
  assert.deepEqual(afterFirstRead.body, { unreadCount: 0 });

  const repeatedRead = response();
  await controller.setReadState({ params: { id } }, repeatedRead);
  assert.equal(repeatedRead.statusCode, 200);
  assert.equal(repeatedRead.body.application.isRead, true);
  const afterRepeatedRead = response();
  await controller.notificationSummary({}, afterRepeatedRead);
  assert.deepEqual(afterRepeatedRead.body, { unreadCount: 0 });

  const invalid = response();
  await controller.setReadState({ params: { id }, body: { isRead: false } }, invalid);
  assert.equal(invalid.statusCode, 400);
  const missing = response();
  await controller.setReadState({ params: { id: '000000000000000000000099' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('updates internal notes with the model length limit', async () => {
  const id = '000000000000000000000001';
  records.set(id, { _id: id, applicationNumber: 'ADM-2027-AB12CD34', internalNotes: '' });
  const notes = response();
  await controller.updateNotes({ params: { id }, body: { internalNotes: '  Called the guardian  ' } }, notes);
  assert.equal(notes.statusCode, 200);
  assert.equal(notes.body.application.internalNotes, 'Called the guardian');

  for (const body of [{}, { internalNotes: 'x'.repeat(5001) }, { internalNotes: 4 }, { internalNotes: '', status: 'Accepted' }]) {
    const invalid = response();
    await controller.updateNotes({ params: { id }, body }, invalid);
    assert.equal(invalid.statusCode, 400);
  }
  const missing = response();
  await controller.updateNotes({ params: { id: '000000000000000000000099' }, body: { internalNotes: '' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('derives unread count from stored applications', async () => {
  const id = '000000000000000000000001';
  records.set(id, { _id: id, applicationNumber: 'ADM-2027-AB12CD34', status: 'Pending', isRead: false, internalNotes: '' });
  const summary = response();
  await controller.notificationSummary({}, summary);
  assert.deepEqual(summary.body, { unreadCount: 1 });
});

test('admin routes require authentication and admin authorization', async () => {
  const jwt = require('jsonwebtoken');
  const User = require('../src/models/User');
  const { protect, authorize } = require('../src/middleware/auth');
  const layers = router.stack;
  assert.equal(layers[0].route.methods.post, true);
  const firstAdminRoute = layers.findIndex((layer) => layer.route?.methods.get || layer.route?.methods.patch);
  assert.ok(firstAdminRoute > 1);
  const adminRoutes = layers.slice(firstAdminRoute).filter((layer) => layer.route);
  assert.equal(adminRoutes.length, 6);
  const summaryRouteIndex = layers.findIndex((layer) => layer.route?.path === '/notifications/summary' && layer.route.methods.get);
  assert.ok(summaryRouteIndex >= firstAdminRoute);
  const middlewareLayers = layers.slice(1, firstAdminRoute);
  assert.equal(middlewareLayers[0].handle, protect);

  const unauthorized = response();
  let nextCalled = false;
  await protect({ get: () => undefined }, unauthorized, () => { nextCalled = true; });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(nextCalled, false);

  const originalSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  process.env.JWT_SECRET = 'test-signing-secret-that-is-long-enough-for-a-test';
  User.findById = async () => ({ role: 'teacher', isActive: true, mustChangePassword: false });
  try {
    const token = jwt.sign({ id: '000000000000000000000001' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    const req = { get: (name) => (name === 'Authorization' ? `Bearer ${token}` : undefined) };
    const res = response();
    let authenticated = false;
    await protect(req, res, () => { authenticated = true; });
    assert.equal(authenticated, true);
    assert.equal(req.user.role, 'teacher');
    let authorized = false;
    authorize('admin')(req, res, () => { authorized = true; });
    assert.equal(authorized, false);
    assert.equal(res.statusCode, 403);
  } finally {
    User.findById = originalFindById;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
