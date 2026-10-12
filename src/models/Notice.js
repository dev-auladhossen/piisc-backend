const mongoose = require('mongoose');

const noticeSchema = new mongoose.Schema({
  // Provides the headline shown in notice lists.
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    minlength: [3, 'Title must be at least 3 characters'],
    maxlength: [150, 'Title must be at most 150 characters'],
  },
  // Stores the full text of the notice.
  content: {
    type: String,
    required: [true, 'Content is required'],
    minlength: [10, 'Content must be at least 10 characters'],
  },
  // Groups notices so visitors can filter them by topic.
  category: {
    type: String,
    enum: {
      values: ['general', 'admission', 'event', 'holiday', 'exam', 'meeting'],
      message: 'Category must be general, admission, event, holiday, exam, or meeting',
    },
    default: 'general',
  },
  // Marks urgent notices for highlighting on the website.
  isImportant: { type: Boolean, default: false },
  // Lets an administrator mark a notice as published or as a draft.
  isPublished: { type: Boolean, default: true },
  // Records the publication date for display and sorting.
  publishDate: { type: Date, default: Date.now },
  // Records when a notice expires, if an expiry date is provided.
  expiryDate: {
    type: Date,
    validate: {
      validator: function (value) {
        if (value == null) return true;
        return value > this.publishDate;
      },
      message: 'Expiry date must be after publish date',
    },
  },
}, { timestamps: true });

module.exports = mongoose.model('Notice', noticeSchema);
