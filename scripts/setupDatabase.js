const { Pool } = require('pg');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function setupDatabase() {
  try {
    console.log('Setting up database...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS domains (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      INSERT INTO domains (name, description) VALUES 
        ('Hostel', 'Hostel related complaints'),
        ('IET', 'Institute of Engineering and Technology'),
        ('IM', 'Institute of Management'),
        ('Design', 'Design School complaints'),
        ('Council', 'Student Council matters'),
        ('VC Office', 'Vice Chancellor Office')
      ON CONFLICT (name) DO NOTHING;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'sub_admin', 'super_admin')),
        name VARCHAR(255) NOT NULL,
        student_id VARCHAR(50),
        domain_id INTEGER REFERENCES domains(id),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS complaints (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        domain_id INTEGER REFERENCES domains(id) NOT NULL,
        student_id INTEGER REFERENCES users(id) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'rejected')),
        priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        assigned_to INTEGER REFERENCES users(id),
        resolution_details TEXT,
        resolved_at TIMESTAMP,
        admin_read_at TIMESTAMP,
        admin_seen BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add missing columns if table already exists (migration support)
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='complaints' AND column_name IN ('admin_seen', 'admin_read_at')
    `);
    
    const existingColumns = columnCheck.rows.map(row => row.column_name);
    
    if (!existingColumns.includes('admin_seen')) {
      console.log('Adding admin_seen column to existing complaints table...');
      await pool.query(`
        ALTER TABLE complaints 
        ADD COLUMN admin_seen BOOLEAN DEFAULT false
      `);
    }
    
    if (!existingColumns.includes('admin_read_at')) {
      console.log('Adding admin_read_at column to existing complaints table...');
      await pool.query(`
        ALTER TABLE complaints 
        ADD COLUMN admin_read_at TIMESTAMP
      `);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS complaint_transfers (
        id SERIAL PRIMARY KEY,
        complaint_id INTEGER REFERENCES complaints(id) ON DELETE CASCADE,
        from_domain_id INTEGER REFERENCES domains(id),
        to_domain_id INTEGER REFERENCES domains(id),
        transferred_by INTEGER REFERENCES users(id),
        transfer_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action VARCHAR(100) NOT NULL,
        resource_type VARCHAR(50) NOT NULL,
        resource_id INTEGER,
        old_values JSONB,
        new_values JSONB,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS complaint_attachments (
        id SERIAL PRIMARY KEY,
        complaint_id INTEGER REFERENCES complaints(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const superAdminEmail = 'admin@jklu.edu.in';
    const superAdminPassword = await bcrypt.hash('Admin@123', 12);
    
    await pool.query(`
      INSERT INTO users (email, password_hash, role, name) 
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, [superAdminEmail, superAdminPassword, 'super_admin', 'Super Admin']);

    console.log('Database setup completed successfully!');
    console.log(`Super admin created: ${superAdminEmail} / Admin@123`);
    
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
