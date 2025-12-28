const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Check if running in serverless environment
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

// Validate required environment variables (only exit if not serverless)
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  if (!isServerless) {
    process.exit(1);
  }
}

if (!process.env.JWT_SECRET) {
  console.error('ERROR: JWT_SECRET environment variable is required');
  if (!isServerless) {
    process.exit(1);
  }
}

app.set("trust proxy", 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : (process.env.FRONTEND_URL || 'http://localhost:3000'),
  credentials: true
}));
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const pool = require('./lib/db');

// Root endpoint for health check
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Feedback System API is running', version: '1.0.0' });
});

// Health check endpoint with database connectivity test
app.get('/api/health', async (req, res) => {
  const healthCheck = {
    status: 'OK',
    message: 'Feedback System API is running',
    timestamp: new Date().toISOString(),
    database: {
      connected: false,
      error: null
    },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      isServerless: !!isServerless
    }
  };

  // Test database connection
  try {
    const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    healthCheck.database.connected = true;
    healthCheck.database.currentTime = result.rows[0].current_time;
    healthCheck.database.pgVersion = result.rows[0].pg_version.split(' ')[0] + ' ' + result.rows[0].pg_version.split(' ')[1];
    
    // Test if tables exist
    const tablesCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'complaints', 'domains')
    `);
    healthCheck.database.tables = tablesCheck.rows.map(row => row.table_name);
    
    res.json(healthCheck);
  } catch (error) {
    healthCheck.status = 'ERROR';
    healthCheck.database.connected = false;
    healthCheck.database.error = error.message;
    
    // Provide helpful error messages for common issues
    if (error.message.includes('ENOTFOUND')) {
      healthCheck.database.suggestion = 'Database hostname not found. Check if DATABASE_URL is correct and database is active in Neon dashboard.';
    } else if (error.message.includes('timeout')) {
      healthCheck.database.suggestion = 'Connection timeout. Check if database is active and network connectivity.';
    } else if (error.message.includes('authentication')) {
      healthCheck.database.suggestion = 'Authentication failed. Verify database credentials in DATABASE_URL.';
    } else if (error.message.includes('SSL')) {
      healthCheck.database.suggestion = 'SSL connection error. Ensure DATABASE_URL includes ?sslmode=require';
    }
    
    res.status(503).json(healthCheck);
  }
});

const authRoutes = require('./routes/auth');
const complaintRoutes = require('./routes/complaints');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Only start listening if not in serverless environment
if (!isServerless) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export app for Vercel serverless functions
module.exports = app;
