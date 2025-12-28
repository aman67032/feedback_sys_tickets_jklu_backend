const jwt = require('jsonwebtoken');
const pool = require('../lib/db');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const userQuery = await pool.query(
      'SELECT id, email, role, name, student_id, domain_id, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userQuery.rows.length === 0 || !userQuery.rows[0].is_active) {
      return res.status(401).json({ error: 'Invalid token or user inactive' });
    }

    req.user = userQuery.rows[0];
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

const requireSuperAdmin = requireRole(['super_admin']);
const requireSubAdmin = requireRole(['sub_admin', 'super_admin']);
const requireStudent = requireRole(['student', 'sub_admin', 'super_admin']);

module.exports = {
  authenticateToken,
  requireRole,
  requireSuperAdmin,
  requireSubAdmin,
  requireStudent
};
