// Real email sending server for local testing
const nodemailer = require('nodemailer');
const http = require('http');
const fs = require('fs');
const path = require('path');

// SMTP Configuration - Gmail
const EMAIL_USER = process.env.EMAIL_USER || 'weararcstarz@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'zobbgmgvkkflgmrs';
const SMTP_SERVER = process.env.SMTP_SERVER || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');

// Create email transporter
const transporter = nodemailer.createTransport({
  host: SMTP_SERVER,
  port: SMTP_PORT,
  secure: false, // STARTTLS for Gmail
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2'
  },
  connectionTimeout: 60000,
  greetingTimeout: 30000,
  socketTimeout: 60000,
});

// Waitlist data file path
const WAITLIST_FILE = path.join(__dirname, '..', 'waitlist.json');

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
    console.log('Waitlist data saved successfully');
  } catch (error) {
    console.error('Error saving waitlist data:', error);
    throw error;
  }
}

// Send confirmation email to user
async function sendUserEmail(name, email) {
  try {
    await transporter.verify();
    console.log('SMTP connection verified successfully');
    
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

    const result = await transporter.sendMail(mailOptions);
    console.log('User email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('Error sending user email:', error);
    throw error;
  }
}

// Send notification email to admin
async function sendAdminEmail(name, email) {
  try {
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

    const result = await transporter.sendMail(mailOptions);
    console.log('Admin email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('Error sending admin email:', error);
    throw error;
  }
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/join-waitlist') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        console.log('Email server received:', data);
        
        // Validate input
        if (!data.name || data.name.trim().length < 2) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'error',
            message: 'Name must be at least 2 characters long'
          }));
          return;
        }
        
        if (!data.email || !data.email.includes('@')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'error',
            message: 'Please enter a valid email address'
          }));
          return;
        }

        // Check if email already exists
        const waitlistData = readWaitlistData();
        const existingEntry = waitlistData.find(entry => entry.email === data.email);
        if (existingEntry) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'error',
            message: 'This email is already on the waitlist'
          }));
          return;
        }

        // Send emails
        await Promise.all([
          sendUserEmail(data.name, data.email),
          sendAdminEmail(data.name, data.email),
        ]);

        // Save to waitlist
        const newEntry = {
          id: Date.now(),
          name: data.name.trim(),
          email: data.email.trim(),
          timestamp: new Date().toISOString(),
        };

        waitlistData.push(newEntry);
        saveWaitlistData(waitlistData);

        // Return success response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          message: 'Successfully joined waitlist! Check your email for confirmation.'
        }));
        
      } catch (error) {
        console.error('Email server error:', error);
        
        let errorMessage = 'Internal server error';
        if (error.code === 'EAUTH') {
          errorMessage = 'Email authentication failed. Please check SMTP credentials.';
        } else if (error.code === 'ECONNECTION') {
          errorMessage = 'Could not connect to email server. Please try again later.';
        }
        
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'error',
          message: errorMessage
        }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 Real Email Server running on http://localhost:${PORT}`);
  console.log(`📧 SMTP Config: ${EMAIL_USER}@${SMTP_SERVER}:${SMTP_PORT}`);
  console.log(`🎯 Test endpoint: http://localhost:3001/api/join-waitlist`);
  console.log(`📁 Waitlist data: ${WAITLIST_FILE}`);
  console.log(`\n✨ Ready to send real emails!`);
});
