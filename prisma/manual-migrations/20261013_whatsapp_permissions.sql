-- WhatsApp: permissions for the WhatsApp configuration and for sending messages.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants them to SUPER_ADMIN only:
--
--   whatsapp.config.view     list WhatsApp configurations (GET /whatsapp/configs); the
--                            access token and webhook verify token are never returned,
--                            only whether each one is set
--   whatsapp.config.manage   create or update a configuration (POST /whatsapp/config,
--                            PATCH /whatsapp/configs/:id) and set up the bot
--                            (POST /whatsapp/bot-config, POST /whatsapp/department-route)
--   whatsapp.messages.send   send a WhatsApp message (POST /whatsapp/send)
--
-- Permissions are copied into the login token, so a signed-in user needs to log in
-- again before the new permissions apply to their session.
--
-- The webhook (POST /whatsapp/webhook) needs no permission but requires Meta's
-- signature, checked with the app secret from the WHATSAPP_APP_SECRET environment
-- variable; while it is not set, every delivery is refused (503).
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261013_whatsapp_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'AdminOS'
FROM (VALUES
  ('whatsapp.config.view',   'View WhatsApp Configuration'),
  ('whatsapp.config.manage', 'Manage WhatsApp Configuration'),
  ('whatsapp.messages.send', 'Send WhatsApp Messages')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('whatsapp.config.view', 'whatsapp.config.manage', 'whatsapp.messages.send')
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the three codes):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN ('whatsapp.config.view', 'whatsapp.config.manage', 'whatsapp.messages.send'));
-- DELETE FROM "Permission" WHERE "code" IN ('whatsapp.config.view', 'whatsapp.config.manage', 'whatsapp.messages.send');
-- COMMIT;
