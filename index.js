// Vercel entrypoint - this satisfies the entrypoint requirement
// The actual functionality is in the API routes

module.exports = function handler(req, res) {
  res.status(200).json({ 
    status: 'ok',
    message: 'ARCSTARZ Waitlist API',
    note: 'Use /api/join-waitlist for the waitlist API'
  });
};
