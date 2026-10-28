const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const API_LIMIT = 300;
const LOGIN_IP_LIMIT = 20;
const LOGIN_ACCOUNT_LIMIT = 5;
const CHANGE_PASSWORD_LIMIT = 5;
const ADMISSIONS_SUBMIT_LIMIT = 5;

const response = {
  message: 'Too many attempts. Please try again later.',
  code: 'RATE_LIMITED',
};

function commonOptions(limit) {
  return {
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: 429,
    handler: (req, res) => res.status(429).json(response),
  };
}

const apiLimiter = rateLimit(commonOptions(API_LIMIT));

const loginIpLimiter = rateLimit({
  ...commonOptions(LOGIN_IP_LIMIT),
  skipSuccessfulRequests: true,
});

const loginAccountLimiter = rateLimit({
  ...commonOptions(LOGIN_ACCOUNT_LIMIT),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // The helper groups IPv6 addresses safely so changing the last address
    // segment cannot be used to evade this per-account limit.
    const ipKey = ipKeyGenerator(req.ip);
    const identifier = typeof req.body?.identifier === 'string'
      ? req.body.identifier.trim().toLowerCase().slice(0, 100)
      : '';
    return `${ipKey}:${identifier}`;
  },
});

const changePasswordLimiter = rateLimit({
  ...commonOptions(CHANGE_PASSWORD_LIMIT),
  skipSuccessfulRequests: true,
});

const admissionsSubmitLimiter = rateLimit({
  ...commonOptions(ADMISSIONS_SUBMIT_LIMIT),
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

module.exports = {
  apiLimiter,
  loginIpLimiter,
  loginAccountLimiter,
  changePasswordLimiter,
  admissionsSubmitLimiter,
};
