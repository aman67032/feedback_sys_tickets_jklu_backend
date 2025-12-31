const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const hpp = require('hpp');
const mongoSanitize = require('express-mongo-sanitize');
const { sanitizeRequestInputs, detectSQLInjection } = require('./middleware/security');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy - required for rate limiting behind proxies (Vercel, etc.)
// Set to 1 to trust only the first proxy (Vercel's edge), not all proxies
app.set('trust proxy', 1);

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

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Enhanced Helmet configuration for better security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
}));

// CORS with stricter configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : (process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : ['http://localhost:3000']);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600 // 10 minutes
}));

app.use(limiter);

// Protect against HTTP Parameter Pollution attacks
app.use(hpp());

// Data sanitization against NoSQL query injection
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.warn(`Sanitized NoSQL injection attempt in key: ${key}`);
  },
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply XSS protection and input sanitization
app.use(sanitizeRequestInputs);

// Detect SQL injection attempts
app.use(detectSQLInjection);

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

// Enhanced error handler that doesn't leak sensitive information
app.use((err, req, res, next) => {
  // Log full error for debugging (but not in production logs for security)
  if (process.env.NODE_ENV !== 'production') {
    console.error('Error details:', err.stack);
  } else {
    console.error('Error occurred:', err.message);
  }
  
  // CORS errors
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: 'CORS policy violation' });
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }
  
  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Invalid input data' });
  }
  
  // Generic error - don't leak sensitive info
  res.status(err.status || 500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'An error occurred processing your request' 
      : err.message || 'Something went wrong!'
  });
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
