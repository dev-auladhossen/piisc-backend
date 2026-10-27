const mongoose = require('mongoose');
const GalleryItem = require('../models/GalleryItem');
const cloudinary = require('../config/cloudinary');
const { validateImageFile } = require('../middleware/galleryUpload');

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const allowedMetadata = ['caption', 'altText', 'displayOrder', 'category'];
const allowedCategories = GalleryItem.GALLERY_CATEGORIES;

function validId(id) {
  return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id) && mongoose.isValidObjectId(id);
}

function validateMetadata(body, { requireCaption = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request fields are required' };
  }
  if (Object.keys(body).some((key) => !allowedMetadata.includes(key))) {
    return { error: 'Only caption, altText, displayOrder, and category are supported' };
  }

  const data = {};
  for (const field of ['caption', 'altText']) {
    if (!has(body, field)) continue;
    if (typeof body[field] !== 'string') return { error: `${field} must be a string` };
    const value = body[field].trim();
    if (value.length > 300 || (field === 'caption' && value.length < 1)) {
      return { error: `${field} must be ${field === 'caption' ? 'between 1 and 300' : 'at most 300'} characters` };
    }
    data[field] = value;
  }

  if (has(body, 'category')) {
    if (typeof body.category !== 'string' || !allowedCategories.includes(body.category)) {
      return { error: `category must be one of: ${allowedCategories.join(', ')}` };
    }
    data.category = body.category;
  }

  if (has(body, 'displayOrder')) {
    const raw = body.displayOrder;
    const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    if (!Number.isSafeInteger(value) || value < 0 || value > 100000) {
      return { error: 'displayOrder must be a whole number between 0 and 100000' };
    }
    data.displayOrder = value;
  }

  if (requireCaption && !has(data, 'caption')) return { error: 'caption is required' };
  if (requireCaption && !has(data, 'category')) return { error: 'category is required' };
  return { data };
}

function logFailure(label, error) {
  console.error(`${label} failed (${error?.name || 'Error'}, code ${error?.code || 'unknown'})`);
}

function logCloudinaryFailure(label, error) {
  if (error?.code === 'CLOUDINARY_CONFIG_MISSING') {
    const missing = Array.isArray(error.missingVariables) ? error.missingVariables : [];
    console.error(`Cloudinary configuration missing: ${missing.join(', ') || 'required variables'}`);
    return;
  }
  logFailure(label, error);
}

function requireCloudinaryConfiguration(res) {
  const missing = cloudinary.missingVariables();
  if (!missing.length) return true;
  console.error(`Cloudinary configuration missing: ${missing.join(', ')}`);
  res.status(503).json({
    message: 'Image storage is not configured',
    code: 'CLOUDINARY_CONFIG_MISSING',
  });
  return false;
}

async function cleanUploadedAsset(publicId) {
  try {
    await cloudinary.deleteAsset(publicId);
    return true;
  } catch (error) {
    logCloudinaryFailure('Gallery upload cleanup', error);
    return false;
  }
}

exports.list = async (req, res) => {
  const supported = ['page', 'limit', 'category'];
  if (Object.keys(req.query).some((key) => !supported.includes(key) || typeof req.query[key] !== 'string')) {
    return res.status(400).json({ message: 'Only page, limit, and category query parameters are supported' });
  }

  const category = req.query.category;
  if (category !== undefined && !allowedCategories.includes(category)) {
    return res.status(400).json({ message: `category must be one of: ${allowedCategories.join(', ')}` });
  }

  const pageText = req.query.page || '1';
  const limitText = req.query.limit || '20';
  if (!/^[1-9]\d*$/.test(pageText) || !/^[1-9]\d*$/.test(limitText)) {
    return res.status(400).json({ message: 'Page and limit must be positive integers' });
  }
  const page = Number(pageText);
  const limit = Number(limitText);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 100 ||
      !Number.isSafeInteger(skip) || skip > 100000) {
    return res.status(400).json({ message: 'Limit must be at most 100 and page offset at most 100000' });
  }

  const filter = category ? { category } : {};
  const [items, total] = await Promise.all([
    GalleryItem.find(filter).select('-__v -imagePublicId').sort({ displayOrder: 1, createdAt: -1, _id: 1 })
      .skip(skip).limit(limit).maxTimeMS(5000).lean(),
    GalleryItem.countDocuments(filter).maxTimeMS(5000),
  ]);
  // Make legacy records explicit to admin clients; never guess their category.
  const itemsWithCategory = items.map((item) => ({ ...item, category: item.category ?? null }));
  return res.json({ items: itemsWithCategory, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
};

exports.create = async (req, res) => {
  const metadata = validateMetadata(req.body, { requireCaption: true });
  if (metadata.error) return res.status(400).json({ message: metadata.error });
  const image = validateImageFile(req.file);
  if (!image) {
    return res.status(400).json({ message: 'A valid PNG, JPEG, GIF, or WebP image is required' });
  }
  if (!requireCloudinaryConfiguration(res)) return;

  let asset;
  try {
    asset = await cloudinary.uploadBuffer(req.file.buffer);
  } catch (error) {
    if (error?.code === 'CLOUDINARY_CONFIG_MISSING') {
      logCloudinaryFailure('Gallery image upload', error);
      return res.status(503).json({ message: 'Image storage is not configured', code: error.code });
    }
    logCloudinaryFailure('Gallery image upload', error);
    return res.status(502).json({ message: 'Image upload failed', code: 'IMAGE_UPLOAD_FAILED' });
  }

  try {
    const item = await GalleryItem.create({
      ...metadata.data,
      imageUrl: asset.secure_url,
      imagePublicId: asset.public_id,
    });
    return res.status(201).json({ item });
  } catch (error) {
    const cleaned = await cleanUploadedAsset(asset.public_id);
    logFailure('Gallery database create', error);
    const response = { message: 'Could not save gallery item' };
    if (!cleaned) {
      response.code = 'UPLOAD_CLEANUP_FAILED';
      response.cleanupPublicId = asset.public_id;
    }
    if (error.name === 'ValidationError') {
      response.message = 'Gallery item validation failed';
      response.errors = Object.values(error.errors || {}).map((item) => item.message);
      return res.status(400).json(response);
    }
    return res.status(500).json(response);
  }
};

exports.update = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid gallery item ID' });
  const metadata = validateMetadata(req.body);
  if (metadata.error) return res.status(400).json({ message: metadata.error });
  if (!Object.keys(metadata.data).length) return res.status(400).json({ message: 'At least one field is required' });

  const item = await GalleryItem.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'Gallery item not found' });
  item.set(metadata.data);
  await item.save();
  return res.json({ item });
};

exports.replaceImage = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid gallery item ID' });
  if (Object.keys(req.body || {}).length) {
    return res.status(400).json({ message: 'Image replacement accepts only the image file' });
  }
  const image = validateImageFile(req.file);
  if (!image) {
    return res.status(400).json({ message: 'A valid PNG, JPEG, GIF, or WebP image is required' });
  }
  if (!requireCloudinaryConfiguration(res)) return;

  const item = await GalleryItem.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'Gallery item not found' });

  let replacement;
  try {
    replacement = await cloudinary.uploadBuffer(req.file.buffer);
  } catch (error) {
    if (error?.code === 'CLOUDINARY_CONFIG_MISSING') {
      logCloudinaryFailure('Gallery replacement upload', error);
      return res.status(503).json({ message: 'Image storage is not configured', code: error.code });
    }
    logCloudinaryFailure('Gallery replacement upload', error);
    return res.status(502).json({ message: 'Replacement image upload failed', code: 'IMAGE_UPLOAD_FAILED' });
  }

  const previousPublicId = item.imagePublicId;
  item.imageUrl = replacement.secure_url;
  item.imagePublicId = replacement.public_id;
  try {
    await item.save();
  } catch (error) {
    const cleaned = await cleanUploadedAsset(replacement.public_id);
    logFailure('Gallery replacement database update', error);
    const response = { message: 'Could not update gallery item; the previous image remains active' };
    if (!cleaned) {
      response.code = 'REPLACEMENT_CLEANUP_FAILED';
      response.cleanupPublicId = replacement.public_id;
    }
    return res.status(error.name === 'ValidationError' ? 400 : 500).json(response);
  }

  try {
    await cloudinary.deleteAsset(previousPublicId);
  } catch (error) {
    logCloudinaryFailure('Previous gallery image cleanup', error);
    return res.status(502).json({
      message: 'Image was replaced, but cleanup of the previous image failed',
      code: 'OLD_IMAGE_CLEANUP_FAILED',
      cleanupPublicId: previousPublicId,
      item,
    });
  }
  return res.json({ item });
};

exports.remove = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid gallery item ID' });
  if (!requireCloudinaryConfiguration(res)) return;
  const item = await GalleryItem.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ message: 'Gallery item not found' });

  try {
    await cloudinary.deleteAsset(item.imagePublicId);
  } catch (error) {
    logCloudinaryFailure('Deleted gallery image cleanup', error);
    return res.status(502).json({
      message: 'Gallery item was removed, but cleanup of its image failed',
      code: 'IMAGE_CLEANUP_FAILED',
      cleanupPublicId: item.imagePublicId,
      id: item._id,
    });
  }

  return res.json({ message: 'Gallery item deleted successfully', id: item._id });
};
