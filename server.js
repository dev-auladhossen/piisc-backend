require("dotenv").config();
const express = require("express");
const connectDB = require("./src/config/db");

const app = express();
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5000;
connectDB().then(() => {
    
  const Notice = require("./src/models/Notice");
  app.post("/api/test", async (req, res) => {
    const doc = await Notice.create({ title: "Test", content: "Hello Atlas" });
    res.status(201).json(doc);
  });

  app.listen(PORT, () => console.log(`API running on port ${PORT}`));
});
