const test = require('node:test');
const assert = require('node:assert/strict');
const realUploadMiddleware = require('../src/middleware/galleryUpload');

const modelPath = require.resolve('../src/models/GalleryItem');
const cloudinaryPath = require.resolve('../src/config/cloudinary');
const uploadPath = require.resolve('../src/middleware/galleryUpload');
const controllerPath = require.resolve('../src/controllers/galleryController');

const records = new Map();
let nextId = 1;
let failCreate = false;
let failDeleteAsset = false;
let failUpload = false;
let missingCloudinaryVariables = [];
let deletedAssets = [];

class Query {
  constructor(value) { this.value = value; }
  select() { return this; }
  sort() { return this; }
  skip() { return this; }
  limit() { return this; }
  maxTimeMS() { return this; }
  lean() { return Promise.resolve(this.value); }
  then(resolve, reject) { return Promise.resolve(this.value).then(resolve, reject); }
}

class FakeGalleryItem {
  constructor(data) {
    Object.assign(this, data);
    this._id = this._id || `${String(nextId++).padStart(24, '0')}`;
  }
  set(data) { Object.assign(this, data); }
  async save() {
    if (failCreate) throw Object.assign(new Error('database error'), { name: 'MongoError' });
    this.updatedAt = new Date();
    records.set(this._id, this);
    return this;
  }
  static async create(data) {
    if (failCreate) throw Object.assign(new Error('database error'), { name: 'MongoError' });
    const item = new FakeGalleryItem({ ...data, createdAt: new Date(), updatedAt: new Date() });
    records.set(item._id, item);
    return item;
  }
  static find(filter = {}) {
    return new Query([...records.values()].filter((item) => !filter.category || item.category === filter.category));
  }
  static countDocuments(filter = {}) {
    return new Query([...records.values()].filter((item) => !filter.category || item.category === filter.category).length);
  }
  static async findById(id) { return records.get(id) || null; }
  static async findByIdAndDelete(id) {
    const item = records.get(id) || null;
    if (item) records.delete(id);
    return item;
  }
}
FakeGalleryItem.GALLERY_CATEGORIES = ['Academics', 'Events', 'Sports', 'Campus'];

const cloudinary = {
  isConfigured: () => missingCloudinaryVariables.length === 0,
  missingVariables: () => [...missingCloudinaryVariables],
  async uploadBuffer() {
    if (failUpload) throw new Error('cloud upload failed');
    return { secure_url: 'https://res.cloudinary.com/demo/image/upload/gallery/new.png', public_id: 'piisc/gallery/new' };
  },
  async deleteAsset(publicId) {
    deletedAssets.push(publicId);
    if (failDeleteAsset) throw new Error('cloud delete failed');
    return { result: 'ok' };
  },
};

require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: FakeGalleryItem };
require.cache[cloudinaryPath] = { id: cloudinaryPath, filename: cloudinaryPath, loaded: true, exports: cloudinary };
require.cache[uploadPath] = {
  id: uploadPath,
  filename: uploadPath,
  loaded: true,
  exports: {
    upload: realUploadMiddleware.upload,
    handleUploadError: realUploadMiddleware.handleUploadError,
    validateImageFile: (file) => file?.valid ? { format: 'png', mimeType: 'image/png' } : null,
  },
};
const controller = require(controllerPath);
const galleryRouter = require('../src/routes/gallery');

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function reset() {
  records.clear();
  nextId = 1;
  failCreate = false;
  failDeleteAsset = false;
  failUpload = false;
  missingCloudinaryVariables = [];
  deletedAssets = [];
}

test.beforeEach(reset);

test('lists gallery items with pagination', async () => {
  records.set('000000000000000000000001', { _id: '000000000000000000000001', caption: 'Assembly' });
  const res = response();
  await controller.list({ query: { page: '1', limit: '20' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 1);
  assert.deepEqual(res.body.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
});

test('creates an item and stores Cloudinary metadata', async () => {
  const res = response();
  await controller.create({ body: { caption: 'Assembly', category: 'Events' }, file: { valid: true, buffer: Buffer.from('png') } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.item.imagePublicId, 'piisc/gallery/new');
  assert.equal(res.body.item.caption, 'Assembly');
  assert.equal(res.body.item.category, 'Events');
  assert.equal(Buffer.isBuffer(res.body.item.image), false);
});

test('rejects missing or invalid upload before calling Cloudinary', async () => {
  const res = response();
  await controller.create({ body: { caption: 'Assembly', category: 'Events' }, file: { valid: false } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'A valid PNG, JPEG, GIF, or WebP image is required');
  assert.equal(deletedAssets.length, 0);
});

test('validates image bytes against the explicit MIME allowlist', () => {
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(realUploadMiddleware.validateImageFile({ buffer: pngBytes, mimetype: 'image/png' }).format, 'png');
  assert.equal(realUploadMiddleware.validateImageFile({ buffer: pngBytes, mimetype: 'image/jpeg' }), null);
  assert.equal(realUploadMiddleware.validateImageFile({ buffer: Buffer.from('not an image'), mimetype: 'image/png' }), null);
});

test('returns a provider error when Cloudinary upload fails', async () => {
  failUpload = true;
  const res = response();
  await controller.create({ body: { caption: 'Assembly', category: 'Events' }, file: { valid: true, buffer: Buffer.from('png') } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'IMAGE_UPLOAD_FAILED');
});

test('reports missing Cloudinary variable names without exposing values', async () => {
  missingCloudinaryVariables = ['CLOUDINARY_API_SECRET'];
  const originalError = console.error;
  let diagnostic = '';
  console.error = (message) => { diagnostic = String(message); };
  const res = response();
  try {
    await controller.create({ body: { caption: 'Assembly', category: 'Events' }, file: { valid: true, buffer: Buffer.from('png') } }, res);
  } finally {
    console.error = originalError;
  }
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'CLOUDINARY_CONFIG_MISSING');
  assert.match(diagnostic, /CLOUDINARY_API_SECRET/);
  assert.doesNotMatch(diagnostic, /test-secret-not-real/);
});

test('cleans up the uploaded asset when the database create fails', async () => {
  failCreate = true;
  const res = response();
  await controller.create({ body: { caption: 'Assembly', category: 'Events' }, file: { valid: true, buffer: Buffer.from('png') } }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(deletedAssets, ['piisc/gallery/new']);
});

test('updates caption only and preserves image fields', async () => {
  const id = '000000000000000000000001';
  records.set(id, new FakeGalleryItem({ _id: id, caption: 'Old caption', imageUrl: 'https://example.com/a.png', imagePublicId: 'piisc/gallery/old' }));
  const res = response();
  await controller.update({ params: { id }, body: { caption: 'New caption' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.item.caption, 'New caption');
  assert.equal(res.body.item.imagePublicId, 'piisc/gallery/old');
});

test('rejects missing and unsupported categories on create', async () => {
  const missing = response();
  await controller.create({ body: { caption: 'Assembly' }, file: { valid: true, buffer: Buffer.from('png') } }, missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.body.message, 'category is required');

  const invalid = response();
  await controller.create({ body: { caption: 'Assembly', category: 'All Photos' }, file: { valid: true, buffer: Buffer.from('png') } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.message, /category must be one of/);
});

test('updates category and rejects unsupported category values', async () => {
  const id = '000000000000000000000001';
  records.set(id, new FakeGalleryItem({ _id: id, caption: 'Assembly', category: 'Events' }));
  const res = response();
  await controller.update({ params: { id }, body: { category: 'Academics' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.item.category, 'Academics');

  const invalid = response();
  await controller.update({ params: { id }, body: { category: 'Sports & Games' } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test('replaces an image and removes the old asset after saving', async () => {
  const id = '000000000000000000000001';
  records.set(id, new FakeGalleryItem({ _id: id, caption: 'Assembly', category: 'Campus', imageUrl: 'https://example.com/old.png', imagePublicId: 'piisc/gallery/old' }));
  const res = response();
  await controller.replaceImage({ params: { id }, body: {}, file: { valid: true, buffer: Buffer.from('png') } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.item.imagePublicId, 'piisc/gallery/new');
  assert.equal(res.body.item.category, 'Campus');
  assert.deepEqual(deletedAssets, ['piisc/gallery/old']);
});

test('keeps legacy records visible with an explicit null category', async () => {
  records.set('000000000000000000000001', { _id: '000000000000000000000001', caption: 'Legacy item' });
  const res = response();
  await controller.list({ query: { page: '1', limit: '20' } }, res);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].category, null);
});

test('filters by supported category and rejects unsupported category filters', async () => {
  records.set('000000000000000000000001', { _id: '000000000000000000000001', category: 'Events' });
  records.set('000000000000000000000002', { _id: '000000000000000000000002', category: 'Campus' });
  const res = response();
  await controller.list({ query: { category: 'Events' } }, res);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].category, 'Events');

  const invalid = response();
  await controller.list({ query: { category: 'All Photos' } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test('reports failed cleanup after replacement without hiding the successful replacement', async () => {
  const id = '000000000000000000000001';
  records.set(id, new FakeGalleryItem({ _id: id, caption: 'Assembly', imageUrl: 'https://example.com/old.png', imagePublicId: 'piisc/gallery/old' }));
  failDeleteAsset = true;
  const res = response();
  await controller.replaceImage({ params: { id }, body: {}, file: { valid: true, buffer: Buffer.from('png') } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'OLD_IMAGE_CLEANUP_FAILED');
  assert.equal(res.body.item.imagePublicId, 'piisc/gallery/new');
  assert.equal(res.body.cleanupPublicId, 'piisc/gallery/old');
});

test('reports Cloudinary deletion failure after removing the database item', async () => {
  const id = '000000000000000000000001';
  records.set(id, new FakeGalleryItem({ _id: id, caption: 'Assembly', imagePublicId: 'piisc/gallery/old' }));
  failDeleteAsset = true;
  const res = response();
  await controller.remove({ params: { id } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'IMAGE_CLEANUP_FAILED');
  assert.equal(res.body.cleanupPublicId, 'piisc/gallery/old');
  assert.equal(records.has(id), false);
});

test('rejects malformed MongoDB IDs', async () => {
  const res = response();
  await controller.update({ params: { id: 'invalid' }, body: { caption: 'New caption' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid gallery item ID');
});

test('returns not found for a valid ID without a gallery item', async () => {
  const res = response();
  await controller.update({ params: { id: '000000000000000000000001' }, body: { caption: 'New caption' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Gallery item not found');
});

test('protects gallery write routes with the existing authentication and admin middleware', async () => {
  const writeRoutes = galleryRouter.stack
    .filter((layer) => layer.route && ['post', 'patch', 'delete'].some((method) => layer.route.methods[method]));
  assert.equal(writeRoutes.length, 4);
  for (const layer of writeRoutes) {
    const handlers = layer.route.stack;
    const res = response();
    let nextCalled = false;
    await handlers[0].handle({ get: () => undefined }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
    const authorizationResponse = response();
    let authorizationNextCalled = false;
    handlers[1].handle({ user: undefined }, authorizationResponse, () => { authorizationNextCalled = true; });
    assert.equal(authorizationResponse.statusCode, 401);
    assert.equal(authorizationNextCalled, false);
  }
});
