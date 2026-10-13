const router = require('express').Router();
const { login, getMe } = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');

// Public login only; accounts are created by an administrator, not registration.
router.post('/login', login);

// Authenticate first so the controller receives req.user.
router.get('/me', protect, getMe);

// TEMPORARY - DELETE BEFORE COMMIT
router.get('/_test-admin', protect, authorize('admin'), (req, res) => {
  res.json({ message: 'admin ok' });
});

module.exports = router;
