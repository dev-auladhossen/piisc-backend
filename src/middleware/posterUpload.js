const galleryUpload = require('./galleryUpload');

const { upload, handleUploadError, MAX_IMAGE_BYTES } = galleryUpload;

// Detect the actual file signature and require it to match the submitted MIME type.
function validatePosterImageFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length > MAX_IMAGE_BYTES) return null;

  const bytes = file.buffer;
  let mimeType;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mimeType = 'image/png';
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mimeType = 'image/jpeg';
  } else if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    mimeType = 'image/webp';
  }

  if (!mimeType || file.mimetype !== mimeType) return null;
  return { mimeType };
}

module.exports = { upload, handleUploadError, validatePosterImageFile, MAX_IMAGE_BYTES };
