const test = require('node:test');
const assert = require('node:assert/strict');

const modelPath = require.resolve('../src/models/PosterConfig');
const cloudinaryPath = require.resolve('../src/config/cloudinary');
const controllerPath = require.resolve('../src/controllers/posterController');
const records = new Map();
const events = [];
let nextAsset = 1;
let failUpload = false;
let failConfigUpdate = false;
let failDelete = false;
const originalConsoleError = console.error;

class Query {
  constructor(value, error = null) { this.value = value; this.error = error; }
  lean() { return this.error ? Promise.reject(this.error) : Promise.resolve(this.value); }
}

class FakePosterConfig {
  static POSTER_CONFIG_ID = 'public-poster';

  static findById(id) {
    const config = records.get(id);
    return new Query(config ? { ...config } : null);
  }

  static findByIdAndUpdate(id, update, options = {}) {
    events.push('save');
    if (failConfigUpdate) return new Query(null, Object.assign(new Error('database failure'), { name: 'MongoError' }));
    let config = records.get(id);
    if (!config && !options.upsert) return new Query(null);
    if (!config) {
      config = { _id: id, imageUrl: null, imagePublicId: null, enabled: false, createdAt: new Date() };
    }
    Object.assign(config, update.$set || update, { updatedAt: new Date() });
    records.set(id, config);
    return new Query(config);
  }

  static findOneAndUpdate(filter, update, options) {
    const config = records.get(filter._id);
    if (!config || !config.imageUrl || !config.imagePublicId) return new Query(null);
    return this.findByIdAndUpdate(filter._id, update, options);
  }
}

const cloudinary = {
  isConfigured: () => true,
  async uploadBuffer(buffer, options) {
    events.push('upload');
    if (failUpload) throw Object.assign(new Error('cloudinary failure'), { name: 'CloudinaryError' });
    return {
      secure_url: `https://res.cloudinary.com/demo/image/upload/poster-${nextAsset}.png`,
      public_id: `piisc/poster/${nextAsset++}`,
      receivedBuffer: buffer,
      folder: options.folder,
    };
  },
  async deleteAsset(publicId) {
    events.push(`delete:${publicId}`);
    if (failDelete) throw Object.assign(new Error('cloudinary delete failure'), { name: 'CloudinaryError' });
    return { result: 'ok' };
  },
};

require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: FakePosterConfig };
require.cache[cloudinaryPath] = { id: cloudinaryPath, filename: cloudinaryPath, loaded: true, exports: cloudinary };
const controller = require(controllerPath);
const router = require('../src/routes/poster');
const posterUpload = require('../src/middleware/posterUpload');

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function pngFile(size = 8, mimetype = 'image/png') {
  const buffer = Buffer.alloc(size);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
  return { buffer, mimetype };
}

test.beforeEach(() => {
  records.clear();
  events.length = 0;
  nextAsset = 1;
  failUpload = false;
  failConfigUpdate = false;
  failDelete = false;
  console.error = () => {};
});

test.after(() => { console.error = originalConsoleError; });

test('returns a safe public configuration when no poster exists', async () => {
  const res = response();
  await controller.getPublic({}, res);
  assert.deepEqual(res.body, { enabled: false, imageUrl: null });
  assert.equal(Object.hasOwn(res.body, 'imagePublicId'), false);
});

test('public configuration returns only enabled state and image URL', async () => {
  records.set('public-poster', { enabled: true, imageUrl: 'https://images.example/poster.png', imagePublicId: 'private/storage-id' });
  const enabled = response();
  await controller.getPublic({}, enabled);
  assert.deepEqual(enabled.body, { enabled: true, imageUrl: 'https://images.example/poster.png' });

  records.get('public-poster').enabled = false;
  const disabled = response();
  await controller.getPublic({}, disabled);
  assert.deepEqual(disabled.body, { enabled: false, imageUrl: 'https://images.example/poster.png' });
});

test('admin configuration includes the storage identifier', async () => {
  records.set('public-poster', { enabled: true, imageUrl: 'https://images.example/poster.png', imagePublicId: 'piisc/poster/1' });
  const res = response();
  await controller.getAdmin({}, res);
  assert.deepEqual(res.body, {
    config: { enabled: true, imageUrl: 'https://images.example/poster.png', imagePublicId: 'piisc/poster/1' },
  });
});

test('admin route handlers use the existing authentication and admin authorization middleware', async () => {
  const adminRoutes = router.stack.filter((layer) => layer.route);
  assert.equal(adminRoutes.length, 5);
  for (const layer of adminRoutes.filter((item) => item.route.path !== '/')) {
    const [authentication, authorization] = layer.route.stack;
    const unauthenticated = response();
    let nextCalled = false;
    await authentication.handle({ get: () => undefined }, unauthenticated, () => { nextCalled = true; });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(nextCalled, false);

    const nonAdmin = response();
    authorization.handle({ user: { role: 'teacher' } }, nonAdmin, () => { nextCalled = true; });
    assert.equal(nonAdmin.statusCode, 403);
  }
});

test('accepts only PNG, JPEG, and WebP signatures that match the declared MIME', () => {
  const png = pngFile();
  assert.ok(posterUpload.validatePosterImageFile(png));
  assert.equal(posterUpload.validatePosterImageFile({ ...png, mimetype: 'image/jpeg' }), null);
  assert.equal(posterUpload.validatePosterImageFile({ buffer: Buffer.from('GIF89a'), mimetype: 'image/gif' }), null);
  assert.equal(posterUpload.validatePosterImageFile({ buffer: Buffer.from('not an image'), mimetype: 'image/png' }), null);

  const jpeg = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), mimetype: 'image/jpeg' };
  assert.ok(posterUpload.validatePosterImageFile(jpeg));
  const webpBytes = Buffer.from('RIFF0000WEBP');
  assert.ok(posterUpload.validatePosterImageFile({ buffer: webpBytes, mimetype: 'image/webp' }));
});

test('rejects oversized poster files before upload', async () => {
  const file = pngFile(posterUpload.MAX_IMAGE_BYTES + 1);
  const res = response();
  await controller.upload({ body: {}, file }, res);
  assert.equal(res.statusCode, 413);
  assert.equal(events.includes('upload'), false);
});

test('upload endpoint rejects invalid content and unsupported multipart fields', async () => {
  const invalidImage = response();
  await controller.upload({ body: {}, file: { buffer: Buffer.from('GIF89a'), mimetype: 'image/gif' } }, invalidImage);
  assert.equal(invalidImage.statusCode, 400);

  const unsupportedField = response();
  await controller.upload({ body: { enabled: true }, file: pngFile() }, unsupportedField);
  assert.equal(unsupportedField.statusCode, 400);
  assert.equal(events.includes('upload'), false);
});

test('uploads the first poster to its folder and persists a disabled singleton config', async () => {
  const res = response();
  await controller.upload({ body: {}, file: pngFile() }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.config.imagePublicId, 'piisc/poster/1');
  assert.equal(res.body.config.enabled, false);
  assert.equal(records.size, 1);
  assert.deepEqual(events, ['upload', 'save']);
});

test('replacement saves the new image before deleting the old asset', async () => {
  records.set('public-poster', { _id: 'public-poster', imageUrl: 'https://old.example/poster.png', imagePublicId: 'piisc/poster/old', enabled: true });
  const res = response();
  await controller.upload({ body: {}, file: pngFile() }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.config.imagePublicId, 'piisc/poster/1');
  assert.equal(res.body.config.enabled, true);
  assert.deepEqual(events, ['upload', 'save', 'delete:piisc/poster/old']);
});

test('upload failure preserves the previous poster configuration', async () => {
  const previous = { _id: 'public-poster', imageUrl: 'https://old.example/poster.png', imagePublicId: 'piisc/poster/old', enabled: true };
  records.set('public-poster', previous);
  failUpload = true;
  const res = response();
  await controller.upload({ body: {}, file: pngFile() }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(records.get('public-poster'), previous);
  assert.equal(records.get('public-poster').imagePublicId, 'piisc/poster/old');
});

test('database save failure preserves the old config and cleans up the new upload', async () => {
  records.set('public-poster', { _id: 'public-poster', imageUrl: 'https://old.example/poster.png', imagePublicId: 'piisc/poster/old', enabled: true });
  failConfigUpdate = true;
  const res = response();
  await controller.upload({ body: {}, file: pngFile() }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(records.get('public-poster').imagePublicId, 'piisc/poster/old');
  assert.deepEqual(events, ['upload', 'save', 'delete:piisc/poster/1']);
});

test('rejects visibility inputs and enabling without an image', async () => {
  for (const body of [{}, { enabled: 'true' }, { enabled: true, extra: true }]) {
    const invalid = response();
    await controller.setVisibility({ body }, invalid);
    assert.equal(invalid.statusCode, 400);
  }
  const noImage = response();
  await controller.setVisibility({ body: { enabled: true } }, noImage);
  assert.equal(noImage.statusCode, 400);
  assert.equal(records.size, 0);

  const disabled = response();
  await controller.setVisibility({ body: { enabled: false } }, disabled);
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.body.config.enabled, false);
  assert.equal(records.size, 1);
});

test('saves visibility when an image exists', async () => {
  records.set('public-poster', { _id: 'public-poster', imageUrl: 'https://images.example/poster.png', imagePublicId: 'piisc/poster/1', enabled: false });
  const res = response();
  await controller.setVisibility({ body: { enabled: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.config.enabled, true);
});

test('deletes the image and clears config; repeated deletion is safe', async () => {
  records.set('public-poster', { _id: 'public-poster', imageUrl: 'https://images.example/poster.png', imagePublicId: 'piisc/poster/1', enabled: true });
  const first = response();
  await controller.remove({}, first);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.config, { enabled: false, imageUrl: null, imagePublicId: null });
  assert.equal(records.get('public-poster').imagePublicId, null);

  const repeated = response();
  await controller.remove({}, repeated);
  assert.equal(repeated.statusCode, 200);
  assert.equal(events.filter((event) => event === 'delete:piisc/poster/1').length, 1);
});

test('Cloudinary delete failure keeps the existing poster configuration', async () => {
  const previous = { _id: 'public-poster', imageUrl: 'https://images.example/poster.png', imagePublicId: 'piisc/poster/1', enabled: true };
  records.set('public-poster', previous);
  failDelete = true;
  const res = response();
  await controller.remove({}, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'POSTER_DELETE_FAILED');
  assert.equal(records.get('public-poster'), previous);
});

test('does not discard a poster URL when its storage identifier is missing', async () => {
  records.set('public-poster', { _id: 'public-poster', imageUrl: 'https://images.example/poster.png', imagePublicId: null, enabled: true });
  const res = response();
  await controller.remove({}, res);
  assert.equal(res.statusCode, 409);
  assert.equal(records.get('public-poster').imageUrl, 'https://images.example/poster.png');
  assert.equal(events.includes('save'), false);
});
