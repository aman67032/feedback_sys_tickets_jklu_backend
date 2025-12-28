// Centralized database connection pool
const { Pool } = require('pg');

// For serverless environments (Vercel), use smaller pool settings
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

// Validate DATABASE_URL format
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set');
}

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  // Serverless-friendly settings
  max: isServerless ? 1 : 20, // Single connection for serverless
  idleTimeoutMillis: isServerless ? 1000 : 30000,
  connectionTimeoutMillis: isServerless ? 10000 : 2000, // Increased timeout for serverless
  // Use SSL for production databases (like Neon)
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? {
    rejectUnauthorized: false
  } : undefined
};

// Log connection attempt (without sensitive data)
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  console.log(`Attempting to connect to database: ${url.hostname}`);
}

const pool = new Pool(poolConfig);

// Handle database connection errors (don't exit in serverless)
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
  // Don't exit in serverless - just log the error
  if (!isServerless) {
    process.exit(-1);
  }
});

module.exports = pool;

