require("dotenv").config();
const mongoose = require("mongoose");
const Notice = require("./src/models/Notice");

const notices = [
  {
    title: "Admission Open 2027",
    content: "Admission for the new session starts January 1.",
    category: "admission",
  },
  {
    title: "Annual Sports Day",
    content: "Sports day will be held on February 15 at the school ground.",
    category: "event",
  },
  {
    title: "Winter Vacation",
    content: "School will remain closed from December 20 to January 5.",
    category: "holiday",
  },
  {
    title: "Parent-Teacher Meeting",
    content: "Meeting scheduled for March 3 at 10:00 AM.",
    category: "meeting",
  },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    await Notice.deleteMany();
    await Notice.insertMany(notices);
    console.log("Seeded", notices.length, "notices");
  } catch (err) {
    console.error(err.message);
  } finally {
    await mongoose.disconnect();
  }
})();
