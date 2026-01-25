// Express with proper static file serving
const express = require('express');
const path = require('path');

const app = express();

// Serve static files from public folder (Express handles MIME types automatically)
app.use(express.static(path.join(__dirname, 'public')));

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
