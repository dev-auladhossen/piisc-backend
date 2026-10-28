const mongoose = require('mongoose');
const AdmissionApplication = require('../models/AdmissionApplication');
const { notifyAdmissionsAdmin } = require('../services/admissionEmail');

const publicFields = [
  'studentFullName', 'dateOfBirth', 'applyingClass', 'academicSession',
  'guardianFullName', 'guardianRelationship', 'guardianPhone', 'guardianEmail',
  'address', 'previousSchool', 'message', 'consentConfirmed',
];
const listFields = '_id applicationNumber studentFullName applyingClass academicSession guardianFullName guardianEmail guardianPhone status isRead createdAt';
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
}

function validId(id) {
  return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id) && mongoose.isValidObjectId(id);
}

function errorResponse(error, res) {
  if (error?.name === 'ValidationError') {
    return res.status(400).json({ message: 'Please check the application details', errors: Object.fromEntries(Object.entries(error.errors || {}).map(([key]) => [key, 'Invalid value'])) });
  }
  if (error?.name === 'CastError') return res.status(400).json({ message: 'Invalid application data' });
  if (error?.code === 11000) return res.status(409).json({ message: 'A duplicate record was detected' });
  console.error(`Admission operation failed (${error?.name || 'Error'}, code ${error?.code || 'unknown'})`);
  return res.status(500).json({ message: 'An unexpected server error occurred' });
}

function configuredAcademicSessions() {
  return (process.env.ADMISSION_ACADEMIC_SESSIONS || '')
    .split(',')
    .map((session) => session.trim())
    .filter(Boolean);
}

function isApplicationNumberCollision(error) {
  return error?.code === 11000 && (
    error.keyPattern?.applicationNumber === 1
    || Object.hasOwn(error.keyValue || {}, 'applicationNumber')
    || /applicationNumber_1/.test(error.message || '')
  );
}

function validateSubmission(body) {
  const errors = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: { form: 'Invalid request body' } };
  for (const key of Object.keys(body)) {
    if (!publicFields.includes(key)) errors[key] = 'This field is not supported';
  }
  const strings = ['studentFullName', 'applyingClass', 'academicSession', 'guardianFullName', 'guardianRelationship', 'guardianPhone', 'guardianEmail'];
  const limits = { studentFullName: 120, applyingClass: 50, academicSession: 30, guardianFullName: 120, guardianRelationship: 40, guardianPhone: 30, guardianEmail: 254, address: 500, previousSchool: 150, message: 2000 };
  const data = {};
  for (const field of strings) {
    if (typeof body[field] !== 'string' || !body[field].trim()) errors[field] = 'This field is required';
    else if (body[field].trim().length > limits[field]) errors[field] = 'This field is too long';
    else data[field] = body[field].trim();
  }
  for (const field of ['address', 'previousSchool', 'message']) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string') errors[field] = 'This field must be text';
    else if (body[field].trim().length > limits[field]) errors[field] = 'This field is too long';
    else if (body[field].trim()) data[field] = body[field].trim();
  }
  if (data.studentFullName && data.studentFullName.length < 2) errors.studentFullName = 'Enter a valid name';
  if (data.guardianFullName && data.guardianFullName.length < 2) errors.guardianFullName = 'Enter a valid name';
  if (data.guardianEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.guardianEmail)) errors.guardianEmail = 'Enter a valid email';
  if (data.guardianPhone) {
    const digits = data.guardianPhone.replace(/\D/g, '');
    if (!/^\+?[0-9().\-\s]+$/.test(data.guardianPhone) || digits.length < 7 || digits.length > 15) {
      errors.guardianPhone = 'Enter a valid phone number';
    }
  }
  if (body.dateOfBirth !== undefined && body.dateOfBirth !== '') {
    if (typeof body.dateOfBirth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dateOfBirth) || Number.isNaN(Date.parse(`${body.dateOfBirth}T00:00:00Z`)) || new Date(`${body.dateOfBirth}T00:00:00Z`).toISOString().slice(0, 10) !== body.dateOfBirth || new Date(`${body.dateOfBirth}T00:00:00Z`) >= new Date()) {
      errors.dateOfBirth = 'Enter a valid date in the past';
    } else data.dateOfBirth = body.dateOfBirth;
  }
  if (body.consentConfirmed !== true) errors.consentConfirmed = 'Consent is required';
  else data.consentConfirmed = true;
  return { data, errors };
}

exports.submit = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sessions = configuredAcademicSessions();
  if (sessions.length === 0 || !AdmissionApplication.APPLYING_CLASSES?.length) {
    return res.status(503).json({ message: 'Online admissions are not currently configured.' });
  }
  const { data, errors } = validateSubmission(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ message: 'Please check the application details', errors });
  if (!AdmissionApplication.APPLYING_CLASSES.includes(data.applyingClass)) {
    return res.status(400).json({ message: 'Please check the application details', errors: { applyingClass: 'This class is not available' } });
  }
  if (!sessions.includes(data.academicSession)) {
    return res.status(400).json({ message: 'Please check the application details', errors: { academicSession: 'This academic session is not available' } });
  }
  let application;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      application = new AdmissionApplication(data);
      await application.save();
      break;
    } catch (error) {
      if (isApplicationNumberCollision(error) && attempt < 2) continue;
      return errorResponse(error, res);
    }
  }
  if (!application) return res.status(409).json({ message: 'Unable to assign a unique application number. Please try again.' });
  let adminNotification = 'failed';
  try {
    adminNotification = await notifyAdmissionsAdmin(application);
    if (!['sent', 'failed', 'unavailable'].includes(adminNotification)) adminNotification = 'failed';
  } catch {
    // Email failures must never undo a saved application or expose error details.
    console.error('Admissions administrator notification failed (unexpected service error)');
  }
  return res.status(201).json({
    message: 'Your admission application has been received.',
    applicationNumber: application.applicationNumber,
    adminNotification,
  });
};

exports.list = async (req, res) => {
  const query = req.query;
  if (Object.keys(query).some((key) => !['page', 'limit', 'status', 'search'].includes(key) || typeof query[key] !== 'string')) {
    return res.status(400).json({ message: 'Query parameters must be supported single string values' });
  }
  const page = positiveInteger(query.page, 1);
  const limit = positiveInteger(query.limit, 20);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 100 || !Number.isSafeInteger(skip) || skip > 100000) {
    return res.status(400).json({ message: 'Page and limit must be positive integers, limit at most 100 and offset at most 100000' });
  }
  const filter = {};
  if (query.status !== undefined) {
    if (!AdmissionApplication.STATUSES.includes(query.status)) return res.status(400).json({ message: 'Invalid application status' });
    filter.status = query.status;
  }
  if (query.search !== undefined) {
    const value = query.search.trim();
    if (value.length > 100) return res.status(400).json({ message: 'Search must be at most 100 characters' });
    if (value) {
      const expression = new RegExp(escapeRegex(value), 'i');
      filter.$or = ['applicationNumber', 'studentFullName', 'guardianFullName', 'guardianEmail', 'guardianPhone'].map((field) => ({ [field]: expression }));
    }
  }
  try {
    const [applications, total] = await Promise.all([
      AdmissionApplication.find(filter).select(listFields).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).maxTimeMS(5000).lean(),
      AdmissionApplication.countDocuments(filter).maxTimeMS(5000),
    ]);
    return res.json({ applications, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { return errorResponse(error, res); }
};

exports.getOne = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid application ID' });
  try {
    const application = await AdmissionApplication.findById(req.params.id).select('-__v').lean();
    if (!application) return res.status(404).json({ message: 'Application not found' });
    return res.json({ application });
  } catch (error) { return errorResponse(error, res); }
};

exports.updateStatus = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid application ID' });
  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.status !== 'string') {
    return res.status(400).json({ message: 'A valid status is required' });
  }
  if (!AdmissionApplication.STATUSES.includes(body.status)) return res.status(400).json({ message: 'Invalid application status' });
  try {
    const application = await AdmissionApplication.findByIdAndUpdate(req.params.id, { status: body.status }, { new: true, runValidators: true }).select('-__v').lean();
    if (!application) return res.status(404).json({ message: 'Application not found' });
    return res.json({ application });
  } catch (error) { return errorResponse(error, res); }
};

exports.updateNotes = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid application ID' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.internalNotes !== 'string') {
    return res.status(400).json({ message: 'Internal notes must be a string' });
  }
  const maxLength = AdmissionApplication.INTERNAL_NOTES_MAX_LENGTH || 5000;
  if (body.internalNotes.trim().length > maxLength) {
    return res.status(400).json({ message: `Internal notes must be no longer than ${maxLength} characters` });
  }
  try {
    const application = await AdmissionApplication.findByIdAndUpdate(
      req.params.id,
      { internalNotes: body.internalNotes.trim() },
      { new: true, runValidators: true },
    ).select('-__v').lean();
    if (!application) return res.status(404).json({ message: 'Application not found' });
    return res.json({ application });
  } catch (error) { return errorResponse(error, res); }
};

exports.setReadState = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid application ID' });
  if (req.body !== undefined && req.body !== null && (
    typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => key !== 'isRead')
    || (Object.hasOwn(req.body, 'isRead') && req.body.isRead !== true)
  )) {
    return res.status(400).json({ message: 'This endpoint only marks applications as read' });
  }
  try {
    const application = await AdmissionApplication.findByIdAndUpdate(req.params.id, { isRead: true }, { new: true, runValidators: true }).select('-__v').lean();
    if (!application) return res.status(404).json({ message: 'Application not found' });
    return res.json({ application });
  } catch (error) { return errorResponse(error, res); }
};

exports.notificationSummary = async (req, res) => {
  try {
    const unreadCount = await AdmissionApplication.countDocuments({ isRead: false }).maxTimeMS(5000);
    return res.json({ unreadCount });
  } catch (error) { return errorResponse(error, res); }
};
