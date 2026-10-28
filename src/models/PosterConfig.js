const mongoose = require('mongoose');

// A fixed ID keeps every poster setting update on the same MongoDB document.
const POSTER_CONFIG_ID = 'public-poster';

const posterConfigSchema = new mongoose.Schema({
  _id: { type: String, default: POSTER_CONFIG_ID },
  imageUrl: {
    type: String,
    default: null,
    match: [/^https:\/\//, 'Poster image URL must use HTTPS'],
  },
  imagePublicId: { type: String, default: null },
  enabled: { type: Boolean, default: false, required: true },
}, { timestamps: true, versionKey: false });

const PosterConfig = mongoose.model('PosterConfig', posterConfigSchema);
PosterConfig.POSTER_CONFIG_ID = POSTER_CONFIG_ID;

module.exports = PosterConfig;
