const test = require('node:test');
const assert = require('node:assert/strict');
const PosterConfig = require('../src/models/PosterConfig');

test('poster configuration uses one fixed document ID and safe defaults', () => {
  const config = new PosterConfig();
  assert.equal(PosterConfig.POSTER_CONFIG_ID, 'public-poster');
  assert.equal(config._id, 'public-poster');
  assert.equal(config.enabled, false);
  assert.equal(config.imageUrl, null);
  assert.equal(config.imagePublicId, null);
  assert.equal(PosterConfig.schema.options.timestamps, true);
});

test('poster image URLs must use HTTPS', async () => {
  const config = new PosterConfig({ imageUrl: 'http://example.com/poster.png' });
  await assert.rejects(config.validate(), (error) => Boolean(error.errors?.imageUrl));
});
