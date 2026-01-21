// Vercel server entrypoint
// This file satisfies Vercel's entrypoint requirements

module.exports = function handler(req, res) {
  res.status(200).json({ 
    status: 'ok',
    message: 'ARCSTARZ Waitlist API Server',
    endpoints: {
      waitlist: '/api/join-waitlist'
    }
  });
};
