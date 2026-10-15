require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./src/config/db");
const { notFound, errorHandler } = require("./src/middleware/errorHandler");

const app = express();

// Allow the configured frontend origin; disable CORS if none is configured.
app.use(cors({ origin: process.env.CLIENT_URL || false }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/notices", require("./src/routes/notices"));
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));

// These must come after every route: unmatched requests first, errors last.
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`API running on port ${PORT}`));
});
