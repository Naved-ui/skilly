# Skilly

Skilly is a student skill exchange backed by Cloudflare Workers and D1. It starts with an empty database: every student, profile, skill listing, and swap request comes from an account created in the app.

## Run it locally

1. Install Node.js 20 or later.
2. In this folder, run `npm install`.
3. Initialize the local database with `npm run db:local`.
4. Start the site and API with `npm run dev` and open the local URL Wrangler prints.

Create a student profile in the site. Profiles and listings are shared through the local D1 database. The marketplace refreshes every 30 seconds. Students can send swap requests with a proposed session time; the recipient can accept or decline, and accepted requests show as scheduled sessions.

## Deploy to Cloudflare

1. Run `npx wrangler login`.
2. Run `npx wrangler d1 create skilly-db` and copy the returned database ID into `wrangler.jsonc` in place of the all-zero placeholder.
3. Run `npm run db:remote` to create the tables in the Cloudflare database.
4. Run `npm run deploy` to publish the website and API together.

No sample student profiles or seed records are included. The first account and listings you create are real database records. This college-project backend uses email and password accounts; email verification, password reset, and moderation are not included yet.
