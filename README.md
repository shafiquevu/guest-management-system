# Guest Inbox

One inbox for guest conversations, linked to the guest, reservation and
property. Staff read and reply, assign, add internal notes, and turn requests
into tasks. Airbnb and Booking.com messages come through **Beds24**; WhatsApp
and Gmail are planned and the data model already supports them.

## How it fits together

```
Beds24 ──webhook──▶ /api/webhooks/beds24 ─┐
n8n (every 5 min) ─▶ /api/sync/beds24 ────┼─▶ sync engine ─▶ Supabase
"Sync now" button ─▶ /api/sync/beds24 ────┘   (src/lib/sync)     ▲
                                                                 │ RLS + Realtime
Staff browser ─▶ Next.js app (inbox, tasks, settings) ───────────┘
            └──▶ /api/send ─▶ Beds24 ─▶ guest on Airbnb / Booking.com
```

- **No duplicates.** Every Beds24 message is stored once under `beds24:<id>`;
  webhooks, the poll and manual syncs can overlap safely. A reply sent from
  here is stored as `local:<key>` and matched to Beds24's copy by text.
- **Sending is honest.** A reply is `pending`, then `sent` or `failed` with
  Beds24's reason, and can be retried. A double click cannot send twice.
- **Access.** Admins, managers and read-only users see everything; agents see
  their assigned properties, conversations assigned to them, and anything not
  yet linked to a property. Read-only users cannot change anything.
- Sync never overwrites status or assignment. A new guest message reopens a
  resolved conversation.

## Setup

1. **Database.** In Supabase -> SQL Editor run
   `supabase/migrations/001_inbox_live.sql`. The last statement lists any
   older policies on the inbox tables; drop any that are not `inbox_*`.
2. **Environment.** Copy `.env.example` to `.env` and fill it in.
3. **First admin.** `npm run create-admin -- you@example.com "Your Name"`
   (prints a first password once).
4. **Run.** `npm run dev`, sign in at http://localhost:3000, then Settings ->
   **Load last 30 days**.

## Going live

1. Deploy to Vercel (or any Node host) with the same environment variables.
2. **n8n schedule** (replaces the old "Beds24 Connection Setup" preview):
   Schedule Trigger every 5 minutes -> HTTP Request
   `POST https://<app>/api/sync/beds24` with header `x-sync-secret: <SYNC_SECRET>`.
3. **Beds24 webhook:** Settings -> Properties -> Access -> Booking Webhook:
   `https://<app>/api/webhooks/beds24?key=<BEDS24_WEBHOOK_KEY>`.
4. Add staff in Settings; tick the properties each agent handles.

## Checks

```
npm test        # mapping rules (channels, directions, de-duplication keys)
npm run lint
npm run build
```
