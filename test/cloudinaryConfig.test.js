const test = require('node:test');
const assert = require('node:assert/strict');

const names = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const cloudinarySdkPath = require.resolve('cloudinary');
const configPath = require.resolve('../src/config/cloudinary');
const originalSdkModule = require.cache[cloudinarySdkPath];
const originalEnvironment = Object.fromEntries(names.map((name) => [name, process.env[name]]));

let capturedConfig;
let capturedOptions;
let uploadedBuffer;
const fakeSdk = {
  config(value) { capturedConfig = value; },
  uploader: {
    upload_stream(options, callback) {
      capturedOptions = options;
      return {
        end(buffer) {
          uploadedBuffer = buffer;
          callback(null, {
            secure_url: 'https://res.cloudinary.com/test/image/upload/test.png',
            public_id: 'piisc/gallery/test',
          });
        },
      };
    },
    async destroy() { return { result: 'ok' }; },
  },
};

require.cache[cloudinarySdkPath] = {
  id: cloudinarySdkPath,
  filename: cloudinarySdkPath,
  loaded: true,
  exports: { v2: fakeSdk },
};
delete require.cache[configPath];
const cloudinary = require('../src/config/cloudinary');

test('identifies missing Cloudinary settings by name', async () => {
  for (const name of names) delete process.env[name];
  assert.equal(cloudinary.isConfigured(), false);
  assert.deepEqual(cloudinary.missingVariables(), names);
  await assert.rejects(cloudinary.uploadBuffer(Buffer.from('image')), {
    code: 'CLOUDINARY_CONFIG_MISSING',
    missingVariables: names,
  });
});

test('configures the SDK and uploads when all settings are present', async () => {
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  process.env.CLOUDINARY_API_KEY = 'test-key';
  process.env.CLOUDINARY_API_SECRET = 'test-secret-not-real';
  const buffer = Buffer.from('test-image-data');

  const result = await cloudinary.uploadBuffer(buffer);

  assert.deepEqual(capturedConfig, {
    cloud_name: 'test-cloud',
    api_key: 'test-key',
    api_secret: 'test-secret-not-real',
    secure: true,
  });
  assert.equal(capturedOptions.folder, 'piisc/gallery');
  assert.equal(uploadedBuffer, buffer);
  assert.equal(result.public_id, 'piisc/gallery/test');

  await cloudinary.uploadBuffer(buffer, { folder: 'piisc/poster' });
  assert.equal(capturedOptions.folder, 'piisc/poster');
});

test.after(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  delete require.cache[configPath];
  if (originalSdkModule) require.cache[cloudinarySdkPath] = originalSdkModule;
  else delete require.cache[cloudinarySdkPath];
});
