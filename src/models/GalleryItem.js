const mongoose = require("mongoose");

const GALLERY_CATEGORIES = ["Academics", "Events", "Sports", "Campus"];

const galleryItemSchema = new mongoose.Schema(
  {
    imageUrl: {
      type: String,
      required: [true, "Image URL is required"],
      match: [/^https:\/\//, "Image URL must use HTTPS"],
    },
    imagePublicId: {
      type: String,
      required: [true, "Cloudinary public ID is required"],
      unique: true,
    },
    caption: {
      type: String,
      required: [true, "Caption is required"],
      trim: true,
      minlength: [1, "Caption must not be empty"],
      maxlength: [300, "Caption must be at most 300 characters"],
    },
    // Optional for existing records; API-created records must supply a category.
    category: {
      type: String,
      enum: GALLERY_CATEGORIES,
    },
    altText: {
      type: String,
      trim: true,
      maxlength: [300, "Alt text must be at most 300 characters"],
      default: "",
    },
    displayOrder: {
      type: Number,
      min: [0, "Display order must be zero or greater"],
      max: [100000, "Display order must be at most 100000"],
      default: 0,
    },
  },
  { timestamps: true },
);

galleryItemSchema.index({ displayOrder: 1, createdAt: -1, _id: 1 });
galleryItemSchema.index({ category: 1, displayOrder: 1, createdAt: -1, _id: 1 });

const GalleryItem = mongoose.model("GalleryItem", galleryItemSchema);
GalleryItem.GALLERY_CATEGORIES = GALLERY_CATEGORIES;

module.exports = GalleryItem;
