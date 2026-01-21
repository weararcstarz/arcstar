// Vercel entrypoint with Express
const express = require('express');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'join-waitlist.html'));
});

// API info
app.get('/api', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    message: 'ARCSTARZ Waitlist API',
    note: 'Use /api/join-waitlist for the waitlist API'
  });
});

// Export for Vercel
module.exports = app;
