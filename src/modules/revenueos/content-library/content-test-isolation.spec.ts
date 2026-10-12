import * as os from 'os';
import * as path from 'path';

import { DEFAULT_CONTENT_ROOT, contentRoot } from './content-storage';

// The test setup (test/jest-content-dir.js) gives every test process its own temporary
// content directory, so no test that starts the application can clean or write the live
// one. This fails if that setup is ever removed.
describe('tests never use the live content directory', () => {
  it('the content root is a temporary directory, not the default live one', () => {
    expect(contentRoot()).not.toBe(path.resolve(DEFAULT_CONTENT_ROOT));
    expect(contentRoot().startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(
      true,
    );
  });
});
