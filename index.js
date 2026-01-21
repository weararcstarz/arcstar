// Vercel entrypoint with Express
const express = require('express');
const path = require('path');

const app = express();

// Middleware for static files with proper MIME types
app.use(express.static('.', {
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

app.use(express.json());

// Root endpoint - serve HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'join-waitlist.html'));
});

// Other routes
app.get('/join-waitlist', (req, res) => {
  res.sendFile(path.join(__dirname, 'join-waitlist.html'));
});

app.get('/waitlist', (req, res) => {
  res.sendFile(path.join(__dirname, 'waitlist.html'));
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
