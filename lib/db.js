// Centralized database connection pool
const { Pool } = require('pg');

// For serverless environments (Vercel), use smaller pool settings
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

// Validate DATABASE_URL format
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set');
}

// Parse DATABASE_URL to determine SSL requirements
let sslConfig = undefined;
if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);
    // Check if SSL is required in the connection string
    if (url.searchParams.get('sslmode') === 'require' || 
        url.searchParams.get('sslmode') === 'prefer' ||
        process.env.DATABASE_URL.includes('sslmode=require') ||
        process.env.DATABASE_URL.includes('sslmode=prefer')) {
      sslConfig = {
        rejectUnauthorized: false // Required for cloud databases like Neon, Supabase
      };
    }
  } catch (error) {
    console.warn('Could not parse DATABASE_URL for SSL config:', error.message);
    // Default to SSL if URL contains sslmode
    if (process.env.DATABASE_URL.includes('sslmode=require') || 
        process.env.DATABASE_URL.includes('sslmode=prefer')) {
      sslConfig = {
        rejectUnauthorized: false
      };
    }
  }
}

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  // Serverless-friendly settings
  max: isServerless ? 1 : 20, // Single connection for serverless
  idleTimeoutMillis: isServerless ? 1000 : 30000,
  connectionTimeoutMillis: isServerless ? 10000 : 2000, // Increased timeout for serverless
  // Use SSL for production databases (like Neon, Supabase)
  ssl: sslConfig
};

// Log connection attempt (without sensitive data)
if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);
    console.log(`Attempting to connect to database: ${url.hostname} (SSL: ${sslConfig ? 'enabled' : 'disabled'})`);
  } catch (error) {
    console.log('Database connection configured');
  }
}

const pool = new Pool(poolConfig);

// Test connection on startup (only in non-serverless environments)
if (!isServerless) {
  pool.query('SELECT NOW()')
    .then(() => {
      console.log('✓ Database connection established successfully');
    })
    .catch((err) => {
      console.error('✗ Database connection failed:', err.message);
      console.error('Please check your DATABASE_URL and ensure the database is accessible');
    });
}

// Handle database connection errors (don't exit in serverless)
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err.message);
  // Don't exit in serverless - just log the error
  if (!isServerless) {
    console.error('Exiting process due to database connection error');
    process.exit(-1);
  }
});

// Helper function to test database connection
pool.testConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    return { connected: true, time: result.rows[0].current_time };
  } catch (error) {
    return { connected: false, error: error.message };
  }
};

module.exports = pool;

