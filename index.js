// Express with proper static file serving
const express = require('express');
const path = require('path');

const app = express();

// Serve static files first (CSS, JS, images)
app.use(express.static('.', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
    if (filePath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    }
  }
}));

// Handle HTML routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'join-waitlist.html'));
});

app.get('/join-waitlist', (req, res) => {
  res.sendFile(path.join(__dirname, 'join-waitlist.html'));
});

app.get('/waitlist', (req, res) => {
  res.sendFile(path.join(__dirname, 'waitlist.html'));
});

module.exports = app;
