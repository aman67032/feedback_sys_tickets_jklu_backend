// Centralized database connection pool
const { Pool } = require('pg');

// For serverless environments (Vercel), use smaller pool settings
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  // Serverless-friendly settings
  max: isServerless ? 1 : 20, // Single connection for serverless
  idleTimeoutMillis: isServerless ? 1000 : 30000,
  connectionTimeoutMillis: isServerless ? 5000 : 2000,
  // Use SSL for production databases (like Neon)
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? {
    rejectUnauthorized: false
  } : undefined
};

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

