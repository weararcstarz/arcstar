# ARCSTARZ Waitlist Backend Deployment Guide

## Overview
Production-ready Node.js + TypeScript backend for ARCSTARZ waitlist form with SMTP email integration.

## Features
- ✅ Email validation and sanitization
- ✅ SMTP email sending (Namecheap Private Email)
- ✅ Local JSON data storage
- ✅ CORS compatibility
- ✅ Error handling
- ✅ Environment variable security

## Files Created
- `api/join-waitlist.ts` - Main API endpoint
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `join-waitlist.html` - Frontend form with API integration
- `.env.example` - Environment variables template
- `vercel.json` - Vercel deployment configuration

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Create `.env` file (locally) or set in Vercel dashboard:
```
EMAIL_PASS=gezi-kikk-bfrc-fobw
```

### 3. Local Development
```bash
npm run dev
```
Visit: http://localhost:3000/join-waitlist.html

### 4. Vercel Deployment
1. Push to GitHub: `git push origin main`
2. Go to Vercel dashboard
3. Import repository: `weararcstarz/arcstar`
4. Set environment variable: `EMAIL_PASS=gezi-kikk-bfrc-fobw`
5. Deploy

## API Endpoint
- **POST** `/api/join-waitlist`
- **Request Body**: `{ "name": "John Doe", "email": "john@example.com" }`
- **Success Response**: `{ "status": "success" }`
- **Error Response**: `{ "status": "error", "message": "Error description" }`

## Email Configuration
- **SMTP Server**: mail.privateemail.com
- **Port**: 587 (STARTTLS)
- **Username**: support@arcstarz.shop
- **Password**: Environment variable

## Data Storage
- Waitlist data saved to `waitlist.json` in project root
- Format: `[{"id": 1234567890, "name": "John", "email": "john@example.com", "timestamp": "2026-01-21T02:00:00.000Z"}]`

## Security Features
- Input sanitization (removes HTML tags)
- Email format validation
- Duplicate email prevention
- SMTP password in environment variables
- CORS headers for cross-origin requests

## Frontend Integration
The `join-waitlist.html` file includes:
- Form validation
- Loading states
- Success/error messaging
- No page reload
- Fetch API integration

## Testing
Test the complete flow:
1. Fill out form at `/join-waitlist.html`
2. Check email inbox for confirmation
3. Check admin email for notification
4. Verify `waitlist.json` contains entry

## Production Checklist
- [ ] Set EMAIL_PASS environment variable in Vercel
- [ ] Test SMTP email sending
- [ ] Verify CORS works in production
- [ ] Check waitlist.json file creation
- [ ] Test form validation and error handling
