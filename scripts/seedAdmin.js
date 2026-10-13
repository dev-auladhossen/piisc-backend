require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function seedAdmin() {
  try {
    // Check configuration before attempting any database connection.
    const requiredVariables = [
      'SEED_ADMIN_NAME', 'SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'MONGO_URI',
    ];
    const missing = requiredVariables.filter(key => !process.env[key]?.trim());
    if (missing.length) {
      console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    // Do not trim passwords: spaces can be part of the chosen password.
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (password.length < 8) {
      console.error('SEED_ADMIN_PASSWORD must be at least 8 characters');
      process.exitCode = 1;
      return;
    }

    // Normalize email exactly as the User model does before looking it up.
    const email = process.env.SEED_ADMIN_EMAIL.trim().toLowerCase();
    await mongoose.connect(process.env.MONGO_URI);
    await User.init(); // Ensure the unique indexes are ready before insertion.

    const existing = await User.findOne({ email });
    if (existing) {
      if (existing.role === 'admin') {
        console.log('Admin already exists, nothing changed');
      } else {
        console.error('Cannot create admin: this email belongs to a non-admin user. Nothing changed.');
        process.exitCode = 1;
      }
      return;
    }

    // create() runs the password virtual and save hook; do not supply a hash.
    // mustChangePassword remains true through the model's default.
    const admin = await User.create({
      name: process.env.SEED_ADMIN_NAME,
      email,
      role: 'admin',
      password,
      isActive: true,
    });

    // Print only these safe fields, never the whole document or environment.
    console.log('Admin created:', {
      name: admin.name,
      email: admin.email,
      role: admin.role,
      _id: admin._id.toString(),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      // Model validators provide clear messages without printing submitted values.
      const messages = Object.values(error.errors).map(fieldError =>
        fieldError.name === 'CastError' ? `Invalid value for ${fieldError.path}` : fieldError.message);
      console.error(`Admin validation failed: ${messages.join('; ')}`);
    } else if (error.code === 11000) {
      console.error('Cannot create admin: an identifier already exists. Nothing was overwritten.');
    } else {
      // Raw database errors might contain the connection URI, so do not print them.
      console.error('Admin seed failed. Check database connectivity, credentials, and index permissions.');
    }
    process.exitCode = 1;
  } finally {
    // Runs on success, failure, and early returns, even if no connection was made.
    try {
      await mongoose.disconnect();
    } catch {
      console.error('Failed to disconnect from MongoDB cleanly');
      process.exitCode = 1;
    }
  }
}

seedAdmin();
