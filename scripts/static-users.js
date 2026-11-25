#!/usr/bin/env node
// Generates public/static-users.js (login gate for static hosting, e.g. GitHub Pages).
// Usage: node scripts/static-users.js jenni bonequinha [user2 pw2 ...]
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const a = process.argv.slice(2); const out = {};
for (let i = 0; i + 1 < a.length; i += 2) {
  const salt = crypto.randomBytes(16).toString('hex');
  out[a[i].toLowerCase()] = { salt, iter: 100000, hash: crypto.pbkdf2Sync(a[i + 1], salt, 100000, 32, 'sha256').toString('hex') };
}
fs.writeFileSync(path.join(__dirname, '..', 'public', 'static-users.js'),
  '/* Cosmetic login gate for static hosting (no server). Data stays on the device. */\nwindow.STATIC_USERS = ' + JSON.stringify(out, null, 2) + ';\n');
console.log('wrote public/static-users.js for', Object.keys(out).join(', '));
