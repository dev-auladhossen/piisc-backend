const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/posterUpload');
const controller = require('../controllers/posterController');

const adminOnly = [protect, authorize('admin')];

router.get('/', controller.getPublic);
router.get('/admin', ...adminOnly, controller.getAdmin);
router.post('/admin/upload', ...adminOnly, upload.single('image'), handleUploadError, controller.upload);
router.patch('/admin/visibility', ...adminOnly, controller.setVisibility);
router.delete('/admin', ...adminOnly, controller.remove);

module.exports = router;
