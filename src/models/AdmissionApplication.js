const mongoose = require('mongoose');
const { randomBytes } = require('node:crypto');

const STATUSES = ['Pending', 'Under Review', 'Contacted', 'Accepted', 'Rejected', 'Withdrawn'];
const INTERNAL_NOTES_MAX_LENGTH = 5000;
// Only sessions explicitly configured by the school are accepted. An empty
// list keeps submissions closed until a real academic session is configured.
function getValidAcademicSessions() {
  return (process.env.ADMISSION_ACADEMIC_SESSIONS || '')
    .split(',')
    .map((session) => session.trim())
    .filter(Boolean);
}

// The repository currently documents Class 5 as the only admission option.
const APPLYING_CLASSES = ['Class 5'];

function makeApplicationNumber() {
  const year = new Date().getUTCFullYear();
  // The unique index below is the final authority if two generated values collide.
  const randomPart = randomBytes(8).toString('hex').toUpperCase();
  return `ADM-${year}-${randomPart}`;
}

const admissionApplicationSchema = new mongoose.Schema({
  applicationNumber: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    trim: true,
  },
  studentFullName: {
    type: String,
    required: [true, 'Student name is required'],
    trim: true,
    minlength: [2, 'Student name must be at least 2 characters'],
    maxlength: [120, 'Student name must be at most 120 characters'],
  },
  dateOfBirth: {
    type: Date,
    validate: {
      validator: (value) => value == null || value < new Date(),
      message: 'Date of birth must be in the past',
    },
  },
  applyingClass: {
    type: String,
    required: [true, 'Applying class is required'],
    trim: true,
    minlength: [1, 'Applying class is required'],
    maxlength: [50, 'Applying class must be at most 50 characters'],
    enum: { values: APPLYING_CLASSES, message: 'Applying class is not available' },
  },
  academicSession: {
    type: String,
    required: [true, 'Academic session is required'],
    trim: true,
    maxlength: [30, 'Academic session must be at most 30 characters'],
    validate: {
      validator: (value) => getValidAcademicSessions().includes(value),
      message: 'Academic session is not configured',
    },
  },
  guardianFullName: {
    type: String,
    required: [true, 'Parent or guardian name is required'],
    trim: true,
    minlength: [2, 'Parent or guardian name must be at least 2 characters'],
    maxlength: [120, 'Parent or guardian name must be at most 120 characters'],
  },
  guardianRelationship: {
    type: String,
    required: [true, 'Parent or guardian relationship is required'],
    trim: true,
    minlength: [2, 'Relationship must be at least 2 characters'],
    maxlength: [40, 'Relationship must be at most 40 characters'],
  },
  guardianPhone: {
    type: String,
    required: [true, 'Parent or guardian phone is required'],
    trim: true,
    maxlength: [30, 'Phone number must be at most 30 characters'],
  },
  guardianEmail: {
    type: String,
    required: [true, 'Parent or guardian email is required'],
    trim: true,
    lowercase: true,
    maxlength: [254, 'Email must be at most 254 characters'],
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email must be a valid email address'],
  },
  address: {
    type: String,
    trim: true,
    maxlength: [500, 'Address must be at most 500 characters'],
  },
  previousSchool: {
    type: String,
    trim: true,
    maxlength: [150, 'Previous school must be at most 150 characters'],
  },
  message: {
    type: String,
    trim: true,
    maxlength: [2000, 'Message must be at most 2000 characters'],
  },
  consentConfirmed: {
    type: Boolean,
    required: [true, 'Consent confirmation is required'],
    validate: {
      validator: (value) => value === true,
      message: 'Consent must be confirmed',
    },
  },
  consentAt: {
    type: Date,
    required: [true, 'Consent timestamp is required'],
    default: Date.now,
    immutable: true,
  },
  status: {
    type: String,
    enum: STATUSES,
    default: 'Pending',
    required: true,
  },
  isRead: { type: Boolean, default: false, required: true },
  internalNotes: {
    type: String,
    trim: true,
    maxlength: [INTERNAL_NOTES_MAX_LENGTH, 'Internal notes must be at most 5000 characters'],
    default: '',
  },
}, { timestamps: true });

admissionApplicationSchema.index({ createdAt: -1, _id: -1 });
admissionApplicationSchema.index({ status: 1, createdAt: -1, _id: -1 });
admissionApplicationSchema.index({ isRead: 1, createdAt: -1 });

admissionApplicationSchema.pre('validate', function () {
  if (!this.applicationNumber) this.applicationNumber = makeApplicationNumber();
  // Record consent on the server after consent has passed validation.
  if (this.isNew && this.consentConfirmed === true) this.consentAt = new Date();
});

const AdmissionApplication = mongoose.model('AdmissionApplication', admissionApplicationSchema);
AdmissionApplication.STATUSES = STATUSES;
AdmissionApplication.APPLYING_CLASSES = APPLYING_CLASSES;
AdmissionApplication.INTERNAL_NOTES_MAX_LENGTH = INTERNAL_NOTES_MAX_LENGTH;
AdmissionApplication.makeApplicationNumber = makeApplicationNumber;

module.exports = AdmissionApplication;
