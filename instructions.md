# What this project is

This is a **custom Guest Operations System** for a short-term rental/property management business.

The main product is a **unified guest communication inbox** that brings conversations from:

- Airbnb
- Booking.com
- WhatsApp Business
- Gmail

into one web application.

Staff should be able to see guest conversations in one place, identify the related reservation and property, assign conversations to employees, reply to guests, track issues, and manage operational tasks.

This is not simply a Beds24 integration or an automation project. It is closer to building a small **multi-channel customer service and property operations platform**.

---

# What you are expected to build

## 1. Unified guest inbox

The core feature should allow staff to:

- View all guest conversations in one inbox
- Read messages from Airbnb, Booking.com, WhatsApp, and Gmail
- Reply from the same interface
- Send replies through the original channel where technically supported
- See the channel for each message
- Mark conversations as read or unread
- Assign conversations to employees
- Add internal notes
- Search and filter conversations
- See message history
- View the guest, reservation, and property connected to each conversation
- See whether a message was successfully sent or failed

A conversation should ideally display:

```text
Guest
Reservation
Property
Channel
Conversation status
Assigned employee
Last message
Response time
Internal notes
Message history
```

## 2. Channel integrations

### Beds24

Beds24 appears to be the primary property-management integration and may provide access to:

- Properties
- Rooms or units
- Reservations
- Guest details
- Airbnb-connected messages
- Booking.com-connected messages
- Message sending, if the account/API permissions support it

You need to verify:

- Beds24 API V2 access
- Property IDs
- Reservation access
- Message read access
- Message send/reply access
- Whether Airbnb and Booking.com messages are actually available through Beds24
- Webhook support or whether polling is required
- API rate limits and authentication behavior

The first technical milestone should be a real test proving:

```text
Incoming message → application inbox → staff reply → guest receives reply
```

Do not assume that having Beds24 login access automatically means you have API message access.

### Airbnb

The client has provided Airbnb credentials, but direct Airbnb automation may be restricted depending on the account and API eligibility.

You need to determine whether Airbnb messages will be handled:

- Directly through an approved Airbnb API integration, or
- Through Beds24, if Beds24 exposes the connected Airbnb messages

Do not build around browser automation or credential scraping without confirming that it is permitted and technically reliable.

### Booking.com

The same applies to Booking.com. Confirm whether messages are available through:

- Beds24, or
- Booking.com’s official connectivity/API access

The client’s Booking.com login alone is not necessarily enough for a proper production integration.

### WhatsApp Business

This is not yet connected.

You need to collect:

- Meta Business Manager access
- Facebook Page/business ownership details
- WhatsApp Business Account ID
- Phone number ID
- Active WhatsApp phone number
- Current WhatsApp provider, if any
- Whether the number must continue working in the WhatsApp Business mobile app
- Meta developer/app permissions
- Webhook configuration details
- Approved message templates, where required

You should use the official **WhatsApp Cloud API** or an approved provider. Do not build an unofficial WhatsApp Web automation system.

### Gmail

Gmail also needs to be connected through OAuth.

You need to confirm:

- Which mailbox will be connected
- Whether it is a shared inbox
- Which employees can view or reply
- Whether replies should come from the original mailbox
- Whether historical emails need to be imported
- How Gmail threads will be matched to guests and reservations
- Attachment requirements

The client should authorize Gmail through an OAuth consent screen. You should not request or store their Gmail password.

---

# 3. Database and backend

A database such as Supabase should store normalized records from all channels.

Likely tables include:

- `properties`
- `rooms`
- `staff`
- `guests`
- `reservations`
- `channels`
- `conversations`
- `messages`
- `message_attachments`
- `conversation_assignments`
- `internal_notes`
- `tasks`
- `incidents`
- `faq_entries`
- `audit_logs`
- `sync_events`
- `message_delivery_status`

The important design decision is to normalize every channel into one message structure.

For example:

```text
message_id
conversation_id
channel
external_message_id
sender
recipient
content
direction
sent_at
attachments
delivery_status
raw_payload
```

You should preserve the original channel message ID so that duplicate messages are not created during synchronization.

---

# 4. n8n integration and orchestration

n8n will probably coordinate:

- Beds24 synchronization
- New-message webhooks
- Scheduled polling jobs
- Gmail events
- WhatsApp webhooks
- Message routing
- Guest and reservation matching
- Notifications
- Retry logic
- Task creation
- Escalations
- AI classification and summarization

You need to include protections against:

- Duplicate messages
- Failed sends
- Repeated webhook events
- API rate limits
- Expired OAuth tokens
- Partial synchronization
- Replies being sent to the wrong guest
- A message being assigned to the wrong property

Every external event should have an idempotency strategy using something like:

```text
channel + external_message_id
```

---

# 5. Staff inbox interface

The custom web application should likely include:

## Inbox screen

- Conversation list
- Unread indicators
- Channel filters
- Property filters
- Assigned employee filters
- Status filters
- Search
- Response-time indicators

## Conversation screen

- Full message history
- Guest and reservation details
- Property details
- Reply composer
- Channel indicator
- Internal notes
- Assignment controls
- Status controls
- Send status and errors
- AI summary
- Suggested FAQ response

## Property and reservation view

- Property information
- Current and upcoming reservations
- Guest details
- Check-in/check-out dates
- Conversation history
- Open tasks and incidents

## Task and incident view

- Task category
- Assigned staff member
- Priority
- Due date
- Status
- Related guest/property/reservation
- Escalation history

---

# 6. Operations dashboard

The dashboard should help management see:

- Open guest issues
- Unassigned conversations
- Overdue tasks
- Unanswered messages
- Response times
- Incidents
- Conversations by channel
- Conversations by property
- Staff workload
- Escalated issues
- Daily and weekly operational summaries

This is more than a messaging inbox. It is also a lightweight **guest-support and staff-task management system**.

---

# 7. AI features

The handoff mentions AI, but these should be carefully controlled.

Potential AI features:

- Classify messages, such as:
  - Check-in
  - Check-out
  - Wi-Fi
  - Parking
  - Cleaning
  - Maintenance
  - Refund request
  - Cancellation
  - Complaint
  - Emergency
- Summarize long conversations
- Suggest replies from approved FAQs
- Create tasks automatically
- Detect urgent or sensitive messages
- Escalate safety, refund, legal, or complaint issues to a human

AI should not automatically send sensitive replies without approval. The system should distinguish between:

```text
AI suggestion → human approval → send
```

and:

```text
Approved low-risk FAQ → optional automatic reply
```

The client must define which messages can be automated.

---

# 8. Property and employee information

You should give the client templates for the following information.

## Property template

Ask for:

- Property name
- Property ID
- Address
- Unit or room name
- Check-in time
- Check-out time
- Wi-Fi name
- Wi-Fi password
- Parking instructions
- Check-in instructions
- Door/access instructions
- House rules
- Cleaning information
- Frequently asked questions
- Emergency contacts
- Maintenance contacts
- Local recommendations
- Refund and cancellation policy
- After-hours instructions

## Employee template

Ask for:

- Full name
- Email
- Phone number
- Role
- Assigned properties
- Can view messages?
- Can reply to guests?
- Can assign tasks?
- Can manage staff?
- Can approve refunds?
- Can access reports?
- Working hours
- Escalation contact

---

# What you should build first

## Phase 1: Discovery and access validation

- Securely receive new credentials or invitations
- Confirm all accounts and ownership
- Verify Beds24 API access
- Identify properties and reservation data
- Confirm Airbnb and Booking.com message availability through Beds24
- Confirm WhatsApp integration route
- Confirm Gmail mailbox and OAuth requirements
- Confirm whether RANSYS is completely removed from scope

## Phase 2: Technical foundation

- Set up the client-owned Supabase project
- Set up the client-owned n8n instance
- Set up the frontend application
- Implement authentication and staff roles
- Create the database schema
- Define normalized guest, reservation, conversation, and message models

## Phase 3: Beds24 proof of concept

Build and test:

1. Pull a property.
2. Pull a reservation.
3. Match the guest.
4. Pull a message.
5. Display it in the inbox.
6. Send a reply.
7. Confirm delivery.
8. Prevent duplicate synchronization.

This should happen before building the complete interface.

## Phase 4: Inbox application

Build:

- Conversation list
- Conversation detail
- Reply composer
- Assignment
- Notes
- Search
- Filters
- Read/unread state
- Delivery status
- Guest/reservation/property panels

Mock WhatsApp and Gmail records if their access is delayed so the interface can progress.

## Phase 5: WhatsApp and Gmail

- Connect WhatsApp Cloud API or approved provider
- Add webhook handling
- Add outbound message sending
- Connect Gmail through OAuth
- Handle Gmail thread association
- Test incoming and outgoing messages

## Phase 6: Tasks, dashboard, and AI

- Add classifications
- Add summaries
- Add approved FAQ suggestions
- Add task creation
- Add incident handling
- Add escalation rules
- Add response-time reports

## Phase 7: QA and rollout

Test every channel for:

- Incoming messages
- Outgoing replies
- Duplicate events
- Failed delivery
- Expired authentication
- Missing guest matches
- Wrong property matches
- Attachments
- Staff assignments
- Permissions
- Search and filters
- AI escalation
- Human handoff
- Audit history

---

# Major scope concern

The original commercial baseline is:

- $950 fixed
- Up to 70 development hours
- Approximately three weeks
- 30 days of post-launch bug support

A full two-way inbox across Airbnb, Booking.com, WhatsApp, Gmail, plus AI, dashboard, staff management, task management, synchronization, and reporting is likely **larger than a 70-hour build**, especially if the client expects production-ready reliability.

You should not promise the full system until the following are clarified:

1. Which channels can actually send replies through official APIs?
2. Is Airbnb and Booking.com messaging handled through Beds24?
3. Does the $950 scope include a complete two-way inbox or only a guest timeline/portal?
4. Are attachments required?
5. Is historical message import required?
6. How many properties and staff members are involved?
7. Is AI allowed to send messages automatically?
8. Is RANSYS removed entirely?
9. Who owns the hosting, Supabase, n8n, Meta, and OAuth accounts?
10. Is the client expecting a working MVP or a fully polished production platform?

---

# Recommended MVP scope

For the current budget, define the first version as:

- Beds24 integration
- Airbnb/Booking.com messages only if available through Beds24
- Basic Supabase data model
- Staff login
- Unified inbox
- Read and reply functionality where supported
- Guest/reservation/property matching
- Assignment and internal notes
- Basic search and filters
- Basic task creation
- Basic deployment and documentation

Then treat these as Phase 2 or separately priced:

- WhatsApp
- Gmail
- AI reply suggestions
- Automatic AI replies
- Full dashboard/reporting
- Historical imports
- Attachments
- Advanced staff permissions
- SLA reporting
- RANSYS integration
- Advanced incident management

## Bottom line

You are being asked to build a **custom multi-channel guest communication and operations platform**, with Beds24 as the initial property/reservation source and n8n/Supabase as the integration and data foundation.

The first thing to prove is not the UI. It is whether Beds24 can reliably receive and send Airbnb and Booking.com messages. After that, validate WhatsApp and Gmail access. Only then should you commit to the final scope, because the requested full two-way inbox may be substantially larger than the original proposal.