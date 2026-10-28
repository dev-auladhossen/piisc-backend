const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const { admissionsSubmitLimiter } = require('../middleware/rateLimiters');
const controller = require('../controllers/admissionController');

router.post('/', admissionsSubmitLimiter, controller.submit);
router.use(protect, authorize('admin'), (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.get('/notifications/summary', controller.notificationSummary);
router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.patch('/:id/status', controller.updateStatus);
router.patch('/:id/notes', controller.updateNotes);
router.patch('/:id/read', controller.setReadState);

module.exports = router;
