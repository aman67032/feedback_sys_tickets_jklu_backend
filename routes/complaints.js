const express = require('express');
const { body, validationResult } = require('express-validator');
const { Pool } = require('pg');
const { authenticateToken, requireStudent, requireSubAdmin } = require('../middleware/auth');

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

router.post('/', authenticateToken, requireStudent, [
  body('title').trim().isLength({ min: 5, max: 255 }),
  body('description').trim().isLength({ min: 10 }),
  body('domainId').isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, description, domainId, priority = 'medium' } = req.body;

    const domainCheck = await pool.query('SELECT id FROM domains WHERE id = $1', [domainId]);
    if (domainCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid domain' });
    }

    const result = await pool.query(`
      INSERT INTO complaints (title, description, domain_id, student_id, priority)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, description, domain_id, status, priority, created_at
    `, [title, description, domainId, req.user.id, priority]);

    const complaint = result.rows[0];

    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, new_values)
      VALUES ($1, $2, $3, $4, $5)
    `, [req.user.id, 'CREATE', 'complaint', complaint.id, { title, domainId, priority }]);

    res.status(201).json({
      message: 'Complaint submitted successfully',
      complaint
    });

  } catch (error) {
    console.error('Complaint creation error:', error);
    res.status(500).json({ error: 'Failed to submit complaint' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query, params;

    if (req.user.role === 'student') {
      query = `
        SELECT c.id, c.title, c.description, c.status, c.priority, c.resolution_details,
               c.resolved_at, c.created_at, c.updated_at, c.admin_seen, c.admin_read_at,
               d.name as domain_name
        FROM complaints c
        JOIN domains d ON c.domain_id = d.id
        WHERE c.student_id = $1
        ORDER BY c.created_at DESC
      `;
      params = [req.user.id];
    } else if (req.user.role === 'sub_admin') {
      query = `
        SELECT c.id, c.title, c.description, c.status, c.priority, c.resolution_details,
               c.resolved_at, c.created_at, c.updated_at,
               d.name as domain_name
        FROM complaints c
        JOIN domains d ON c.domain_id = d.id
        WHERE c.domain_id = $1
        ORDER BY c.created_at DESC
      `;
      params = [req.user.domain_id];
    } else {
      query = `
        SELECT c.id, c.title, c.description, c.status, c.priority, c.resolution_details,
               c.resolved_at, c.created_at, c.updated_at,
               d.name as domain_name,
               u.name as student_name, u.email as student_email, u.student_id
        FROM complaints c
        JOIN domains d ON c.domain_id = d.id
        JOIN users u ON c.student_id = u.id
        ORDER BY c.created_at DESC
      `;
      params = [];
    }

    const result = await pool.query(query, params);
    res.json({ complaints: result.rows });

  } catch (error) {
    console.error('Complaint fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
});

router.get('/public', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.title, c.resolution_details, c.resolved_at,
             d.name as domain_name
      FROM complaints c
      JOIN domains d ON c.domain_id = d.id
      WHERE c.status = 'resolved'
      ORDER BY c.resolved_at DESC
      LIMIT 50
    `);

    res.json({ complaints: result.rows });

  } catch (error) {
    console.error('Public complaints fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch public complaints' });
  }
});

router.put('/:id', authenticateToken, requireSubAdmin, [
  body('status').isIn(['pending', 'in_progress', 'resolved', 'rejected']),
  body('resolutionDetails').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { status, resolutionDetails } = req.body;

    let complaintQuery;
    if (req.user.role === 'sub_admin') {
      complaintQuery = await pool.query(`
        SELECT id, status, domain_id FROM complaints 
        WHERE id = $1 AND domain_id = $2
      `, [id, req.user.domain_id]);
    } else {
      complaintQuery = await pool.query(`
        SELECT id, status, domain_id FROM complaints WHERE id = $1
      `, [id]);
    }

    if (complaintQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const oldStatus = complaintQuery.rows[0].status;
    const updateFields = ['status = $1', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [status];
    let paramIndex = 2;

    if (resolutionDetails && status === 'resolved') {
      updateFields.push(`resolution_details = $${paramIndex}`);
      params.push(resolutionDetails);
      paramIndex++;
      updateFields.push(`resolved_at = CURRENT_TIMESTAMP`);
    }

    params.push(id);

    await pool.query(`
      UPDATE complaints 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
    `, params);

    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, old_values, new_values)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [req.user.id, 'UPDATE', 'complaint', id, { status: oldStatus }, { status, resolutionDetails }]);

    res.json({ message: 'Complaint updated successfully' });

  } catch (error) {
    console.error('Complaint update error:', error);
    res.status(500).json({ error: 'Failed to update complaint' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    let query;
    let result;
    if (req.user.role === 'student') {
      query = `
        SELECT c.id, c.title, c.description, c.status, c.priority, c.resolution_details,
               c.resolved_at, c.created_at, c.updated_at,
               d.name as domain_name
        FROM complaints c
        JOIN domains d ON c.domain_id = d.id
        WHERE c.id = $1 AND c.student_id = $2
      `;
      result = await pool.query(query, [id, req.user.id]);
    } else if (req.user.role === 'sub_admin') {
      query = `
        SELECT c.id, c.title, c.description, c.status, c.priority, c.resolution_details,
               c.resolved_at, c.created_at, c.updated_at,
               d.name as domain_name
        FROM complaints c
        JOIN domains d ON c.domain_id = d.id
        WHERE c.id = $1 AND c.domain_id = $2
      `;
      result = await pool.query(query, [id, req.user.domain_id]);
    } else {
      query = `
        SELECT c.id, c.title, c.description, c.status, c.priority, c.resolution_details,
               c.resolved_at, c.created_at, c.updated_at,
               d.name as domain_name,
               u.name as student_name, u.email as student_email, u.student_id
        FROM complaints c
        JOIN domains d ON c.domain_id = d.id
        JOIN users u ON c.student_id = u.id
        WHERE c.id = $1
      `;
      result = await pool.query(query, [id]);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    res.json({ complaint: result.rows[0] });

  } catch (error) {
    console.error('Complaint fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch complaint' });
  }
});

router.put('/:id/mark-seen', authenticateToken, requireSubAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    let complaintQuery;
    if (req.user.role === 'sub_admin') {
      complaintQuery = await pool.query(`
        SELECT id, admin_seen FROM complaints 
        WHERE id = $1 AND domain_id = $2
      `, [id, req.user.domain_id]);
    } else {
      complaintQuery = await pool.query(`
        SELECT id, admin_seen FROM complaints WHERE id = $1
      `, [id]);
    }

    if (complaintQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    await pool.query(`
      UPDATE complaints 
      SET admin_seen = true, admin_read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);

    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, new_values)
      VALUES ($1, $2, $3, $4, $5)
    `, [req.user.id, 'MARK_SEEN', 'complaint', id, { admin_seen: true }]);

    res.json({ message: 'Complaint marked as seen' });

  } catch (error) {
    console.error('Mark seen error:', error);
    res.status(500).json({ error: 'Failed to mark complaint as seen' });
  }
});

router.post('/:id/transfer', authenticateToken, requireSubAdmin, [
  body('toDomainId').isInt(),
  body('reason').trim().isLength({ min: 5 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { toDomainId, reason } = req.body;

    const complaintQuery = await pool.query(`
      SELECT c.id, c.domain_id, d.name as current_domain
      FROM complaints c
      JOIN domains d ON c.domain_id = d.id
      WHERE c.id = $1
    `, [id]);

    if (complaintQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const currentDomainId = complaintQuery.rows[0].domain_id;
    
    if (currentDomainId === toDomainId) {
      return res.status(400).json({ error: 'Cannot transfer to the same domain' });
    }

    await pool.query(`
      UPDATE complaints 
      SET domain_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [toDomainId, id]);

    await pool.query(`
      INSERT INTO complaint_transfers (complaint_id, from_domain_id, to_domain_id, transferred_by, transfer_reason)
      VALUES ($1, $2, $3, $4, $5)
    `, [id, currentDomainId, toDomainId, req.user.id, reason]);

    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, old_values, new_values)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [req.user.id, 'TRANSFER', 'complaint', id, 
        { domain_id: currentDomainId }, 
        { domain_id: toDomainId, transfer_reason: reason }]);

    res.json({ message: 'Complaint transferred successfully' });

  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ error: 'Failed to transfer complaint' });
  }
});

module.exports = router;
