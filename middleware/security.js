const xss = require('xss');

/**
 * Sanitize string to prevent XSS attacks
 * @param {string} input - Input string to sanitize
 * @returns {string} - Sanitized string
 */
const sanitizeInput = (input) => {
  if (typeof input !== 'string') {
    return input;
  }
  
  // Use xss library with custom options
  return xss(input, {
    whiteList: {}, // No HTML tags allowed
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style']
  });
};

/**
 * Recursively sanitize object to prevent XSS
 * @param {any} obj - Object to sanitize
 * @returns {any} - Sanitized object
 */
const sanitizeObject = (obj) => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  }

  return obj;
};

/**
 * Middleware to sanitize all request inputs
 */
const sanitizeRequestInputs = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  
  next();
};

/**
 * Validate SQL injection patterns in string
 * @param {string} input - Input to check
 * @returns {boolean} - True if potentially dangerous
 */
const containsSQLInjection = (input) => {
  if (typeof input !== 'string') {
    return false;
  }

  // Common SQL injection patterns
  const sqlPatterns = [
    /(\bOR\b|\bAND\b).*[=<>]/i,
    /UNION.*SELECT/i,
    /INSERT\s+INTO/i,
    /DELETE\s+FROM/i,
    /DROP\s+(TABLE|DATABASE)/i,
    /UPDATE\s+\w+\s+SET/i,
    /--\s*$/,
    /\/\*.*\*\//,
    /;\s*(DROP|DELETE|INSERT|UPDATE|SELECT)/i,
    /'\s*(OR|AND)\s*'?\d/i,
    /'\s*=\s*'/i,
    /exec\s*\(/i,
    /script\s*>/i
  ];

  return sqlPatterns.some(pattern => pattern.test(input));
};

/**
 * Middleware to detect potential SQL injection attempts
 */
const detectSQLInjection = (req, res, next) => {
  const checkObject = (obj, path = '') => {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        const currentPath = path ? `${path}.${key}` : key;
        
        if (typeof value === 'string' && containsSQLInjection(value)) {
          console.warn(`Potential SQL injection detected in ${currentPath}: ${value}`);
          return res.status(400).json({ 
            error: 'Invalid input detected',
            field: currentPath 
          });
        }
        
        if (typeof value === 'object' && value !== null) {
          const result = checkObject(value, currentPath);
          if (result) return result;
        }
      }
    }
  };

  if (req.body) {
    const result = checkObject(req.body, 'body');
    if (result) return result;
  }
  
  if (req.query) {
    const result = checkObject(req.query, 'query');
    if (result) return result;
  }
  
  if (req.params) {
    const result = checkObject(req.params, 'params');
    if (result) return result;
  }
  
  next();
};

/**
 * Validate and sanitize numeric IDs
 * @param {string} id - ID to validate
 * @returns {number|null} - Parsed ID or null
 */
const validateId = (id) => {
  const parsed = parseInt(id, 10);
  if (isNaN(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
};

/**
 * Middleware to log suspicious activities
 */
const logSuspiciousActivity = (req, type, details) => {
  console.warn(`[SECURITY] ${type}:`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    details,
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  sanitizeInput,
  sanitizeObject,
  sanitizeRequestInputs,
  detectSQLInjection,
  containsSQLInjection,
  validateId,
  logSuspiciousActivity
};
