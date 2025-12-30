const express = require('express');
const pool = require('../lib/db');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');
const { convertKeysToCamelCase } = require('../lib/utils');

const router = express.Router();

router.get('/domains', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, description 
      FROM domains 
      ORDER BY name
    `);
    
    res.json({ domains: convertKeysToCamelCase(result.rows) });
  } catch (error) {
    console.error('Domains fetch error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      res.status(503).json({ error: 'Database connection failed. Please try again later.' });
    } else {
      res.status(500).json({ error: 'Failed to fetch domains' });
    }
  }
});

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.role, u.name, u.student_id, u.domain_id, u.created_at,
             d.name as domain_name
      FROM users u
      LEFT JOIN domains d ON u.domain_id = d.id
      WHERE u.id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: convertKeysToCamelCase(result.rows[0]) });
  } catch (error) {
    console.error('Profile fetch error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      res.status(503).json({ error: 'Database connection failed. Please try again later.' });
    } else {
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  }
});

router.get('/stats', authenticateToken, async (req, res) => {
  try {
    let statsQuery;

    if (req.user.role === 'student') {
      statsQuery = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
        FROM complaints 
        WHERE student_id = $1
      `, [req.user.id]);
    } else if (req.user.role === 'sub_admin') {
      statsQuery = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
        FROM complaints 
        WHERE domain_id = $1
      `, [req.user.domain_id]);
    } else {
      statsQuery = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
        FROM complaints
      `);
    }

    res.json({ stats: convertKeysToCamelCase(statsQuery.rows[0]) });
  } catch (error) {
    console.error('Stats fetch error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      res.status(503).json({ error: 'Database connection failed. Please try again later.' });
    } else {
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  }
});

module.exports = router;
