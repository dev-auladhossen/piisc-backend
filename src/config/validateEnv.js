// Check required configuration before the server starts connecting to services.
function validateEnv() {
  const required = ['MONGO_URI', 'JWT_SECRET', 'CLIENT_URL'];
  const problems = [];

  for (const name of required) {
    if (!process.env[name] || !process.env[name].trim()) {
      problems.push(`${name} is required and must not be empty.`);
    }
  }

  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters long.');
  }

  if (!process.env.JWT_EXPIRES_IN) {
    process.env.JWT_EXPIRES_IN = '1d';
  }

  if (problems.length) {
    console.error(`Environment configuration error: ${problems.join(' ')}`);
    process.exit(1);
  }
}

module.exports = validateEnv;
