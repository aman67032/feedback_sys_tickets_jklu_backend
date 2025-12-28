const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrateDatabase() {
  try {
    console.log('Running database migrations...');

    // Check if admin_seen column exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='complaints' AND column_name='admin_seen'
    `);

    if (columnCheck.rows.length === 0) {
      console.log('Adding admin_seen column to complaints table...');
      await pool.query(`
        ALTER TABLE complaints 
        ADD COLUMN admin_seen BOOLEAN DEFAULT false
      `);
      console.log('✓ admin_seen column added successfully');
    } else {
      console.log('✓ admin_seen column already exists');
    }

    // Check if admin_read_at column exists
    const readAtCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='complaints' AND column_name='admin_read_at'
    `);

    if (readAtCheck.rows.length === 0) {
      console.log('Adding admin_read_at column to complaints table...');
      await pool.query(`
        ALTER TABLE complaints 
        ADD COLUMN admin_read_at TIMESTAMP
      `);
      console.log('✓ admin_read_at column added successfully');
    } else {
      console.log('✓ admin_read_at column already exists');
    }

    // Update existing rows to have admin_seen = false if NULL
    await pool.query(`
      UPDATE complaints 
      SET admin_seen = false 
      WHERE admin_seen IS NULL
    `);

    console.log('Database migration completed successfully!');
    
  } catch (error) {
    console.error('Database migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrateDatabase();

