// Tests never touch the live content directory. The backend stores content under
// CONTENT_STORAGE_DIR, defaulting to /root/texzium-content, and modules clean its tmp/
// folder when they start; any test that starts the application would otherwise do so
// on the live directory. Every test process gets its own empty temporary directory.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CONTENT_STORAGE_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jest-content-'),
);

// Tests never use the live login-token secret either. The backend does not start
// without JWT_SECRET (no built-in fallback), so every test process gets its own
// test-only value; tests that sign tokens read it from process.env.
process.env.JWT_SECRET = 'jest-only-secret-not-for-production';
