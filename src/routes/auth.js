const router = require('express').Router();
const { login, getMe, changePassword } = require('../controllers/authController');
const { protect, protectAllowTempPassword, authorize } = require('../middleware/auth');

// Public login only; accounts are created by an administrator, not registration.
router.post('/login', login);

// Authenticate first so the controller receives req.user.
router.get('/me', protectAllowTempPassword, getMe);
// Users must be able to replace their temporary password before strict access.
router.patch('/change-password', protectAllowTempPassword, changePassword);

// TEMPORARY - DELETE BEFORE COMMIT
router.get('/_test-protected', protect, (req, res) => {
  res.json({ message: 'ok' });
});

// TEMPORARY - DELETE BEFORE COMMIT
router.get('/_test-admin', protect, authorize('admin'), (req, res) => {
  res.json({ message: 'admin ok' });
});

module.exports = router;
