const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('node:crypto');

// Generate once at startup, using the same bcrypt cost as the User model.
// Unknown accounts still perform a comparison instead of returning immediately.
const dummyHash = bcrypt.hashSync(randomBytes(24).toString('hex'), 10);

// protect supplies the current database user; its JSON transform hides the hash.
exports.getMe = (req, res) => {
  res.status(200).json({ user: req.user });
};

exports.changePassword = async (req, res) => {
  let stage = 'input validation';
  try {
    // Read only password fields. Account permissions never come from the body.
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' ||
        !currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ message: 'New password must be between 8 and 128 characters' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ message: 'New password must be different from current password' });
    }

    stage = 'user lookup';
    const user = await User.findById(req.user._id).select('+passwordHash');
    // Recheck in case the account was deleted or deactivated after authentication.
    if (!user || user.isActive !== true) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    stage = 'password comparison';
    if (!await user.comparePassword(currentPassword)) {
      // 400 means form input is wrong; 401 would make the frontend discard the session.
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    stage = 'password save';
    user.password = newPassword; // The virtual passes plaintext to the model's hashing hook.
    user.mustChangePassword = false;
    await user.save(); // Run model validation and hashing; never hash in this controller.
    res.status(200).json({ message: 'Password changed successfully', user: user.toJSON() });
  } catch (error) {
    // Log only stage/type because raw error details could expose passwords or hashes.
    console.error(`Password change failed during ${stage} (${error.name})`);
    res.status(500).json({ message: 'An unexpected server error occurred' });
  }
};

exports.login = async (req, res) => {
  let stage = 'input validation';
  try {
    const { identifier, password } = req.body || {};
    // Accept strings only: objects must never become MongoDB query operators.
    if (typeof identifier !== 'string' || typeof password !== 'string' ||
        !identifier.trim() || !password) {
      return res.status(400).json({ message: 'Identifier and password are required' });
    }
    if (password.length > 128) {
      return res.status(400).json({ message: 'Password must not exceed 128 characters' });
    }

    const trimmedIdentifier = identifier.trim();
    const filter = trimmedIdentifier.includes('@')
      ? { email: trimmedIdentifier.toLowerCase() }
      : { studentId: trimmedIdentifier.toUpperCase() };

    stage = 'user lookup';
    // The model hides the hash by default; login needs it for comparison.
    const user = await User.findOne(filter).select('+passwordHash');
    stage = 'password comparison';
    const matches = user
      ? await user.comparePassword(password)
      : await bcrypt.compare(password, dummyHash);

    // Compare first even for inactive accounts; every credential failure is alike.
    if (!user || !matches || user.isActive !== true) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!process.env.JWT_SECRET?.trim()) {
      console.error('Login configuration error: JWT_SECRET is missing');
      return res.status(500).json({ message: 'An unexpected server error occurred' });
    }

    stage = 'JWT signing';
    const token = jwt.sign(
      { id: user._id.toString(), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' },
    );

    stage = 'lastLogin update';
    const lastLogin = new Date();
    // This query updates login time without running the password save hook.
    await User.updateOne({ _id: user._id }, { lastLogin });
    user.lastLogin = lastLogin;

    // The model's JSON transform removes passwordHash and includes mustChangePassword.
    res.status(200).json({ token, user: user.toJSON() });
  } catch (error) {
    // Log the failure stage/type; raw errors can contain credentials or query values.
    console.error(`Login failed during ${stage} (${error.name})`);
    res.status(500).json({ message: 'An unexpected server error occurred' });
  }
};
