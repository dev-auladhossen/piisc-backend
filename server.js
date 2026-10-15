require("dotenv").config();
require("./src/config/validateEnv")();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const connectDB = require("./src/config/db");
const { notFound, errorHandler } = require("./src/middleware/errorHandler");
const {
  apiLimiter,
  loginIpLimiter,
  loginAccountLimiter,
  changePasswordLimiter,
} = require("./src/middleware/rateLimiters");

const app = express();

// Add standard security headers using Helmet's defaults.
app.use(helmet());

// Trust proxy headers only when deployment is actually behind a trusted proxy.
// Leave this unset locally; use 1 on Render so the client IP is read correctly.
if (process.env.TRUST_PROXY) {
  const trustProxy = /^\d+$/.test(process.env.TRUST_PROXY)
    ? Number(process.env.TRUST_PROXY)
    : process.env.TRUST_PROXY;
  app.set("trust proxy", trustProxy);
}

// Normalize the configured list and request origin before comparing them.
const allowedOrigins = process.env.CLIENT_URL.split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalizedOrigin = origin.trim().replace(/\/+$/, "");
    return callback(null, allowedOrigins.includes(normalizedOrigin));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 600,
  credentials: false,
}));

// 50kb accommodates ordinary JSON forms while keeping large request bodies bounded;
// Bangla text can use about 3 bytes per character in UTF-8.
app.use(express.json({ limit: "50kb" }));

// Do not let browsers or intermediaries cache authentication and user responses.
app.use(["/api/auth", "/api/users"], (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Apply the broad API limit and stricter authentication limits before routers.
app.use("/api", apiLimiter);
app.post("/api/auth/login", loginIpLimiter, loginAccountLimiter);
app.patch("/api/auth/change-password", changePasswordLimiter);

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
