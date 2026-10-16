// Integration tests run the real application against a REAL, THROWAWAY PostgreSQL database.
// They empty it before every test file, so they refuse to start unless they are pointed at a
// scratch database on purpose:
//
//   INTEGRATION_DATABASE_URL=postgresql://.../rev_<name> npx jest -c test/integration/jest-integration.json
//
// The database name must start with "rev_" (the scratch-database convention); DATABASE_URL
// from .env is never used. Content storage goes to a fresh temporary directory, the automatic
// purge worker is off, and the login tokens are signed with a secret made up for this run.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error('INTEGRATION_DATABASE_URL is not set: integration tests need a scratch database.');
let name;
try {
  name = new URL(url).pathname.replace(/^\//, '');
} catch {
  throw new Error('INTEGRATION_DATABASE_URL is not a valid URL.');
}
if (!/^rev_[a-z0-9_]+$/.test(name)) {
  throw new Error('INTEGRATION_DATABASE_URL must name a scratch database (rev_...).');
}
process.env.DATABASE_URL = url;
process.env.CONTENT_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'int-content-'));
process.env.DATA_DELETION_AUTOPURGE = 'off';
process.env.JWT_SECRET = crypto.randomBytes(24).toString('base64url');
