// Vercel serverless function entry point
const app = require('../server');

// Export the Express app directly for Vercel
// Vercel will automatically handle the request/response
module.exports = app;

