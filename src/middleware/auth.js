const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  // Accept exactly a Bearer scheme and one token, with no extra parts.
  const header = req.get('Authorization');
  const match = typeof header === 'string' && /^Bearer ([^\s]+)$/i.exec(header);
  if (!match) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  if (!process.env.JWT_SECRET?.trim()) {
    console.error('Authentication configuration error: JWT_SECRET is missing');
    return res.status(500).json({ message: 'An unexpected server error occurred' });
  }

  let decoded;
  try {
    // Explicitly restrict the accepted signing algorithm.
    decoded = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Not authenticated', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ message: 'Not authenticated' });
  }

  // Reject invalid ID claims before they can cause a MongoDB casting error.
  if (!decoded || typeof decoded.id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(decoded.id)) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  // Reload on every request: permissions and account activity may have changed.
  // The model excludes passwordHash from this normal query.
  // Express 5 automatically forwards unexpected async errors to error middleware.
  const user = await User.findById(decoded.id);
  if (!user || user.isActive !== true) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  req.user = user; // Use the database user, never the role claimed by the token.
  next();
};

// The outer function remembers which roles this route permits.
exports.authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'You do not have permission to do this' });
  }
  next();
};
