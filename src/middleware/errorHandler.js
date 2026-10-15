// Send JSON when no registered route matches the request.
exports.notFound = (req, res) => {
  res.status(404).json({ message: 'Route not found' });
};

// Express recognizes error middleware by its four parameters.
exports.errorHandler = (err, req, res, next) => {
  // If a response has already started, let Express finish handling the error.
  if (res.headersSent) return next(err);

  // Log only safe diagnostics on the server, never request data or credentials.
  if (process.env.NODE_ENV === 'production') {
    console.error(`Server error: ${err.name || 'Error'}: ${err.message || 'Unknown error'}`);
  } else {
    console.error(err.stack || `${err.name || 'Error'}: ${err.message || 'Unknown error'}`);
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request too large' });
  }

  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors || {}).map((error) => error.message);
    return res.status(400).json({ message: 'Validation failed', errors });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid value' });
  }

  if (err.code === 11000) {
    return res.status(409).json({ message: 'Duplicate value' });
  }

  return res.status(500).json({ message: 'Something went wrong' });
};
