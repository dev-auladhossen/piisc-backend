const test = require('node:test');
const assert = require('node:assert/strict');
const GalleryItem = require('../src/models/GalleryItem');

const validItem = {
  imageUrl: 'https://res.cloudinary.com/demo/image/upload/gallery/test.png',
  imagePublicId: 'piisc/gallery/test',
  caption: 'School activity',
};

test('gallery model accepts the exact public category values', async () => {
  assert.deepEqual(GalleryItem.GALLERY_CATEGORIES, ['Academics', 'Events', 'Sports', 'Campus']);
  for (const category of GalleryItem.GALLERY_CATEGORIES) {
    await new GalleryItem({ ...validItem, category }).validate();
  }
});

test('gallery model rejects unsupported categories', async () => {
  await assert.rejects(
    new GalleryItem({ ...validItem, category: 'All Photos' }).validate(),
    (error) => Boolean(error?.errors?.category),
  );
});

test('gallery model permits legacy records with no category', async () => {
  const item = new GalleryItem(validItem);
  await item.validate();
  assert.equal(item.category, undefined);
});
