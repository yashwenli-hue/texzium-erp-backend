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
