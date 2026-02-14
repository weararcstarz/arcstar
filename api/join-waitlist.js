const nodemailer = require('nodemailer');
const store = require('../lib/subscriber-store');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_IP = 12;
const requestBursts = new Map();

function getClientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers['x-real-ip'] || '').trim();
  return fwd || real || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const current = requestBursts.get(ip);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requestBursts.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_IP;
}

// Simple handler without complex error handling
module.exports = async function handler(req, res) {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      return res.status(429).json({ status: 'error', message: 'Too many requests. Please wait a minute.' });
    }

    const { name, email } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    // Basic validation
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ status: 'error', message: 'Name must be at least 2 characters long' });
    }

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return res.status(400).json({ status: 'error', message: 'Please enter a valid email address' });
    }

    let saveResult;
    try {
      saveResult = await store.addOrResubscribe(name.trim(), normalizedEmail);
    } catch (dbError) {
      console.log('Subscriber store error:', dbError.message);
      const details = String(dbError && dbError.message ? dbError.message : '').slice(0, 160);
      return res.status(500).json({
        status: 'error',
        message: details
          ? `Database error: ${details}`
          : 'Database connection error. Please verify your Postgres env vars and redeploy.',
      });
    }
    if (saveResult.status === 'invalid') {
      return res.status(400).json({ status: 'error', message: 'Please enter a valid email address' });
    }
    if (saveResult.status === 'duplicate') {
      return res.status(409).json({ status: 'error', message: 'This email is already on the waitlist' });
    }

    // Check environment variables
    const EMAIL_USER = process.env.EMAIL_USER || 'weararcstarz@gmail.com';
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || EMAIL_USER;
    const EMAIL_PASS = process.env.EMAIL_PASS;
    const SMTP_SERVER = process.env.SMTP_SERVER || 'smtp.gmail.com';
    const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');

    if (!EMAIL_PASS) {
      console.log('EMAIL_PASS not set');
      return res.status(500).json({ status: 'error', message: 'Email service not configured' });
    }

    // Simple email transporter
    const transporter = nodemailer.createTransport({
      host: SMTP_SERVER,
      port: SMTP_PORT,
      secure: false,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    });

    // Send emails (simplified)
    try {
      // Send beautiful welcome email to user
      await transporter.sendMail({
        from: EMAIL_USER,
        to: normalizedEmail,
        subject: 'Welcome to ARCSTARZ Waitlist!',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to ARCSTARZ</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #000; font-family: Arial, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #111; min-height: 100vh;">
              <div style="text-align: center; padding: 60px 20px;">
                <h1 style="color: white; font-size: 2.5rem; font-weight: 200; letter-spacing: 0.3em; margin-bottom: 20px;">2026 ARCSTARZ</h1>
                <h2 style="color: rgba(255, 255, 255, 0.9); font-size: 1.2rem; font-weight: 300; margin-bottom: 40px;">Welcome to the Waitlist, ${name}!</h2>
                
                <div style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 8px; padding: 30px; margin: 30px 0; backdrop-filter: blur(10px);">
                  <p style="color: white; font-size: 1.1rem; line-height: 1.6; margin: 0 0 20px 0;">
                    Thank you for joining our exclusive waitlist! You're now part of the ARCSTARZ community.
                  </p>
                  <p style="color: rgba(255, 255, 255, 0.8); font-size: 1rem; line-height: 1.6; margin: 0 0 20px 0;">
                    We're crafting premium fashion that combines timeless elegance with contemporary design. You'll be among the first to know when we launch.
                  </p>
                  <div style="margin: 30px 0;">
                    <div style="display: inline-block; background: white; color: black; padding: 12px 24px; border-radius: 4px; font-weight: 500; text-decoration: none;">
                      Coming Soon
                    </div>
                  </div>
                </div>
                
                <div style="margin-top: 40px;">
                  <p style="color: rgba(255, 255, 255, 0.6); font-size: 0.9rem; margin: 10px 0;">
                    Follow us for updates:
                  </p>
                  <div style="display: flex; justify-content: center; gap: 20px; margin: 20px 0;">
                    <a href="https://instagram.com/arcstarzke" style="color: rgba(255, 255, 255, 0.8); text-decoration: none;">Instagram</a>
                    <a href="https://tiktok.com/@arcstarzke" style="color: rgba(255, 255, 255, 0.8); text-decoration: none;">TikTok</a>
                  </div>
                </div>
                
                <div style="margin-top: 60px; padding-top: 30px; border-top: 1px solid rgba(255, 255, 255, 0.2);">
                  <p style="color: rgba(255, 255, 255, 0.6); font-size: 0.8rem; margin: 5px 0;">
                    Best regards,<br>
                    The ARCSTARZ Team
                  </p>
                  <p style="color: rgba(255, 255, 255, 0.4); font-size: 0.8rem; font-style: italic; margin: 5px 0;">
                    Faith in Motion
                  </p>
                </div>
              </div>
            </div>
          </body>
          </html>
        `,
      });

      // Send notification email to admin
      await transporter.sendMail({
        from: EMAIL_USER,
        to: ADMIN_EMAIL,
        subject: '🎉 New Waitlist Signup - ARCSTARZ',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Waitlist Signup</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
            <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden;">
              <div style="background: linear-gradient(135deg, #000 0%, #222 100%); color: white; padding: 30px; text-align: center;">
                <h1 style="margin: 0; font-size: 2rem; font-weight: 200; letter-spacing: 0.2em;">ARCSTARZ</h1>
                <p style="margin: 10px 0 0 0; opacity: 0.9;">New Waitlist Signup</p>
              </div>
              
              <div style="padding: 30px;">
                <div style="background: #f8f9fa; border-radius: 6px; padding: 20px; margin-bottom: 25px;">
                  <h3 style="margin: 0 0 15px 0; color: #333; font-size: 1.1rem;">📋 New Member Details</h3>
                  <div style="display: grid; grid-template-columns: 120px 1fr; gap: 10px;">
                    <div style="color: #666; font-size: 0.9rem;"><strong>Name:</strong></div>
                    <div style="color: #333; font-size: 1rem;">${name}</div>
                    
                    <div style="color: #666; font-size: 0.9rem;"><strong>Email:</strong></div>
                    <div style="color: #333; font-size: 1rem;">${email}</div>
                    
                    <div style="color: #666; font-size: 0.9rem;"><strong>Date:</strong></div>
                    <div style="color: #333; font-size: 1rem;">${new Date().toLocaleString()}</div>
                  </div>
                </div>
                
                <div style="background: #e8f5e8; border-left: 4px solid #28a745; padding: 15px; border-radius: 4px;">
                  <p style="margin: 0; color: #155724; font-size: 1rem;">
                    🎉 Congratulations! Another person has joined the ARCSTARZ waitlist. They're excited about your upcoming launch!
                  </p>
                </div>
                
                <div style="margin-top: 25px; text-align: center;">
                  <a href="https://instagram.com/arcstarzke" style="display: inline-block; margin: 0 10px; color: #666; text-decoration: none;">
                    <span style="font-size: 0.9rem;">📷 Instagram</span>
                  </a>
                  <a href="https://tiktok.com/@arcstarzke" style="display: inline-block; margin: 0 10px; color: #666; text-decoration: none;">
                    <span style="font-size: 0.9rem;">🎵 TikTok</span>
                  </a>
                </div>
              </div>
            </div>
          </body>
          </html>
        `,
      });
    } catch (emailError) {
      console.log('Email error:', emailError.message);
      // Continue even if email fails
    }

    // Return success
    return res.status(200).json({ 
      status: 'success', 
      message: 'Successfully joined waitlist!' 
    });

  } catch (error) {
    console.log('General error:', error.message);
    return res.status(500).json({ 
      status: 'error', 
      message: 'Internal server error' 
    });
  }
};
