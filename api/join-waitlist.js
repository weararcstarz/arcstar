const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

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

    const { name, email } = req.body;

    // Basic validation
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ status: 'error', message: 'Name must be at least 2 characters long' });
    }

    if (!email || !email.includes('@')) {
      return res.status(400).json({ status: 'error', message: 'Please enter a valid email address' });
    }

    // Check environment variables
    const EMAIL_USER = process.env.EMAIL_USER || 'weararcstarz@gmail.com';
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
      await transporter.sendMail({
        from: EMAIL_USER,
        to: email,
        subject: 'Welcome to ARCSTARZ Waitlist!',
        text: `Welcome ${name}! Thanks for joining our waitlist.`,
      });

      await transporter.sendMail({
        from: EMAIL_USER,
        to: EMAIL_USER,
        subject: 'New Waitlist Signup',
        text: `New signup: ${name} (${email})`,
      });
    } catch (emailError) {
      console.log('Email error:', emailError.message);
      // Continue even if email fails
    }

    // Save to waitlist file
    const waitlistFile = path.join(process.cwd(), 'waitlist.json');
    let waitlistData = [];
    
    try {
      if (fs.existsSync(waitlistFile)) {
        const data = fs.readFileSync(waitlistFile, 'utf8');
        waitlistData = JSON.parse(data);
      }
    } catch (fileError) {
      console.log('File read error:', fileError.message);
    }

    // Check for duplicate
    if (waitlistData.find(entry => entry.email === email)) {
      return res.status(409).json({ status: 'error', message: 'This email is already on the waitlist' });
    }

    // Add new entry
    waitlistData.push({
      id: Date.now(),
      name: name.trim(),
      email: email.trim(),
      timestamp: new Date().toISOString(),
    });

    // Save file
    try {
      fs.writeFileSync(waitlistFile, JSON.stringify(waitlistData, null, 2));
    } catch (fileError) {
      console.log('File write error:', fileError.message);
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
