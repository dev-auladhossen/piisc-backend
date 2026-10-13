const router = require('express').Router();
const { login } = require('../controllers/authController');

// Public login only; accounts are created by an administrator, not registration.
router.post('/login', login);

module.exports = router;
