import { SetMetadata } from '@nestjs/common';

// Every route needs a valid login token (JwtAuthGuard is registered globally in
// AuthModule). @Public() is the one way out, and it is deliberately narrow:
//
//  * it is honoured on a single route handler only, never on a whole controller;
//  * the routes allowed to carry it are fixed in PUBLIC_ROUTES below, and
//    route-authentication.spec.ts fails if any other route is reachable without a token.
//
// Add a route here only when the caller can never hold a login token (the login itself,
// or an inbound call from an outside system).
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// The complete list of routes that answer without a login token.
export const PUBLIC_ROUTES = [
  'POST /auth/login',
  // Inbound leads pushed by an external platform, matched to a configured Connector.
  'POST /webhooks/:platform',
  // Incoming WhatsApp messages delivered by the WhatsApp Cloud API.
  'POST /whatsapp/webhook',
  // A content file opened by the browser itself (<img>, <video>, a download link), which
  // cannot carry the login token: only with a signature, issued to a signed-in user with
  // content.view, that names this one file and expires after 15 minutes.
  'GET /content-files/:fileId',
] as const;
