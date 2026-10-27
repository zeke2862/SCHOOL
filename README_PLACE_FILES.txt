School Admin System - Update v3 (hubs / identity-based visibility / front-line delegation)
(v3 replaces v2 completely. Use ONLY this package.)

HOW TO PLACE
1. Copy every folder/file in this package into the project root (same relative paths), overwrite when asked.
2. Run:  npm install      (adds nodemailer for notification e-mails)
3. In Supabase SQL Editor run  sql/109_delegation_temp_staff_audit.sql  ONCE (after 108). Test project first.
4. Vercel environment variables:
   - CRON_SECRET            (required for the new daily cron /api/cron/expire-temp-accounts)
   - MAIL_FROM, and SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS   OR   RESEND_API_KEY
   Without mail settings everything works; in-app notifications are sent, e-mails wait in the queue.
5. Deploy.

DELEGATION RULE (v3)
- An agent takes over ONLY front-line teaching work of the principal (homeroom class, taught subjects:
  roll call, scores, conduct). Role and department rights stay the agent's OWN.
  So an agent can never approve / review / do admin work through delegation.
- Admin posts: S/A set them up directly.

NEW / CHANGED
- Hubs: /attendance /discipline /exam /clubs /clock /review /general /system, rewritten /admin (home), /admin/grading, /admin/registrar.
  Old routes still work. Visibility table: lib/permissions.ts
- Login: two cards (staff / parent).  Delegation page: /account/proxy.  Temp teachers: System hub.  Change log: Review hub.
