// Vercel server entrypoint with Express
const express = require('express');
const path = require('path');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('.'));

// API Routes
app.get('/api', (req, res) => {
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

// Serve HTML files for specific routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'join-waitlist.html'));
});

app.get('/join-waitlist', (req, res) => {
  res.sendFile(path.join(__dirname, 'join-waitlist.html'));
});

app.get('/waitlist', (req, res) => {
  res.sendFile(path.join(__dirname, 'waitlist.html'));
});

app.get('/index', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Export for Vercel
module.exports = app;
