const Notice = require('../models/Notice');
const mongoose = require('mongoose');

// Use the same visibility rules for lists and details so drafts stay private.
const publicNoticeFilter = () => {
  const now = new Date();
  return {
    isPublished: true,
    publishDate: { $lte: now },
    $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
  };
};

exports.getAll = async (req, res) => {
  // Validate query strings before using them; never accept raw query objects.
  if (Object.keys(req.query).some(key => !['page', 'limit', 'category'].includes(key))) {
    return res.status(400).json({ message: 'Supported query parameters are page, limit, and category' });
  }
  const pageText = req.query.page === undefined ? '1' : req.query.page;
  const limitText = req.query.limit === undefined ? '20' : req.query.limit;
  const isPositiveInteger = value => typeof value === 'string' && /^[1-9]\d*$/.test(value);
  if (!isPositiveInteger(pageText) || !isPositiveInteger(limitText)) {
    return res.status(400).json({ message: 'Page and limit must be positive integers' });
  }

  const page = Number(pageText);
  const limit = Number(limitText);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) ||
      limit > 100 || !Number.isSafeInteger(skip) || skip > 100000) {
    return res.status(400).json({ message: 'Limit must be at most 100 and page offset at most 100000' });
  }

  const filter = publicNoticeFilter();
  if (req.query.category !== undefined) {
    const categories = Notice.schema.path('category').enumValues;
    if (typeof req.query.category !== 'string' || !categories.includes(req.query.category)) {
      return res.status(400).json({ message: 'Invalid notice category' });
    }
    filter.category = req.query.category;
  }

  // Bound the result size and query duration. _id breaks ties consistently.
  const [notices, total] = await Promise.all([
    Notice.find(filter).select('-__v').sort({ publishDate: -1, _id: -1 })
      .skip(skip).limit(limit).maxTimeMS(5000).lean(),
    Notice.countDocuments(filter).maxTimeMS(5000),
  ]);
  res.json({ notices, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
};

exports.listManage = async (req, res) => {
  const supported = ['category', 'isPublished', 'page', 'limit'];
  const query = req.query;

  // Reject unknown keys and nested/array values before building a database filter.
  if (Object.keys(query).some(key => !supported.includes(key) || typeof query[key] !== 'string')) {
    return res.status(400).json({ message: 'Query parameters must be supported single string values' });
  }

  const filter = {};
  if (query.category !== undefined) {
    const categories = Notice.schema.path('category').enumValues;
    if (!categories.includes(query.category)) {
      return res.status(400).json({ message: 'Invalid notice category' });
    }
    filter.category = query.category;
  }

  if (query.isPublished !== undefined) {
    if (!['true', 'false'].includes(query.isPublished)) {
      return res.status(400).json({ message: 'isPublished must be true or false' });
    }
    filter.isPublished = query.isPublished === 'true';
  }

  const pageText = query.page === undefined ? '1' : query.page;
  const limitText = query.limit === undefined ? '20' : query.limit;
  const isPositiveInteger = value => /^[1-9]\d*$/.test(value);
  if (!isPositiveInteger(pageText) || !isPositiveInteger(limitText)) {
    return res.status(400).json({ message: 'Page and limit must be positive integers' });
  }

  const page = Number(pageText);
  const limit = Number(limitText);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 50 ||
      !Number.isSafeInteger(skip)) {
    return res.status(400).json({ message: 'Limit must be at most 50 and page offset must be valid' });
  }

  // The manage view includes drafts and scheduled/expired notices, newest created first.
  const [notices, total] = await Promise.all([
    Notice.find(filter).select('+createdBy -__v').populate('createdBy', 'name')
      .sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).maxTimeMS(5000).lean(),
    Notice.countDocuments(filter).maxTimeMS(5000),
  ]);

  res.json({ notices, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
};

exports.getOne = async (req, res) => {
  // URLs require a 24-character hexadecimal MongoDB ID.
  if (typeof req.params.id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(req.params.id) ||
      !mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid notice ID' });
  }

  const notice = await Notice.findOne({ ...publicNoticeFilter(), _id: req.params.id })
    .select('-__v').maxTimeMS(5000).lean();
  // Hidden and missing notices share a response, avoiding draft disclosure.
  if (!notice) return res.status(404).json({ message: 'Notice not found' });
  res.json(notice);
};

exports.create = async (req, res) => {
  // Copy only permitted fields; clients cannot supply IDs or timestamps.
  const allowedFields = [
    'title', 'content', 'category', 'isImportant',
    'isPublished', 'publishDate', 'expiryDate',
  ];
  const noticeData = {};
  const body = req.body || {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      noticeData[field] = body[field];
    }
  }

  // Attribution always comes from the authenticated admin, never client input.
  noticeData.createdBy = req.user._id;

  // Mongoose validates the model; Express 5 forwards errors to errorHandler.
  const notice = await Notice.create(noticeData);
  res.status(201).json(notice);
};

exports.update = async (req, res) => {
  // Reject an invalid ID before sending a query to MongoDB.
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid notice ID' });
  }

  const notice = await Notice.findById(req.params.id);
  if (!notice) {
    return res.status(404).json({ message: 'Notice not found' });
  }

  // Change only permitted fields that were actually sent in this PATCH.
  const allowedFields = [
    'title', 'content', 'category', 'isImportant',
    'isPublished', 'publishDate', 'expiryDate',
  ];
  const body = req.body || {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      notice.set(field, body[field]);
    }
  }

  // Validate the full document so expiryDate can compare with publishDate,
  // including when only publishDate changes and expiryDate stays the same.
  // Express 5 forwards validation and database errors to errorHandler.
  await notice.save();
  res.status(200).json(notice);
};

exports.remove = async (req, res) => {
  // Reject an invalid ID before sending a delete query to MongoDB.
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid notice ID' });
  }

  // This operation deletes the notice and returns the document it deleted.
  // Express 5 forwards any database error to the error handler automatically.
  const notice = await Notice.findByIdAndDelete(req.params.id);
  if (!notice) {
    return res.status(404).json({ message: 'Notice not found' });
  }

  res.status(200).json({ message: 'Notice deleted successfully', id: notice._id });
};
