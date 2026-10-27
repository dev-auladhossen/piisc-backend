const multer = require('multer');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5, fieldSize: 4096 },
});

function handleUploadError(error, req, res, next) {
  if (!(error instanceof multer.MulterError)) return next(error);
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Image must be 5 MB or smaller' });
  }
  return res.status(400).json({ message: 'Invalid multipart image upload' });
}

// Detect content from its bytes and require the browser-supplied MIME to agree.
function validateImageFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) return null;

  const bytes = file.buffer;
  let format;
  let mimeType;

  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    format = 'png'; mimeType = 'image/png';
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    format = 'jpg'; mimeType = 'image/jpeg';
  } else if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    format = 'gif'; mimeType = 'image/gif';
  } else if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    format = 'webp'; mimeType = 'image/webp';
  }

  if (!format || file.mimetype !== mimeType) return null;
  return { format, mimeType };
}

module.exports = { upload, handleUploadError, validateImageFile, MAX_IMAGE_BYTES };
