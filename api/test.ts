import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Test API endpoint called');
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const response = {
      status: 'success',
      message: 'API is working!',
      timestamp: new Date().toISOString(),
      method: req.method,
      environment: {
        EMAIL_USER: process.env.EMAIL_USER || 'not_set',
        EMAIL_PASS: process.env.EMAIL_PASS ? 'set' : 'not_set',
        SMTP_SERVER: process.env.SMTP_SERVER || 'not_set',
        SMTP_PORT: process.env.SMTP_PORT || 'not_set'
      }
    };

    console.log('Test response:', response);
    return res.status(200).json(response);
  } catch (error) {
    console.error('Test API error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Test API failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
