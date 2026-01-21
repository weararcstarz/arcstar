// Vercel server entrypoint with Express
const express = require('express');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    message: 'ARCSTARZ Waitlist API Server',
    endpoints: {
      waitlist: '/api/join-waitlist'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Export for Vercel
module.exports = app;
