const cloudinary = require('cloudinary').v2;

const REQUIRED_VARIABLES = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

function missingVariables() {
  return REQUIRED_VARIABLES.filter((name) => !process.env[name]?.trim());
}

function isConfigured() {
  return missingVariables().length === 0;
}

function configure() {
  const missing = missingVariables();
  if (missing.length) {
    const error = new Error('Cloudinary configuration is incomplete');
    error.code = 'CLOUDINARY_CONFIG_MISSING';
    error.missingVariables = missing;
    throw error;
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim(),
    secure: true,
  });
}

function uploadBuffer(buffer, { folder = 'piisc/gallery' } = {}) {
  return new Promise((resolve, reject) => {
    try {
      configure();
    } catch (error) {
      reject(error);
      return;
    }

    const upload = cloudinary.uploader.upload_stream({
      folder,
      resource_type: 'image',
      use_filename: false,
      unique_filename: true,
      overwrite: false,
    }, (error, result) => {
      if (error) return reject(error);
      if (!result?.secure_url || !result?.public_id) {
        return reject(new Error('Cloudinary returned incomplete image details'));
      }
      resolve(result);
    });

    upload.end(buffer);
  });
}

async function deleteAsset(publicId) {
  configure();
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    invalidate: true,
  });
  if (!result || !['ok', 'not found'].includes(result.result)) {
    throw new Error('Cloudinary did not confirm asset deletion');
  }
  return result;
}

module.exports = { isConfigured, missingVariables, uploadBuffer, deleteAsset };
