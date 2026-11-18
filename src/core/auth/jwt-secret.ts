// The one secret login tokens are signed and checked with. There is no built-in
// fallback: a backend started without JWT_SECRET refuses to start, instead of
// silently signing tokens with a value anyone who has read this code knows.
// Read when the auth module is built (not when this file is imported), the same
// moment the token strategy reads it, so signing and checking always agree.
export const JWT_SECRET_MISSING_MESSAGE =
  'JWT_SECRET is not set. Set it in the backend .env (a long random value) and start again; the backend does not start without it.';

export function requireJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(JWT_SECRET_MISSING_MESSAGE);
  }
  return secret;
}
