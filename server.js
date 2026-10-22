require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'Too many attempts. Please wait a little and try again.' } }));
app.use('/review/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'elder_nma_memorial';
let tributesCollection;

function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function baseUrl(req) { return (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''); }
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | Elder Nma Onwuka Memorial</title><style>body{margin:0;background:#f8f5ef;color:#17251f;font:16px/1.65 Arial,sans-serif}.wrap{max-width:760px;margin:6vh auto;padding:0 18px}.card{background:white;border:1px solid #e8e2d7;padding:clamp(22px,5vw,42px)}h1,h2{color:#173b30}h1{font-size:clamp(1.8rem,5vw,2.6rem)}.eyebrow{color:#9c7b41;text-transform:uppercase;letter-spacing:.15em;font-size:.8rem;font-weight:bold}.message{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8f5ef;padding:18px;border-left:3px solid #c8a66a}.meta{color:#69756e}.btn{display:inline-block;padding:13px 20px;border:0;border-radius:3px;background:#c8a66a;color:#17251f;font-weight:bold;cursor:pointer;text-decoration:none;font-size:1rem}.reject{background:#eee8dd;margin-left:8px}.notice{padding:14px;background:#e8f4ec}.foot{color:#69756e;font-size:.8rem;margin-top:22px}@media(max-width:480px){.reject{margin:10px 0 0}}</style></head><body><main class="wrap"><div class="card"><div class="eyebrow">Private family review</div>${body}<p class="foot">Elder Nma Onwuka Memorial • This review link is private. Do not forward it to others.</p></div></main></body></html>`;
}
function serverError(res, err, message) {
  console.error(message, err?.message || err);
  return res.status(500).json({ message: 'The service is temporarily unavailable. Please try again later.' });
}

app.post('/api/tributes', async (req, res) => {
  if (clean(req.body.website, 200)) return res.status(200).json({ message: 'Tribute received.' });
  const name = clean(req.body.name, 100);
  const relationship = clean(req.body.relationship, 80) || 'Not specified';
  const email = clean(req.body.email, 254);
  const title = clean(req.body.title, 120) || 'A tribute to Elder Nma Onwuka';
  const message = clean(req.body.message, 5000);
  if (name.length < 2 || message.length < 10) return res.status(400).json({ message: 'Please provide your name and a tribute of at least 10 characters.' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Please enter a valid email address.' });
  if (!process.env.EMAIL_SERVICE_URL || !process.env.EMAIL_SERVICE_API_KEY || !process.env.TRIBUTES_TO) {
    console.error('Remote email service configuration is missing.');
    return res.status(503).json({ message: 'Tribute email is not configured yet. Please contact the website administrator.' });
  }
  try {
    const now = new Date();
    const tribute = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(32).toString('hex'),
      name, relationship, email, title, message,
      submittedAt: now.toISOString(),
      status: 'pending',
      expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
    };
    await tributesCollection.insertOne(tribute);
    const reviewUrl = `${baseUrl(req)}/review/${tribute.token}`;
    const emailHtml = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#17251f"><div style="background:#173b30;color:#fff;padding:24px"><p style="color:#c8a66a;text-transform:uppercase;letter-spacing:2px;font-size:12px">Private review required</p><h1 style="margin:0">Elder Nma Onwuka</h1></div><div style="padding:24px;border:1px solid #e8e2d7"><p><b>This tribute is not public.</b> Review it and choose whether to publish it.</p><h2>${escapeHtml(title)}</h2><p><b>From:</b> ${escapeHtml(name)}</p><p><b>Relationship:</b> ${escapeHtml(relationship)}</p><p><b>Email:</b> ${escapeHtml(email || 'Not provided')}</p><hr style="border:0;border-top:1px solid #e8e2d7"><div style="white-space:pre-wrap;line-height:1.7">${escapeHtml(message)}</div><p style="margin-top:28px"><a href="${escapeHtml(reviewUrl)}" style="background:#c8a66a;color:#17251f;padding:14px 20px;text-decoration:none;font-weight:bold">Review tribute</a></p><p style="font-size:12px;color:#69756e">This private review link expires in 14 days.</p></div></div>`;
    const emailResponse = await fetch(process.env.EMAIL_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.EMAIL_SERVICE_API_KEY },
      body: JSON.stringify({ recipient: process.env.TRIBUTES_TO, subject: `[Action required: review tribute] ${title}`, senderName: 'Elder Nma Onwuka Memorial — Tribute Notification', messageBody: emailHtml }),
      signal: AbortSignal.timeout(20000)
    });
    if (!emailResponse.ok) {
      const errorBody = await emailResponse.text();
      console.error(`Remote email API returned ${emailResponse.status}:`, errorBody.slice(0, 1000));
      return res.status(502).json({ message: 'Your tribute was saved, but we could not send the review notification. Please contact the website administrator before submitting it again.' });
    }
    return res.status(200).json({ message: 'Tribute submitted for family review.' });
  } catch (err) {
    console.error('Tribute processing failed:', err.message);
    return res.status(500).json({ message: 'We could not process your tribute just now. Please try again later.' });
  }
});

app.get('/review/:token', async (req, res) => {
  try {
    const tribute = await tributesCollection.findOne({ token: req.params.token });
    if (!tribute) return res.status(404).send(page('Link not found', '<h1>Review link not found</h1><p>This link may be invalid or no longer available.</p>'));
    if (tribute.status !== 'pending') return res.status(200).send(page('Already reviewed', `<h1>This tribute has already been ${escapeHtml(tribute.status)}.</h1><p>No further action is needed.</p>`));
    if (!tribute.expiresAt || Date.now() > Date.parse(tribute.expiresAt)) return res.status(410).send(page('Link expired', '<h1>This review link has expired</h1><p>The tribute was kept private. Ask the site administrator to review it again.</p>'));
    const body = `<h1>Review this tribute</h1><p class="meta">Submitted by ${escapeHtml(tribute.name)} · ${escapeHtml(tribute.relationship)} · ${escapeHtml(new Date(tribute.submittedAt).toLocaleDateString('en-GB'))}</p><h2>${escapeHtml(tribute.title)}</h2><div class="message">${escapeHtml(tribute.message)}</div><p>Choose <b>Approve</b> to publish this tribute on the memorial website, or <b>Reject</b> to keep it off the public website.</p><form method="post" action="/review/${encodeURIComponent(tribute.token)}/decision"><button class="btn" type="submit" name="decision" value="approve">Approve for publication</button><button class="btn reject" type="submit" name="decision" value="reject">Reject tribute</button></form><p class="foot">The link expires ${escapeHtml(new Date(tribute.expiresAt).toLocaleDateString('en-GB'))}.</p>`;
    res.set('Cache-Control', 'no-store');
    return res.send(page('Review tribute', body));
  } catch (err) {
    console.error('Could not load tribute review:', err.message);
    return res.status(500).send(page('Unable to review', '<h1>Something went wrong</h1><p>Please try again later.</p>'));
  }
});

app.post('/review/:token/decision', async (req, res) => {
  if (!['approve', 'reject'].includes(req.body.decision)) return res.status(400).send(page('Invalid choice', '<h1>Please choose Approve or Reject.</h1>'));
  try {
    const tribute = await tributesCollection.findOne({ token: req.params.token });
    if (!tribute) return res.status(404).send(page('Link not found', '<h1>Review link not found</h1>'));
    if (tribute.status !== 'pending') return res.status(200).send(page('Already reviewed', `<h1>This tribute has already been ${escapeHtml(tribute.status)}.</h1>`));
    if (!tribute.expiresAt || Date.now() > Date.parse(tribute.expiresAt)) return res.status(410).send(page('Link expired', '<h1>This review link has expired</h1><p>The tribute remains private.</p>'));
    const newStatus = req.body.decision === 'approve' ? 'approved' : 'rejected';
    const result = await tributesCollection.updateOne(
        { _id: tribute._id, status: 'pending', token: req.params.token },
        { $set: { status: newStatus, reviewedAt: new Date().toISOString() }, $unset: { token: '', expiresAt: '' } }
    );
    if (result.modifiedCount !== 1) return res.status(409).send(page('Already reviewed', '<h1>This tribute has already been reviewed.</h1><p>No further action is needed.</p>'));
    const approved = newStatus === 'approved';
    return res.send(page('Decision saved', `<div class="notice"><h1>${approved ? 'Tribute approved' : 'Tribute rejected'}</h1><p>${approved ? 'This tribute is now published in the memorial website’s Tributes & Memories section.' : 'This tribute will remain private and will not appear on the website.'}</p></div><p><a class="btn" href="/">View memorial website</a></p>`));
  } catch (err) {
    console.error('Could not save review decision:', err.message);
    return res.status(500).send(page('Unable to save', '<h1>We could not save your decision</h1><p>Please try again.</p>'));
  }
});

app.get('/api/tributes', async (req, res) => {
  const pageNumber = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const requestedLimit = Number.parseInt(req.query.limit, 10) || 6;
  const limit = Math.min(12, Math.max(1, requestedLimit));
  const filter = { status: 'approved' };
  try {
    const total = await tributesCollection.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);
    const safePage = totalPages === 0 ? 1 : Math.min(pageNumber, totalPages);
    const tributes = await tributesCollection.find(filter, {
      projection: { _id: 0, id: 1, name: 1, relationship: 1, title: 1, message: 1, submittedAt: 1, reviewedAt: 1 }
    }).sort({ submittedAt: -1, id: -1 }).skip((safePage - 1) * limit).limit(limit).toArray();
    res.set('Cache-Control', 'no-store').json({
      tributes,
      pagination: { page: safePage, limit, total, totalPages, hasNextPage: safePage < totalPages, hasPreviousPage: safePage > 1 }
    });
  } catch (err) {
    console.error('Could not read tributes:', err.message);
    res.status(500).json({ message: 'Unable to load tributes.' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await tributesCollection.findOne({}, { projection: { _id: 1 } });
    res.json({ ok: true, database: 'connected' });
  } catch {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));


/* Optional self-ping to help prevent inactivity while the server is running. */
const SELF_PING_INTERVAL = 5 * 60 * 1000; // 5 minutes

if (process.env.SELF_PING_ENABLED === 'true') {
  const selfPingUrl = process.env.SELF_PING_URL;

  if (selfPingUrl) {
    const pingServer = async () => {
      try {
        const response = await fetch(selfPingUrl, {
          signal: AbortSignal.timeout(15000)
        });

        console.log(
            `[Self-ping] ${new Date().toISOString()} - HTTP ${response.status}`
        );
      } catch (error) {
        console.error('[Self-ping] Failed:', error.message);
      }
    };

    // Start after the server has had time to initialize.
    setTimeout(pingServer, 30 * 1000);

    // Repeat every five minutes.
    setInterval(pingServer, SELF_PING_INTERVAL);
  } else {
    console.warn('[Self-ping] SELF_PING_URL is not configured.');
  }
}


async function start() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI is required. Configure it in your local .env or Render environment variables.');
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);
  tributesCollection = db.collection('tributes');
  await tributesCollection.createIndex({ id: 1 }, { unique: true });
  await tributesCollection.createIndex({ token: 1 }, { unique: true, sparse: true });
  await tributesCollection.createIndex({ status: 1, submittedAt: -1 });
  app.listen(PORT, () => console.log(`Memorial website listening on port ${PORT}; MongoDB connected.`));
}
start().catch(err => {
  console.error('Server startup failed:', err.message);
  process.exit(1);
});


// require('dotenv').config();
// const express = require('express');
// // const nodemailer = require('nodemailer');
// const rateLimit = require('express-rate-limit');
// const helmet = require('helmet');
// const path = require('path');
// const fs = require('fs');
// const crypto = require('crypto');
//
// const app = express();
// // Render sits behind a reverse proxy.
// app.set('trust proxy', 1);
// const PORT = Number(process.env.PORT || 3000);
// const DATA_DIR = path.join(__dirname, 'data');
// const TRIBUTES_FILE = path.join(DATA_DIR, 'tributes.json');
// app.disable('x-powered-by');
// app.use(helmet({ contentSecurityPolicy: false }));
// app.use(express.json({ limit: '20kb' }));
// app.use(express.urlencoded({ extended: false, limit: '20kb' }));
// app.use(express.static(path.join(__dirname, 'public')));
// app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'Too many attempts. Please wait a little and try again.' } }));
// app.use('/review/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
//
// function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
// function escapeHtml(str) { return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// function readTributes() {
//   try { return JSON.parse(fs.readFileSync(TRIBUTES_FILE, 'utf8')); }
//   catch (err) { if (err.code === 'ENOENT') return []; throw err; }
// }
// function saveTributes(items) {
//   fs.mkdirSync(DATA_DIR, { recursive: true });
//   const temp = `${TRIBUTES_FILE}.${process.pid}.tmp`;
//   fs.writeFileSync(temp, JSON.stringify(items, null, 2), { mode: 0o600 });
//   fs.renameSync(temp, TRIBUTES_FILE);
// }
// function baseUrl(req) { return (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''); }
// function page(title, body) {
//   return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | Elder Nma Onwuka Memorial</title><style>body{margin:0;background:#f8f5ef;color:#17251f;font:16px/1.65 Arial,sans-serif}.wrap{max-width:760px;margin:6vh auto;padding:0 18px}.card{background:white;border:1px solid #e8e2d7;padding:clamp(22px,5vw,42px)}h1,h2{color:#173b30}h1{font-size:clamp(1.8rem,5vw,2.6rem)}.eyebrow{color:#9c7b41;text-transform:uppercase;letter-spacing:.15em;font-size:.8rem;font-weight:bold}.message{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8f5ef;padding:18px;border-left:3px solid #c8a66a}.meta{color:#69756e}.btn{display:inline-block;padding:13px 20px;border:0;border-radius:3px;background:#c8a66a;color:#17251f;font-weight:bold;cursor:pointer;text-decoration:none;font-size:1rem}.reject{background:#eee8dd;margin-left:8px}.notice{padding:14px;background:#e8f4ec}.foot{color:#69756e;font-size:.8rem;margin-top:22px}</style></head><body><main class="wrap"><div class="card"><div class="eyebrow">Private family review</div>${body}<p class="foot">Elder Nma Onwuka Memorial • This review link is private. Do not forward it to others.</p></div></main></body></html>`;
// }
//
// app.post('/api/tributes', async (req, res) => {
//   if (clean(req.body.website, 200)) return res.status(200).json({ message: 'Tribute received.' });
//   const name = clean(req.body.name, 100);
//   const relationship = clean(req.body.relationship, 80) || 'Not specified';
//   const email = clean(req.body.email, 254);
//   const title = clean(req.body.title, 120) || 'A tribute to Elder Nma Onwuka';
//   const message = clean(req.body.message, 5000);
//   if (name.length < 2 || message.length < 10) return res.status(400).json({ message: 'Please provide your name and a tribute of at least 10 characters.' });
//   if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Please enter a valid email address.' });
//   if (
//       !process.env.EMAIL_SERVICE_URL ||
//       !process.env.EMAIL_SERVICE_API_KEY ||
//       !process.env.TRIBUTES_TO
//   ) {
//     console.error('Remote email service configuration is missing.');
//     return res.status(503).json({
//       message: 'Tribute email is not configured yet. Please contact the website administrator.'
//     });
//   }
//   // if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !process.env.TRIBUTES_TO) {
//   //   console.error('Email configuration missing. Set GMAIL_USER, GMAIL_APP_PASSWORD, and TRIBUTES_TO in .env');
//   //   return res.status(503).json({ message: 'Tribute email is not configured yet. Please contact the website administrator.' });
//   // }
//   try {
//     // const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
//     const now = new Date();
//     const tribute = { id: crypto.randomUUID(), token: crypto.randomBytes(32).toString('hex'), name, relationship, email, title, message, submittedAt: now.toISOString(), status: 'pending', expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString() };
//     const tributes = readTributes();
//     tributes.push(tribute);
//     saveTributes(tributes);
//     const reviewUrl = `${baseUrl(req)}/review/${tribute.token}`;
//     // await transporter.sendMail({
//     //   from: `Elder Nma Onwuka Memorial <${process.env.GMAIL_USER}>`, to: process.env.TRIBUTES_TO,
//     //   replyTo: email || undefined, subject: `[Action required: review tribute] ${title}`,
//     //   text: `A tribute has been submitted for Elder Nma Onwuka and is NOT public unless you approve it.\n\nName: ${name}\nRelationship: ${relationship}\nEmail: ${email || 'Not provided'}\nTitle: ${title}\nSubmitted: ${now.toLocaleString('en-GB', { timeZone: 'UTC' })} UTC\n\nTRIBUTE\n${message}\n\nReview and choose Approve or Reject using this private link (expires in 14 days):\n${reviewUrl}\n\nThe tribute remains private until approved.`,
//     //   html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#17251f"><div style="background:#173b30;color:#fff;padding:24px"><p style="color:#c8a66a;text-transform:uppercase;letter-spacing:2px;font-size:12px">Private review required</p><h1 style="margin:0">Elder Nma Onwuka</h1></div><div style="padding:24px;border:1px solid #e8e2d7"><p><b>This tribute is not public.</b> Review it and choose whether to publish it.</p><h2>${escapeHtml(title)}</h2><p><b>From:</b> ${escapeHtml(name)}</p><p><b>Relationship:</b> ${escapeHtml(relationship)}</p><p><b>Email:</b> ${escapeHtml(email || 'Not provided')}</p><hr style="border:0;border-top:1px solid #e8e2d7"><div style="white-space:pre-wrap;line-height:1.7">${escapeHtml(message)}</div><p style="margin-top:28px"><a href="${escapeHtml(reviewUrl)}" style="background:#c8a66a;color:#17251f;padding:14px 20px;text-decoration:none;font-weight:bold">Review tribute</a></p><p style="font-size:12px;color:#69756e">This private review link expires in 14 days. The page will let you approve or reject the tribute.</p></div></div>`
//     // });
//     const emailHtml = `
//   <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#17251f">
//     <div style="background:#173b30;color:#fff;padding:24px">
//       <p style="color:#c8a66a;text-transform:uppercase;letter-spacing:2px;font-size:12px">
//         Private review required
//       </p>
//       <h1 style="margin:0">Elder Nma Onwuka</h1>
//     </div>
//
//     <div style="padding:24px;border:1px solid #e8e2d7">
//       <p><b>This tribute is not public.</b> Review it and choose whether to publish it.</p>
//       <h2>${escapeHtml(title)}</h2>
//       <p><b>From:</b> ${escapeHtml(name)}</p>
//       <p><b>Relationship:</b> ${escapeHtml(relationship)}</p>
//       <p><b>Email:</b> ${escapeHtml(email || 'Not provided')}</p>
//       <hr style="border:0;border-top:1px solid #e8e2d7">
//       <div style="white-space:pre-wrap;line-height:1.7">${escapeHtml(message)}</div>
//       <p style="margin-top:28px">
//         <a href="${escapeHtml(reviewUrl)}"
//            style="background:#c8a66a;color:#17251f;padding:14px 20px;text-decoration:none;font-weight:bold">
//           Review tribute
//         </a>
//       </p>
//       <p style="font-size:12px;color:#69756e">
//         This private review link expires in 14 days.
//       </p>
//     </div>
//   </div>
// `;
//
//     const emailResponse = await fetch(process.env.EMAIL_SERVICE_URL, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'x-api-key': process.env.EMAIL_SERVICE_API_KEY
//       },
//       body: JSON.stringify({
//         recipient: process.env.TRIBUTES_TO,
//         subject: `[Action required: review tribute] ${title}`,
//         senderName: 'Elder Nma Onwuka Memorial — Tribute Notification',
//         messageBody: emailHtml
//       }),
//       signal: AbortSignal.timeout(20000)
//     });
//
//     if (!emailResponse.ok) {
//       const errorBody = await emailResponse.text();
//
//       console.error(
//           `Remote email API returned ${emailResponse.status}:`,
//           errorBody.slice(0, 1000)
//       );
//
//       return res.status(502).json({
//         message: 'We could not send your tribute for review. Please try again later.'
//       });
//     }
//     return res.status(200).json({ message: 'Tribute submitted for family review.' });
//   } catch (err) {
//     console.error('Tribute processing failed:', err.message);
//     return res.status(502).json({ message: 'We could not process your tribute just now. Please try again later.' });
//   }
// });
//
// app.get('/review/:token', (req, res) => {
//   let tribute;
//   try { tribute = readTributes().find(t => t.token === req.params.token); }
//   catch { return res.status(500).send(page('Unable to review', '<h1>Something went wrong</h1><p>Please try again later.</p>')); }
//   if (!tribute) return res.status(404).send(page('Link not found', '<h1>Review link not found</h1><p>This link may be invalid or no longer available.</p>'));
//   if (tribute.status !== 'pending') return res.status(200).send(page('Already reviewed', `<h1>This tribute has already been ${escapeHtml(tribute.status)}.</h1><p>No further action is needed.</p>`));
//   if (Date.now() > Date.parse(tribute.expiresAt)) return res.status(410).send(page('Link expired', '<h1>This review link has expired</h1><p>The tribute was kept private. Ask the site administrator to review it again.</p>'));
//   const body = `<h1>Review this tribute</h1><p class="meta">Submitted by ${escapeHtml(tribute.name)} · ${escapeHtml(tribute.relationship)} · ${escapeHtml(new Date(tribute.submittedAt).toLocaleDateString('en-GB'))}</p><h2>${escapeHtml(tribute.title)}</h2><div class="message">${escapeHtml(tribute.message)}</div><p>Choose <b>Approve</b> to publish this tribute on the memorial website, or <b>Reject</b> to keep it off the public website.</p><form method="post" action="/review/${encodeURIComponent(tribute.token)}/decision"><button class="btn" type="submit" name="decision" value="approve">Approve for publication</button><button class="btn reject" type="submit" name="decision" value="reject">Reject tribute</button></form><p class="foot">The link expires ${escapeHtml(new Date(tribute.expiresAt).toLocaleDateString('en-GB'))}.</p>`;
//   res.set('Cache-Control', 'no-store');
//   res.send(page('Review tribute', body));
// });
//
// app.post('/review/:token/decision', async (req, res) => {
//   let tributes;
//   try { tributes = readTributes(); }
//   catch { return res.status(500).send(page('Unable to review', '<h1>Something went wrong</h1><p>Please try again later.</p>')); }
//   const index = tributes.findIndex(t => t.token === req.params.token);
//   if (index < 0) return res.status(404).send(page('Link not found', '<h1>Review link not found</h1>'));
//   const tribute = tributes[index];
//   if (tribute.status !== 'pending') return res.status(200).send(page('Already reviewed', `<h1>This tribute has already been ${escapeHtml(tribute.status)}.</h1>`));
//   if (Date.now() > Date.parse(tribute.expiresAt)) return res.status(410).send(page('Link expired', '<h1>This review link has expired</h1><p>The tribute remains private.</p>'));
//   if (!['approve', 'reject'].includes(req.body.decision)) return res.status(400).send(page('Invalid choice', '<h1>Please choose Approve or Reject.</h1>'));
//   tribute.status = req.body.decision === 'approve' ? 'approved' : 'rejected';
//   tribute.reviewedAt = new Date().toISOString();
//   delete tribute.token;
//   delete tribute.expiresAt;
//   try { saveTributes(tributes); }
//   catch (err) { console.error('Could not save review decision:', err.message); return res.status(500).send(page('Unable to save', '<h1>We could not save your decision</h1><p>Please try again.</p>')); }
//   const approved = tribute.status === 'approved';
//   res.send(page('Decision saved', `<div class="notice"><h1>${approved ? 'Tribute approved' : 'Tribute rejected'}</h1><p>${approved ? 'This tribute is now published in the memorial website’s Tributes & Memories section.' : 'This tribute will remain private and will not appear on the website.'}</p></div><p><a class="btn" href="/">View memorial website</a></p>`));
// });
//
// app.get('/api/tributes', (_req, res) => {
//   try {
//     const approved = readTributes().filter(t => t.status === 'approved').map(({ id, name, relationship, title, message, submittedAt, reviewedAt }) => ({ id, name, relationship, title, message, submittedAt, reviewedAt }));
//     res.set('Cache-Control', 'no-store').json({ tributes: approved });
//   } catch (err) { console.error('Could not read tributes:', err.message); res.status(500).json({ message: 'Unable to load tributes.' }); }
// });
// app.get('/api/health', (_req, res) => res.json({ ok: true }));
// app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// app.listen(PORT, () => console.log(`Memorial website running at http://localhost:${PORT}`));
