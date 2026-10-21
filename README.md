# Elder Nma Onwuka Memorial Tribute Website

A responsive memorial website with a tribute form, Gmail notifications, and **approval by email link**. Submitted tributes stay private until a family member approves them. Approved messages appear in the public “Tributes & Memories” section.

## Requirements
- Node.js 18 or newer
- A Gmail account authorised to send notifications
- A Gmail inbox for receiving tribute notifications and approval links
- A public HTTPS website URL when deployed

## Run locally
1. Open this folder in VS Code (or another IDE).
2. In the terminal, run `npm install`.
3. Copy `.env.example` to `.env`.
4. Edit `.env` and set:
   - `GMAIL_USER`: Gmail address used as the sender.
   - `GMAIL_APP_PASSWORD`: a Google App Password for that sender account.
   - `TRIBUTES_TO`: the inbox that receives tributes and approval emails.
   - `SITE_URL`: for local testing, set to `http://localhost:3000`; when deployed, set it to your public HTTPS URL without a trailing slash.
5. Run `npm start`.
6. Open `http://localhost:3000` in your browser.

## How approval works
1. A visitor submits a tribute.
2. The server saves it as pending and emails the family inbox with a private review link.
3. Open the link from Gmail, read the tribute, and choose **Approve for publication** or **Reject tribute**.
4. Approved tributes are shown in the website’s “Tributes & Memories” section. Rejected tributes remain private.
5. Review links expire after 14 days and can be used only once.

The app stores pending and approved tributes in `data/tributes.json`. Back up this file regularly. On hosting providers with an ephemeral filesystem, configure a persistent disk for this folder or use a managed database; otherwise stored tributes may be lost when the service restarts or redeploys. Keep this file private and never commit real tribute data to a public repository.

### Gmail App Password setup
Enable 2-Step Verification on the sending Google account, then create an App Password from Google Account → Security → 2-Step Verification → App passwords (availability depends on account type and administrator policy). Put the generated 16-character password in `.env`, with or without spaces. Do not use your normal Gmail password. Never commit or upload `.env` to GitHub.

The sender Gmail and receiving Gmail can be the same account, but a separate dedicated inbox is recommended. Test with a sample tribute before sharing the website publicly. The email link is a private bearer link: anyone who has it can review and decide that specific tribute, so do not forward it.

## Add Elder Nma Onwuka's real photos and videos
Add these files (keep the exact filenames):
- `public/assets/photos/elder-nma-onwuka.jpg` — main portrait
- `public/assets/photos/family-memory.jpg` — gallery image 1
- `public/assets/photos/family-memory-2.jpg` — gallery image 2
- `public/assets/videos/memorial.mp4` — optional video (MP4 recommended)

Use family-approved images/videos and optimise them for the web. No photos of Elder Nma Onwuka were supplied with the request, so the initial site uses respectful placeholders rather than pretending stock photos are him.

## Deploy
Deploy the whole project to a Node.js host that supports environment variables and persistent storage (for example a VPS or a platform with a persistent disk). Set install command `npm install` and start command `npm start`. Configure `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `TRIBUTES_TO`, and `SITE_URL` in the host's environment-variable dashboard. Use HTTPS and test both submitting a tribute and approving it from Gmail after deployment.

If using a platform that only hosts static HTML, email approval will not work: the Node.js server is required to keep credentials private and process approval links securely.

## Useful checks
- `GET /api/health` returns `{ "ok": true }` when the server is running.
- `GET /api/tributes` returns approved tributes only.
- The app includes basic rate limiting and a hidden honeypot field. For a high-traffic public launch, consider CAPTCHA, monitoring, and a managed database.
