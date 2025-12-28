const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const pool = require('../lib/db');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/users', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, role, domain, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT u.id, u.email, u.role, u.name, u.student_id, u.domain_id, u.is_active, u.created_at,
             d.name as domain_name
      FROM users u
      LEFT JOIN domains d ON u.domain_id = d.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (role) {
      query += ` AND u.role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }

    if (domain) {
      query += ` AND u.domain_id = $${paramIndex}`;
      params.push(domain);
      paramIndex++;
    }

    if (search) {
      query += ` AND (u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex} OR u.student_id ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    let countQuery = `
      SELECT COUNT(*) as total
      FROM users u
      LEFT JOIN domains d ON u.domain_id = d.id
      WHERE 1=1
    `;
    const countParams = [];
    let countParamIndex = 1;

    if (role) {
      countQuery += ` AND u.role = $${countParamIndex}`;
      countParams.push(role);
      countParamIndex++;
    }

    if (domain) {
      countQuery += ` AND u.domain_id = $${countParamIndex}`;
      countParams.push(domain);
      countParamIndex++;
    }

    if (search) {
      countQuery += ` AND (u.name ILIKE $${countParamIndex} OR u.email ILIKE $${countParamIndex} OR u.student_id ILIKE $${countParamIndex})`;
      countParams.push(`%${search}%`);
      countParamIndex++;
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const totalUsers = parseInt(countResult.rows[0].total);

    res.json({
      users: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalUsers,
        pages: Math.ceil(totalUsers / limit)
      }
    });

  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/users', authenticateToken, requireSuperAdmin, [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').trim().isLength({ min: 2 }),
  body('role').isIn(['student', 'sub_admin', 'super_admin']),
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
      return res.status(400).json({ error: 'Student ID is required for student' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(`
      INSERT INTO users (email, password_hash, role, name, student_id, domain_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, role, name, student_id, domain_id, created_at
    `, [email, passwordHash, role, name, studentId, domainId]);

    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, new_values)
      VALUES ($1, $2, $3, $4, $5)
    `, [req.user.id, 'CREATE_USER', 'user', result.rows[0].id, { email, role, name }]);

    res.status(201).json({
      message: 'User created successfully',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/users/:id/toggle', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot disable your own account' });
    }

    const userResult = await pool.query('SELECT is_active FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newStatus = !userResult.rows[0].is_active;

    await pool.query('UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', 
      [newStatus, id]);

    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, old_values, new_values)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [req.user.id, newStatus ? 'ENABLE_USER' : 'DISABLE_USER', 'user', id, 
        { is_active: !newStatus }, { is_active: newStatus }]);

    res.json({
      message: `User ${newStatus ? 'enabled' : 'disabled'} successfully`
    });

  } catch (error) {
    console.error('User toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle user status' });
  }
});

router.get('/audit-logs', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, action, resourceType, userId } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT al.id, al.action, al.resource_type, al.resource_id, al.old_values, al.new_values,
             al.ip_address, al.user_agent, al.created_at,
             u.name as user_name, u.email as user_email
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (action) {
      query += ` AND al.action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }

    if (resourceType) {
      query += ` AND al.resource_type = $${paramIndex}`;
      params.push(resourceType);
      paramIndex++;
    }

    if (userId) {
      query += ` AND al.user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      logs: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Audit logs fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

router.get('/dashboard', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const [
      userStats,
      complaintStats,
      domainStats,
      recentActivity
    ] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN role = 'student' THEN 1 END) as students,
          COUNT(CASE WHEN role = 'sub_admin' THEN 1 END) as sub_admins,
          COUNT(CASE WHEN role = 'super_admin' THEN 1 END) as super_admins,
          COUNT(CASE WHEN is_active = false THEN 1 END) as inactive
        FROM users
      `),
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
        FROM complaints
      `),
      pool.query(`
        SELECT d.name, COUNT(c.id) as complaint_count
        FROM domains d
        LEFT JOIN complaints c ON d.id = c.domain_id
        GROUP BY d.id, d.name
        ORDER BY complaint_count DESC
      `),
      pool.query(`
        SELECT al.action, al.resource_type, al.created_at, u.name as user_name
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ORDER BY al.created_at DESC
        LIMIT 10
      `)
    ]);

    res.json({
      userStats: userStats.rows[0],
      complaintStats: complaintStats.rows[0],
      domainStats: domainStats.rows,
      recentActivity: recentActivity.rows
    });

  } catch (error) {
    console.error('Dashboard fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

module.exports = router;
