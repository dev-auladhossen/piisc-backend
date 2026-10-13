const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Strip private storage fields even when the hash was explicitly selected.
const removePrivateFields = (doc, output) => {
  delete output.passwordHash;
  delete output.__v;
  delete output.password;
  return output;
};

const userSchema = new mongoose.Schema({
  // The name shown in the dashboard.
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [80, 'Name must be at most 80 characters'],
  },
  // Determines which dashboard and permissions the user receives.
  role: {
    type: String,
    required: [true, 'Role is required'],
    enum: {
      values: ['admin', 'teacher', 'student', 'parent'],
      message: 'Role must be admin, teacher, student, or parent',
    },
  },
  // Staff and parents use an email address to log in.
  email: {
    type: String,
    trim: true,
    lowercase: true,
    required: [function () {
      return ['admin', 'teacher', 'parent'].includes(this.role);
    }, 'Email is required for admins, teachers, and parents'],
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email must be a valid email address'],
  },
  // Students use their school-issued ID to log in.
  studentId: {
    type: String,
    trim: true,
    uppercase: true,
    required: [function () { return this.role === 'student'; }, 'Student ID is required for students'],
    match: [/^PIISC-\d{4}-\d{3}$/, 'Student ID must use the format PIISC-YYYY-NNN'],
  },
  // Only the hash is stored; normal queries do not select it.
  passwordHash: {
    type: String,
    required: [function () {
      // Validation runs BEFORE the save hook. A pending password will be hashed there.
      const password = this.$locals.password;
      if (password !== undefined) {
        if (typeof password !== 'string' || password.length < 8) {
          this.invalidate('password', 'Password must be at least 8 characters');
        }
        return false;
      }
      // A loaded document may intentionally have its hash excluded by select: false.
      return this.isNew || this.isSelected('passwordHash');
    }, 'Password is required'],
    select: false,
  },
  // Allows an administrator to deactivate an account.
  isActive: { type: Boolean, default: true },
  // Records whether the user still needs to replace a temporary password.
  mustChangePassword: { type: Boolean, default: true },
  // Records the most recent successful login.
  lastLogin: { type: Date, default: null },
}, {
  timestamps: true,
  toJSON: { transform: removePrivateFields },
  toObject: { transform: removePrivateFields },
});

// Only string identifiers participate, so many users can omit the other identifier.
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ studentId: 1 }, { unique: true, partialFilterExpression: { studentId: { $type: 'string' } } });

// A virtual accepts plaintext without adding a password field to MongoDB.
userSchema.virtual('password').set(function (value) {
  this.$locals.password = value;
});

// Mongoose 9 awaits async hooks; no next() callback is needed.
userSchema.pre('save', async function () {
  const password = this.$locals.password;
  if (password === undefined) return; // Ordinary profile saves keep the existing hash.

  if (typeof password !== 'string' || password.length < 8) {
    const error = new mongoose.Error.ValidationError(this);
    error.addError('password', new mongoose.Error.ValidatorError({
      path: 'password', message: 'Password must be at least 8 characters',
    }));
    throw error;
  }

  this.passwordHash = await bcrypt.hash(password, 10);
  delete this.$locals.password; // Do not keep plaintext or re-hash it on the next save.
});

// Login must select the hash explicitly before calling this method.
userSchema.methods.comparePassword = async function (candidate) {
  if (typeof candidate !== 'string' || !this.passwordHash) return false;
  return bcrypt.compare(candidate, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);
