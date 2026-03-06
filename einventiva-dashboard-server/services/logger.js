function log(message, context = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, context);
}

function handleError(res, error, defaultMessage, statusCode = 500) {
  log(`Error: ${defaultMessage}`, { error: error.message });
  res.status(statusCode).json({
    error: defaultMessage,
    details: error.message
  });
}

module.exports = { log, handleError };
