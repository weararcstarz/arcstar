// Minimal Express to satisfy Vercel requirement
const express = require('express');

const app = express();

// Very simple - let Vercel handle static files
app.get('/', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'join-waitlist.html'));
});

module.exports = app;
