const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Environment variables - Gmail SMTP
const EMAIL_USER = process.env.EMAIL_USER || 'weararcstarz@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS;
const SMTP_SERVER = process.env.SMTP_SERVER || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');

// Waitlist data file path
const WAITLIST_FILE = path.join(process.cwd(), 'waitlist.json');

// Input validation
function validateInput(name, email) {
  if (!name || name.trim().length < 2) {
    return { isValid: false, message: 'Name must be at least 2 characters long' };
  }
  
  if (!email || !email.includes('@') || !email.includes('.')) {
    return { isValid: false, message: 'Please enter a valid email address' };
  }
  
  return { isValid: true };
}

// Sanitize input
function sanitizeInput(input) {
  if (!input) return '';
  return input.trim().replace(/[<>]/g, '');
}

// Read existing waitlist data
function readWaitlistData() {
  try {
    if (fs.existsSync(WAITLIST_FILE)) {
      const data = fs.readFileSync(WAITLIST_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Error reading waitlist data:', error);
    return [];
  }
}

// Save waitlist data
function saveWaitlistData(data) {
  try {
    fs.writeFileSync(WAITLIST_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving waitlist data:', error);
    throw error;
  }
}

// Create email transporter
function createTransporter() {
  return nodemailer.createTransport({
    host: SMTP_SERVER,
    port: SMTP_PORT,
    secure: false, // STARTTLS
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

// Send user email
async function sendUserEmail(name, email) {
  const transporter = createTransporter();
  
  const mailOptions = {
    from: EMAIL_USER,
    to: email,
    subject: 'Welcome to ARCSTARZ Waitlist!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #000; margin-bottom: 20px;">Welcome to ARCSTARZ, ${name}!</h2>
        <p style="color: #333; line-height: 1.6;">
          Thank you for joining our waitlist! We're excited to bring you premium fashion that combines timeless elegance with contemporary design.
        </p>
        <p style="color: #333; line-height: 1.6;">
          You'll be among the first to know when we launch. Keep an eye on your inbox for exclusive updates and early access opportunities.
        </p>
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 14px;">
            Best regards,<br>
            The ARCSTARZ Team<br>
            <em>Faith in Motion</em>
          </p>
        </div>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
}

// Send admin email
async function sendAdminEmail(name, email) {
  const transporter = createTransporter();
  
  const mailOptions = {
    from: EMAIL_USER,
    to: EMAIL_USER,
    subject: 'New Waitlist Signup - ARCSTARZ',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #000; margin-bottom: 20px;">New Waitlist Signup</h2>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <p style="margin: 5px 0;"><strong>Name:</strong> ${name}</p>
          <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date().toLocaleString()}</p>
        </div>
        <p style="color: #333; line-height: 1.6;">
          A new person has joined the ARCSTARZ waitlist! They're excited about your upcoming launch.
        </p>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
}

// Main handler function
module.exports = async function handler(req, res) {
  // Add request logging for debugging
  console.log('API Request received:', {
    method: req.method,
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });

  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      console.log('Handling preflight request');
      return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
      console.log('Method not allowed:', req.method);
      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const { name, email } = req.body;
    console.log('Form data received:', { name, email });

    // Validate input
    const validation = validateInput(name || '', email || '');
    if (!validation.isValid) {
      console.log('Validation failed:', validation.message);
      return res.status(400).json({ status: 'error', message: validation.message });
    }

    // Sanitize input
    const sanitizedName = sanitizeInput(name);
    const sanitizedEmail = sanitizeInput(email);
    console.log('Sanitized data:', { name: sanitizedName, email: sanitizedEmail });

    // Check if email already exists
    const waitlistData = readWaitlistData();
    const existingEntry = waitlistData.find((entry) => entry.email === sanitizedEmail);
    if (existingEntry) {
      return res.status(409).json({ status: 'error', message: 'This email is already on the waitlist' });
    }

    // Create email transporter
    console.log('Environment variables check:', {
      EMAIL_USER: EMAIL_USER,
      EMAIL_PASS: EMAIL_PASS ? '***SET***' : 'NOT_SET',
      SMTP_SERVER: SMTP_SERVER,
      SMTP_PORT: SMTP_PORT
    });
    
    if (!EMAIL_PASS) {
      console.log('Email service not configured - EMAIL_PASS missing');
      return res.status(500).json({ status: 'error', message: 'Email service not configured' });
    }

    // Send emails
    console.log('Sending emails...');
    await Promise.all([
      sendUserEmail(sanitizedName, sanitizedEmail),
      sendAdminEmail(sanitizedName, sanitizedEmail),
    ]);

    // Save to waitlist
    const newEntry = {
      id: Date.now(),
      name: sanitizedName,
      email: sanitizedEmail,
      timestamp: new Date().toISOString(),
    };

    waitlistData.push(newEntry);
    saveWaitlistData(waitlistData);

    console.log('Waitlist entry saved:', newEntry);

    // Return success response
    return res.status(200).json({ status: 'success', message: 'Successfully joined waitlist' });

  } catch (error: any) {
    console.error('Waitlist signup error:', error);
    
    // Provide specific error messages based on error type
    let errorMessage = 'Internal server error';
    
    if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed. Please check SMTP credentials.';
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Could not connect to email server. Please try again later.';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Email server not found. Please check SMTP configuration.';
    } else if (error.message && error.message.includes('self-signed certificate')) {
      errorMessage = 'Email server certificate issue. Please try again later.';
    }
    
    return res.status(500).json({
      status: 'error',
      message: errorMessage
    });
  }
};
