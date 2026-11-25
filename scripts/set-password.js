#!/usr/bin/env node
// Usage: node scripts/set-password.js <username> <password>   (creates or updates the user)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [name, pw] = process.argv.slice(2);
if (!name || !pw) { console.error('Usage: node scripts/set-password.js <username> <password>'); process.exit(1); }
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'users.json');
let users = {}; try { users = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
const salt = crypto.randomBytes(16).toString('hex');
users[name.toLowerCase()] = { salt, hash: crypto.scryptSync(pw, salt, 32).toString('hex') };
fs.writeFileSync(file, JSON.stringify(users, null, 2), { mode: 0o600 });
console.log(`User "${name.toLowerCase()}" saved in ${file}`);
