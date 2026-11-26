'use strict';
/* Tiny zero-dependency server: static files + login + per-user JSON storage. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public');
const SESSION_DAYS = 90;
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- users (scrypt-hashed passwords) ---------- */
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return null; }
}
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2), { mode: 0o600 }); }
function setUser(name, pw) {
  const users = loadUsers() || {};
  const salt = crypto.randomBytes(16).toString('hex');
  users[name.toLowerCase()] = { salt, hash: hashPw(pw, salt) };
  saveUsers(users);
}
if (!loadUsers()) {
  // Testing-phase account. Change it with: node scripts/set-password.js <user> <password>
  setUser(process.env.SEED_USER || 'jenni', process.env.SEED_PASSWORD || 'bonequinha');
}

/* ---------- sessions: stateless signed cookie ---------- */
function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.secret');
  try { return fs.readFileSync(f, 'utf8'); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = getSecret();
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
function makeToken(user) {
  const p = Buffer.from(JSON.stringify({ u: user, e: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return p + '.' + sign(p);
}
function readToken(tok) {
  if (!tok) return null;
  const [p, s] = tok.split('.');
  if (!p || !s) return null;
  const good = sign(p);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString());
    return o.e > Date.now() ? o.u : null;
  } catch { return null; }
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
const sessionUser = (req) => {
  const u = readToken(cookies(req).luna);
  const users = loadUsers() || {};
  return u && users[u] ? u : null;
};
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
function setCookie(res, req, value, maxAge) {
  res.setHeader('Set-Cookie',
    `luna=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}` + (isHttps(req) ? '; Secure' : ''));
}

/* ---------- login throttling ---------- */
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) return false;
  return a.n >= 10;
}
function failed(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) attempts.set(ip, { n: 1, reset: now + 15 * 60 * 1000 });
  else a.n++;
}

/* ---------- helpers ---------- */
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
function body(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const userFile = (u) => path.join(DATA_DIR, 'user-' + crypto.createHash('sha256').update(u).digest('hex').slice(0, 24) + '.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

/* ---------- API ---------- */
async function api(req, res, url) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (throttled(ip)) return json(res, 429, { error: 'too_many' });
    let b; try { b = await body(req, 1e4); } catch { return json(res, 400, { error: 'bad_request' }); }
    const name = String(b.user || '').trim().toLowerCase();
    const users = loadUsers() || {};
    const u = Object.prototype.hasOwnProperty.call(users, name) ? users[name] : null;
    // always hash, so timing doesn't reveal whether the user exists
    const h = hashPw(String(b.password || ''), u ? u.salt : '0'.repeat(32));
    const ok = u && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash));
    if (!ok) { failed(ip); return json(res, 401, { error: 'invalid' }); }
    setCookie(res, req, makeToken(name), SESSION_DAYS * 86400);
    return json(res, 200, { user: name });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    setCookie(res, req, '', 0);
    return json(res, 200, { ok: true });
  }
  const user = sessionUser(req);
  if (!user) return json(res, 401, { error: 'auth' });

  if (url.pathname === '/api/me' && req.method === 'GET') return json(res, 200, { user });
  if (url.pathname === '/api/data' && req.method === 'GET') {
    try { return json(res, 200, { data: JSON.parse(fs.readFileSync(userFile(user), 'utf8')) }); }
    catch { return json(res, 200, { data: null }); }
  }
  if (url.pathname === '/api/data' && req.method === 'PUT') {
    let b; try { b = await body(req); } catch { return json(res, 413, { error: 'bad_body' }); }
    if (!b || typeof b !== 'object' || b.v !== 1 || typeof b.updatedAt !== 'number' || !Array.isArray(b.starts) || typeof b.logs !== 'object')
      return json(res, 400, { error: 'bad_shape' });
    const f = userFile(user);
    fs.writeFileSync(f + '.tmp', JSON.stringify(b), { mode: 0o600 });
    fs.renameSync(f + '.tmp', f);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'not_found' });
}

/* ---------- static ---------- */
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.png' || ext === '.svg' ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'server' });
  }
});
server.listen(PORT, () => console.log(`Luna running on http://localhost:${PORT}`));
