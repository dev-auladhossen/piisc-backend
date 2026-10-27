const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/galleryUpload');
const controller = require('../controllers/galleryController');

const adminOnly = [protect, authorize('admin')];

router.get('/', controller.list);
router.post('/', ...adminOnly, upload.single('image'), handleUploadError, controller.create);
router.patch('/:id/image', ...adminOnly, upload.single('image'), handleUploadError, controller.replaceImage);
router.patch('/:id', ...adminOnly, controller.update);
router.delete('/:id', ...adminOnly, controller.remove);

module.exports = router;
