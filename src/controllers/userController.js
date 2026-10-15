const mongoose = require('mongoose');
const User = require('../models/User');
const generateTempPassword = require('../utils/generatePassword');

const roles = ['admin', 'teacher', 'student', 'parent'];
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// Shared responses avoid repeating database error handling in every action.
function handleError(error, res) {
  if (error.code === 11000) {
    const message = error.keyPattern?.studentId ? 'Student ID already in use' : 'Email already in use';
    return res.status(409).json({ message });
  }
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(item =>
      item.name === 'CastError' ? `Invalid value for ${item.path}` : item.message);
    return res.status(400).json({ message: 'User validation failed', errors });
  }
  // Raw database errors can contain submitted passwords or hashes: log type/code only.
  console.error(`User operation failed (${error.name}, code ${error.code || 'unknown'})`);
  return res.status(500).json({ message: 'An unexpected server error occurred' });
}

function validId(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ message: 'Invalid user ID' });
    return false;
  }
  return true;
}

// Only relevant, explicitly whitelisted fields are copied. Reject object inputs.
function readStrings(body, fields, res) {
  const data = {};
  for (const field of fields) {
    if (!has(body, field)) continue;
    if (typeof body[field] !== 'string') {
      res.status(400).json({ message: `${field} must be a string` });
      return null;
    }
    data[field] = body[field].trim();
  }
  return data;
}

exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body.role !== 'string' || !roles.includes(body.role.trim())) {
      return res.status(400).json({ message: 'Role must be admin, teacher, student, or parent' });
    }
    const role = body.role.trim();
    const data = readStrings(body, ['name', role === 'student' ? 'studentId' : 'email'], res);
    if (!data) return;
    const temporaryPassword = generateTempPassword();
    const user = await User.create({ ...data, role, password: temporaryPassword,
      mustChangePassword: true, isActive: true });
    // Plaintext is returned once, not stored; prevent response caching.
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ user: user.toJSON(), temporaryPassword });
  } catch (error) { handleError(error, res); }
};

exports.list = async (req, res) => {
  try {
    const query = req.query;
    const supported = ['role', 'search', 'isActive', 'page', 'limit'];
    // Reject unknown keys too: Express's simple parser keeps role[$ne] as a literal key.
    if (Object.keys(query).some(key => !supported.includes(key) || typeof query[key] !== 'string')) {
      return res.status(400).json({ message: 'Query parameters must be supported single string values' });
    }
    const filter = {};
    if (query.role !== undefined) {
      if (!roles.includes(query.role.trim())) return res.status(400).json({ message: 'Invalid role' });
      filter.role = query.role.trim();
    }
    if (query.isActive !== undefined) {
      const value = query.isActive.trim();
      if (!['true', 'false'].includes(value)) return res.status(400).json({ message: 'isActive must be true or false' });
      filter.isActive = value === 'true';
    }
    if (query.search !== undefined) {
      const search = query.search.trim();
      if (search.length > 50) return res.status(400).json({ message: 'Search must be at most 50 characters' });
      if (search) {
        // Escape metacharacters: input is literal text, never executable regex syntax.
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, 'i');
        filter.$or = ['name', 'email', 'studentId'].map(field => ({ [field]: pattern }));
      }
    }
    const pageText = query.page === undefined ? '1' : query.page.trim();
    const limitText = query.limit === undefined ? '20' : query.limit.trim();
    const page = Number(pageText), limit = Number(limitText);
    const skip = (page - 1) * limit;
    if (!/^[1-9]\d*$/.test(pageText) || !/^[1-9]\d*$/.test(limitText) ||
        !Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 50 ||
        !Number.isSafeInteger(skip)) {
      return res.status(400).json({ message: 'Page must be a positive integer; limit must be between 1 and 50' });
    }
    // Normal document queries hide the hash; JSON transforms also remove __v.
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({ users, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) { handleError(error, res); }
};

exports.update = async (req, res) => {
  try {
    if (!validId(req, res)) return;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const data = readStrings(req.body || {}, ['name', user.role === 'student' ? 'studentId' : 'email'], res);
    if (!data) return;
    for (const [field, value] of Object.entries(data)) user.set(field, value);
    // Full-document save runs role-dependent validators without modifying the role.
    await user.save();
    res.json({ user: user.toJSON() });
  } catch (error) { handleError(error, res); }
};

exports.setStatus = async (req, res) => {
  try {
    if (!validId(req, res)) return;
    const { isActive } = req.body || {};
    if (typeof isActive !== 'boolean') return res.status(400).json({ message: 'isActive must be a boolean' });
    if (req.params.id.toLowerCase() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot change your own status' });
    }
    // Immutable roles + no deletion + no self-status changes preserve an active
    // admin for sequential requests. Concurrent mutual deactivation still needs
    // transaction/serialization protection before production deployment.
    const user = await User.findByIdAndUpdate(req.params.id, { isActive }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: user.toJSON() });
  } catch (error) { handleError(error, res); }
};

exports.resetPassword = async (req, res) => {
  try {
    if (!validId(req, res)) return;
    if (req.params.id.toLowerCase() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Use change password for your own account' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const temporaryPassword = generateTempPassword();
    user.password = temporaryPassword;
    user.mustChangePassword = true;
    await user.save();
    // Existing JWTs still verify, but strict protect blocks normal routes while
    // mustChangePassword is true. Tokens are not permanently revoked by this reset.
    res.set('Cache-Control', 'no-store');
    res.json({ user: user.toJSON(), temporaryPassword });
  } catch (error) { handleError(error, res); }
};
