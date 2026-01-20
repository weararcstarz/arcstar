# ARCSTARZ - Coming Soon

A minimalist coming soon page for ARCSTARZ - a premium clothing brand. Features a clean waitlist signup with custom background image.

## Features

- **Minimal Design**: Clean, focused layout with custom background
- **Waitlist Form**: Simple email signup for launch notifications
- **Responsive**: Works perfectly on all devices
- **Modern Stack**: Built with HTML5, TailwindCSS, and vanilla JavaScript

## Pages

- `coming-soon.html` - Main coming soon page with waitlist
- `index.html` - Full website (for future launch)
- `waitlist.html` - Alternative waitlist page design

## Getting Started

Since this is a static HTML website, you only need a web browser to run it.

### Running the Website

1. Clone or download this repository
2. Open the `coming-soon.html` file in your favorite web browser
3. That's it! The page will load and be fully functional

### Local Development

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .

# Then visit http://localhost:8000/coming-soon.html
```

## Deployment

This website is ready for deployment to any static hosting service:

### GitHub Pages
1. Push to GitHub
2. Enable GitHub Pages in repository settings
3. Select source branch and folder
4. Your site will be live at `https://username.github.io/repository-name/`

### Other Platforms
- Netlify
- Vercel
- Cloudflare Pages
- Any static hosting service

## Customization

### Changing Background
Replace `bg.png` in the root directory with your own background image.

### Updating Brand Info
Edit the brand name "ARCSTARZ" in the HTML files.

### Form Functionality
The current form shows a success message. For production, integrate with:
- Email service (Mailchimp, ConvertKit)
- Backend API
- Serverless function

## File Structure

```
modern-website/
├── coming-soon.html    # Main coming soon page
├── index.html         # Full website (future)
├── waitlist.html      # Alternative design
├── bg.png            # Background image
├── README.md         # This documentation
└── .gitignore        # Git ignore file
```

## License

This project is open source and available under the [MIT License](LICENSE).

---

**Built for ARCSTARZ - Premium Clothing Brand**
