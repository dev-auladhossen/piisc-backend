const Notice = require('../models/Notice');

exports.getAll = async (req, res) => {
  const notices = await Notice.find().sort({ createdAt: -1 });
  res.json(notices);
};

exports.create = async (req, res) => {
  try {
    const notice = await Notice.create(req.body);
    res.status(201).json(notice);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.remove = async (req, res) => {
  await Notice.findByIdAndDelete(req.params.id);
  res.json({ message: 'Deleted' });
};