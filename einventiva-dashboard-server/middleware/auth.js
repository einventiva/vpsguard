const { API_TOKEN } = require('../config');

function httpAuth(req, res, next) {
  if (req.path === '/health') return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing Bearer token' });
  }
  const token = authHeader.split(' ')[1];
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized: invalid token' });
  }
  next();
}

function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token;
  if (token === API_TOKEN) {
    next();
  } else {
    next(new Error('Unauthorized'));
  }
}

module.exports = { httpAuth, socketAuth };
