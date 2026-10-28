const PosterConfig = require('../models/PosterConfig');
const cloudinary = require('../config/cloudinary');
const { validatePosterImageFile, MAX_IMAGE_BYTES } = require('../middleware/posterUpload');

const CONFIG_ID = PosterConfig.POSTER_CONFIG_ID;

function publicConfig(config) {
  return {
    enabled: config?.enabled === true && Boolean(config?.imageUrl),
    imageUrl: config?.imageUrl || null,
  };
}

function adminConfig(config) {
  return {
    enabled: config?.enabled === true && Boolean(config?.imageUrl),
    imageUrl: config?.imageUrl || null,
    imagePublicId: config?.imagePublicId || null,
  };
}

function logFailure(label, error) {
  console.error(`${label} failed (${error?.name || 'Error'}, code ${error?.code || 'unknown'})`);
}

function requireCloudinary(res) {
  if (cloudinary.isConfigured()) return true;
  res.status(503).json({ message: 'Image storage is not configured', code: 'CLOUDINARY_CONFIG_MISSING' });
  return false;
}

async function cleanupUploadedAsset(publicId) {
  try {
    await cloudinary.deleteAsset(publicId);
    return true;
  } catch (error) {
    logFailure('Poster upload cleanup', error);
    return false;
  }
}

exports.getPublic = async (req, res) => {
  try {
    const config = await PosterConfig.findById(CONFIG_ID).lean();
    return res.json(publicConfig(config));
  } catch (error) {
    logFailure('Public poster configuration lookup', error);
    return res.status(500).json({ message: 'Could not load poster configuration' });
  }
};

exports.getAdmin = async (req, res) => {
  try {
    const config = await PosterConfig.findById(CONFIG_ID).lean();
    return res.json({ config: adminConfig(config) });
  } catch (error) {
    logFailure('Admin poster configuration lookup', error);
    return res.status(500).json({ message: 'Could not load poster configuration' });
  }
};

exports.upload = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) {
    return res.status(400).json({ message: 'Poster upload accepts only the image file' });
  }
  if (req.file?.buffer?.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({ message: 'Image must be 5 MB or smaller' });
  }
  if (!validatePosterImageFile(req.file)) {
    return res.status(400).json({ message: 'A valid PNG, JPEG, or WebP image is required' });
  }
  if (!requireCloudinary(res)) return;

  let current;
  try {
    current = await PosterConfig.findById(CONFIG_ID).lean();
  } catch (error) {
    logFailure('Poster configuration lookup before upload', error);
    return res.status(500).json({ message: 'Could not update poster configuration' });
  }

  let asset;
  try {
    asset = await cloudinary.uploadBuffer(req.file.buffer, { folder: 'piisc/poster' });
  } catch (error) {
    logFailure('Poster image upload', error);
    if (error?.code === 'CLOUDINARY_CONFIG_MISSING') {
      return res.status(503).json({ message: 'Image storage is not configured', code: error.code });
    }
    return res.status(502).json({ message: 'Poster image upload failed', code: 'POSTER_UPLOAD_FAILED' });
  }

  if (!asset?.secure_url || !asset?.public_id) {
    logFailure('Poster image upload', new Error('Incomplete Cloudinary result'));
    return res.status(502).json({ message: 'Poster image upload failed', code: 'POSTER_UPLOAD_FAILED' });
  }

  let savedConfig;
  try {
    savedConfig = await PosterConfig.findByIdAndUpdate(
      CONFIG_ID,
      { $set: { imageUrl: asset.secure_url, imagePublicId: asset.public_id } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
    ).lean();
    if (!savedConfig) throw new Error('Poster configuration was not returned after save');
  } catch (error) {
    const cleaned = await cleanupUploadedAsset(asset.public_id);
    logFailure('Poster configuration save', error);
    const result = { message: 'Could not save poster configuration' };
    if (!cleaned) {
      result.code = 'POSTER_UPLOAD_CLEANUP_FAILED';
      result.cleanupPublicId = asset.public_id;
    }
    return res.status(500).json(result);
  }

  if (current?.imagePublicId && current.imagePublicId !== asset.public_id) {
    try {
      await cloudinary.deleteAsset(current.imagePublicId);
    } catch (error) {
      logFailure('Previous poster image cleanup', error);
      return res.status(502).json({
        message: 'Poster was replaced, but cleanup of the previous image failed',
        code: 'OLD_POSTER_CLEANUP_FAILED',
        cleanupPublicId: current.imagePublicId,
        config: adminConfig(savedConfig),
      });
    }
  }

  return res.status(current?.imagePublicId ? 200 : 201).json({ config: adminConfig(savedConfig) });
};

exports.setVisibility = async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') {
    return res.status(400).json({ message: 'enabled must be a boolean' });
  }

  try {
    let config;
    if (body.enabled) {
      config = await PosterConfig.findOneAndUpdate(
        { _id: CONFIG_ID, imageUrl: { $type: 'string', $ne: '' }, imagePublicId: { $type: 'string', $ne: '' } },
        { $set: { enabled: true } },
        { new: true, runValidators: true },
      ).lean();
      if (!config) return res.status(400).json({ message: 'Upload a poster image before enabling the popup' });
    } else {
      config = await PosterConfig.findByIdAndUpdate(
        CONFIG_ID,
        { $set: { enabled: false } },
        { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
      ).lean();
    }
    return res.json({ config: adminConfig(config) });
  } catch (error) {
    logFailure('Poster visibility update', error);
    return res.status(500).json({ message: 'Could not update poster visibility' });
  }
};

exports.remove = async (req, res) => {
  let current;
  try {
    current = await PosterConfig.findById(CONFIG_ID).lean();
  } catch (error) {
    logFailure('Poster configuration lookup before delete', error);
    return res.status(500).json({ message: 'Could not delete poster configuration' });
  }

  if (!current) {
    return res.json({ message: 'Poster is already empty', config: adminConfig(current) });
  }
  if (!current.imagePublicId) {
    if (current.imageUrl) {
      return res.status(409).json({ message: 'Poster storage information is missing; manual image cleanup is required' });
    }
    if (current.enabled !== true) {
      return res.json({ message: 'Poster is already empty', config: adminConfig(current) });
    }
    try {
      const cleared = await PosterConfig.findByIdAndUpdate(
        CONFIG_ID,
        { $set: { imageUrl: null, imagePublicId: null, enabled: false } },
        { new: true, runValidators: true },
      ).lean();
      return res.json({ message: 'Poster deleted', config: adminConfig(cleared) });
    } catch (error) {
      logFailure('Poster configuration clear', error);
      return res.status(500).json({ message: 'Could not delete poster configuration' });
    }
  }

  if (!requireCloudinary(res)) return;
  try {
    await cloudinary.deleteAsset(current.imagePublicId);
  } catch (error) {
    logFailure('Poster image delete', error);
    return res.status(502).json({ message: 'Poster image deletion failed', code: 'POSTER_DELETE_FAILED' });
  }

  try {
    const cleared = await PosterConfig.findByIdAndUpdate(
      CONFIG_ID,
      { $set: { imageUrl: null, imagePublicId: null, enabled: false } },
      { new: true, runValidators: true },
    ).lean();
    if (!cleared) throw new Error('Poster configuration was not returned after delete');
    return res.json({ message: 'Poster deleted', config: adminConfig(cleared) });
  } catch (error) {
    logFailure('Poster configuration clear after image delete', error);
    return res.status(500).json({ message: 'Image was deleted, but poster configuration could not be cleared' });
  }
};
