const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Stricter rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '24h' });
};

router.post('/register', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('name').trim().isLength({ min: 2 }),
  body('role').isIn(['student', 'sub_admin']),
  body('studentId').optional().isLength({ min: 5 }),
  body('domainId').optional().isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name, role, studentId, domainId } = req.body;

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    if (role === 'sub_admin' && !domainId) {
      return res.status(400).json({ error: 'Domain ID is required for sub-admin' });
    }

    if (role === 'student' && !studentId) {
      return res.status(400).json({ error: 'Student ID is required for student registration' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(`
      INSERT INTO users (email, password_hash, role, name, student_id, domain_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, role, name, student_id, domain_id
    `, [email, passwordHash, role, name, studentId, domainId]);

    const user = result.rows[0];
    const token = generateToken(user.id);

    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource_type, new_values)
      VALUES ($1, $2, $3, $4)
    `, [user.id, 'REGISTER', 'user', { email, role, name }]);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        studentId: user.student_id,
        domainId: user.domain_id
      },
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').exists()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const result = await pool.query(`
      SELECT id, email, password_hash, role, name, student_id, domain_id, is_active
      FROM users WHERE email = $1
    `, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);

    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource_type, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5)
    `, [user.id, 'LOGIN', 'user', req.ip, req.get('User-Agent')]);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        studentId: user.student_id,
        domainId: user.domain_id
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
