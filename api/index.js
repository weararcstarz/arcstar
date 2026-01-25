// Vercel serverless functions entrypoint
// This file exists to satisfy Vercel's entrypoint requirements
// The actual API logic is in join-waitlist.js

module.exports = function handler(req, res) {
  // This is just a placeholder - actual routes are handled by join-waitlist.js
  res.status(404).json({ 
    error: 'Not Found',
    message: 'This is a placeholder. Use /api/join-waitlist for the waitlist API.'
  });
};
