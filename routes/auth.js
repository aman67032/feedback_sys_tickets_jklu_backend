const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const pool = require('../lib/db');

const router = express.Router();

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
  body('studentId').isLength({ min: 5 }).withMessage('Student ID must be at least 5 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name, studentId } = req.body;

    // Registration is only for students
    const role = 'student';

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    if (!studentId) {
      return res.status(400).json({ error: 'Student ID is required' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(`
      INSERT INTO users (email, password_hash, role, name, student_id, domain_id)
      VALUES ($1, $2, $3, $4, $5, NULL)
      RETURNING id, email, role, name, student_id, domain_id
    `, [email, passwordHash, role, name, studentId]);

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

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      // Look up the latest disable reason from audit logs
      const reasonResult = await pool.query(`
        SELECT new_values
        FROM audit_logs
        WHERE action = 'DISABLE_USER'
          AND resource_type = 'user'
          AND resource_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [user.id]);

      const reasonJson = reasonResult.rows[0]?.new_values || {};
      const reason = reasonJson.reason || 'Your account has been disabled by the administrator.';

      return res.status(401).json({
        error: 'Account is disabled',
        disabled: true,
        reason,
      });
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
