import { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

// Environment variables
const EMAIL_USER = 'support@arcstarz.shop';
const EMAIL_PASS = process.env.EMAIL_PASS;
const SMTP_SERVER = 'mail.privateemail.com';
const SMTP_PORT = 587;

// Waitlist data file path
const WAITLIST_FILE = path.join(process.cwd(), 'waitlist.json');

// Input validation
function validateInput(name: string, email: string): { isValid: boolean; message?: string } {
  if (!name || name.trim().length < 2) {
    return { isValid: false, message: 'Name must be at least 2 characters long' };
  }
  
  if (!email || email.trim().length === 0) {
    return { isValid: false, message: 'Email is required' };
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, message: 'Please enter a valid email address' };
  }
  
  return { isValid: true };
}

// Sanitize input
function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, '');
}

// Read existing waitlist data
function readWaitlistData(): any[] {
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
function saveWaitlistData(data: any[]): void {
  try {
    fs.writeFileSync(WAITLIST_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving waitlist data:', error);
    throw error;
  }
}

// Create email transporter
function createTransporter() {
  return nodemailer.createTransporter({
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

// Send confirmation email to user
async function sendUserEmail(transporter: any, name: string, email: string) {
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

  await transporter.sendMail(mailOptions);
}

// Send notification email to admin
async function sendAdminEmail(transporter: any, name: string, email: string) {
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

  await transporter.sendMail(mailOptions);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const { name, email } = req.body;

    // Validate input
    const validation = validateInput(name || '', email || '');
    if (!validation.isValid) {
      return res.status(400).json({ status: 'error', message: validation.message });
    }

    // Sanitize input
    const sanitizedName = sanitizeInput(name);
    const sanitizedEmail = sanitizeInput(email);

    // Check if email already exists
    const waitlistData = readWaitlistData();
    const existingEntry = waitlistData.find((entry: any) => entry.email === sanitizedEmail);
    if (existingEntry) {
      return res.status(409).json({ status: 'error', message: 'This email is already on the waitlist' });
    }

    // Create email transporter
    if (!EMAIL_PASS) {
      return res.status(500).json({ status: 'error', message: 'Email service not configured' });
    }

    const transporter = createTransporter();

    // Send emails
    await Promise.all([
      sendUserEmail(transporter, sanitizedName, sanitizedEmail),
      sendAdminEmail(transporter, sanitizedName, sanitizedEmail),
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

    // Return success response
    return res.status(200).json({ status: 'success', message: 'Successfully joined waitlist' });

  } catch (error) {
    console.error('Waitlist signup error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}
