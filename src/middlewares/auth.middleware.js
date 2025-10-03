const jwt = require('jsonwebtoken');
const { User } = require('../models');
//validasi token

const tokenValidation = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // Check if token follows Bearer format
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Invalid token format. Use: Bearer <token>' });
    }

    // Extract token from Bearer format
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'Token not found in Bearer format' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Find user
    const user = await User.findByPk(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Add user to request
    req.user = user;
    next();
  } catch (err) {
    console.error('Token validation error:', err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    return res.status(500).json({ message: 'Internal server error during authentication' });
  }
};

const verifyAdmin = (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
    
    if (user.type !== 'admin') {
      return res.status(403).json({ message: 'Access forbidden. Admin rights required.' });
    }
    
    next();
  } catch (error) {
    console.error('Admin verification error:', error);
    return res.status(500).json({ message: 'Internal server error during admin verification' });
  }
};

module.exports = {
  tokenValidation,
  verifyAdmin
};