const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const controller = require('../controllers/userController');

// Every endpoint requires an active admin who has changed their temporary password.
router.use(protect, authorize('admin'));
router.post('/', controller.create);
router.get('/', controller.list);
router.patch('/:id', controller.update);
router.patch('/:id/status', controller.setStatus);
router.post('/:id/reset-password', controller.resetPassword);

module.exports = router;
