# Glass Tasks

iOS Safari first / desktop responsive task manager with immediate input, swipe task statuses, white translucent glass UI, full-screen skeleton, Google-only sign-in, D1 storage and Workers AI task decomposition.

## Stack
- Plain JavaScript / CSS / HTML: light and fast immediate capture, no hydration delay.
- Cloudflare Workers with Static Assets: API and frontend deployed together.
- Cloudflare D1: user-scoped persistent task storage.
- Workers AI: note-to-task conversion within Cloudflare.
- Google OAuth: sole production sign-in.
- Wrangler: deployment and database migrations.

## Setup

1. Use the existing Cloudflare D1 database `glass-task-db` (database ID already configured in `wrangler.jsonc`).
2. Create Google OAuth web client in Google Cloud Console. Add the exact allowed redirect `https://YOUR-WORKERS-HOST/auth/callback` and allowed origin `https://YOUR-WORKERS-HOST`. Configure OAuth consent screen.
3. Set secrets via Wrangler, never in Git:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET
   ```
4. Run:
   ```bash
   npm install
   npm test
   npm run db:remote
   npm run deploy
   ```
5. In Cloudflare Workers Build settings, connect the GitHub repository and configure build/deploy according to Wrangler. Do not publish before valid D1 bindings and secrets are present.

Local frontend preview: run `python3 -m http.server 4173 --directory public`. Local preview stores tasks in the browser; production uses D1 after Google authentication.

## Status

Frontend and backend source committed. Actual Cloudflare deployment, Google sign-in, Workers AI inference and live Safari browser verification **have not yet been performed**.

## Security
Keep Cloudflare API tokens, Google client secret and SESSION_SECRET out of Git. Validate production OAuth redirect and restrict production traffic to HTTPS.
