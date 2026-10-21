-- ============================================================================
-- 001  Live inbox: de-duplication keys, access rules, realtime
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor.
--
-- Who sees what:
--   admin, manager, read_only   every conversation in their organisation
--   agent                       conversations for properties they are assigned
--                               to (property_staff), conversations assigned to
--                               them, and conversations not yet linked to a
--                               property (so nothing falls through the cracks)
--   read_only                   can look, cannot change anything
--
-- Messages are never written from the browser. Sending goes through the
-- server (/api/send), which checks the same rules and then calls Beds24.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Unique keys. Without these every webhook retry is a duplicate row.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_external_uniq') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_external_uniq
      UNIQUE (organization_id, channel, external_message_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_thread_uniq') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_thread_uniq
      UNIQUE (organization_id, channel, external_thread_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_external_uniq') THEN
    ALTER TABLE public.reservations ADD CONSTRAINT reservations_external_uniq
      UNIQUE (organization_id, source_channel, external_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_events_uniq') THEN
    ALTER TABLE public.sync_events ADD CONSTRAINT sync_events_uniq
      UNIQUE (organization_id, channel, external_event_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_external_uniq') THEN
    ALTER TABLE public.properties ADD CONSTRAINT properties_external_uniq
      UNIQUE (organization_id, external_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guests_external_uniq') THEN
    ALTER TABLE public.guests ADD CONSTRAINT guests_external_uniq
      UNIQUE (organization_id, external_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_identities_uniq') THEN
    ALTER TABLE public.guest_identities ADD CONSTRAINT guest_identities_uniq
      UNIQUE (organization_id, channel, address);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channel_connections_uniq') THEN
    ALTER TABLE public.channel_connections ADD CONSTRAINT channel_connections_uniq
      UNIQUE (organization_id, channel, display_name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversations_inbox_idx
  ON public.conversations (organization_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS messages_thread_idx
  ON public.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS internal_notes_thread_idx
  ON public.internal_notes (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS tasks_open_idx
  ON public.tasks (organization_id, status, due_at);


-- ----------------------------------------------------------------------------
-- 2. Who is asking. SECURITY DEFINER so the policies can read profiles
--    without the profiles policy recursing into itself.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.app_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM profiles WHERE id = auth.uid() AND active
$$;

CREATE OR REPLACE FUNCTION public.app_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role::text FROM profiles WHERE id = auth.uid() AND active
$$;

CREATE OR REPLACE FUNCTION public.app_can_write() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(app_role() IN ('admin', 'manager', 'agent'), false)
$$;

CREATE OR REPLACE FUNCTION public.app_sees_everything() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(app_role() IN ('admin', 'manager', 'read_only'), false)
$$;

CREATE OR REPLACE FUNCTION public.app_can_see_conversation(conv_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
     WHERE c.id = conv_id
       AND c.organization_id = app_org_id()
       AND (
         app_sees_everything()
         OR c.assigned_to = auth.uid()
         OR c.property_id IS NULL
         OR EXISTS (SELECT 1 FROM property_staff ps
                     WHERE ps.property_id = c.property_id AND ps.profile_id = auth.uid())
       )
  )
$$;

REVOKE ALL ON FUNCTION public.app_org_id(), public.app_role(), public.app_can_write(),
  public.app_sees_everything(), public.app_can_see_conversation(uuid) FROM anon;


-- ----------------------------------------------------------------------------
-- 3. Row level security for the inbox tables
-- ----------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','profiles','properties','property_units','guests','guest_identities',
    'reservations','channel_connections','conversations','messages','message_attachments',
    'internal_notes','conversation_events','tasks','task_events','incidents','faq_entries',
    'sync_events','audit_logs','ai_suggestions','property_staff'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- organizations / profiles
DROP POLICY IF EXISTS inbox_org_read ON public.organizations;
CREATE POLICY inbox_org_read ON public.organizations FOR SELECT TO authenticated
  USING (id = app_org_id());

DROP POLICY IF EXISTS inbox_profiles_read ON public.profiles;
CREATE POLICY inbox_profiles_read ON public.profiles FOR SELECT TO authenticated
  USING (organization_id = app_org_id());

-- reference data: everyone in the organisation can read it
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties','property_units','guests','guest_identities',
                           'reservations','faq_entries','property_staff'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS inbox_read ON public.%I', t);
  END LOOP;
END $$;

CREATE POLICY inbox_read ON public.properties FOR SELECT TO authenticated
  USING (organization_id = app_org_id());
CREATE POLICY inbox_read ON public.property_units FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id
                  AND p.organization_id = app_org_id()));
CREATE POLICY inbox_read ON public.guests FOR SELECT TO authenticated
  USING (organization_id = app_org_id());
CREATE POLICY inbox_read ON public.guest_identities FOR SELECT TO authenticated
  USING (organization_id = app_org_id());
CREATE POLICY inbox_read ON public.reservations FOR SELECT TO authenticated
  USING (organization_id = app_org_id());
CREATE POLICY inbox_read ON public.faq_entries FOR SELECT TO authenticated
  USING (organization_id = app_org_id());
CREATE POLICY inbox_read ON public.property_staff FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR app_role() IN ('admin', 'manager'));

-- conversations: read what you may see; staff may assign / change status
DROP POLICY IF EXISTS inbox_conversations_read ON public.conversations;
CREATE POLICY inbox_conversations_read ON public.conversations FOR SELECT TO authenticated
  USING (app_can_see_conversation(id));

DROP POLICY IF EXISTS inbox_conversations_update ON public.conversations;
CREATE POLICY inbox_conversations_update ON public.conversations FOR UPDATE TO authenticated
  USING (app_can_write() AND app_can_see_conversation(id))
  WITH CHECK (organization_id = app_org_id());

-- messages: read only from the browser
DROP POLICY IF EXISTS inbox_messages_read ON public.messages;
CREATE POLICY inbox_messages_read ON public.messages FOR SELECT TO authenticated
  USING (app_can_see_conversation(conversation_id));

DROP POLICY IF EXISTS inbox_attachments_read ON public.message_attachments;
CREATE POLICY inbox_attachments_read ON public.message_attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id
                  AND app_can_see_conversation(m.conversation_id)));

-- internal notes / conversation history
DROP POLICY IF EXISTS inbox_notes_read ON public.internal_notes;
CREATE POLICY inbox_notes_read ON public.internal_notes FOR SELECT TO authenticated
  USING (app_can_see_conversation(conversation_id));
DROP POLICY IF EXISTS inbox_notes_write ON public.internal_notes;
CREATE POLICY inbox_notes_write ON public.internal_notes FOR INSERT TO authenticated
  WITH CHECK (app_can_write() AND author_id = auth.uid()
              AND organization_id = app_org_id()
              AND app_can_see_conversation(conversation_id));

DROP POLICY IF EXISTS inbox_events_read ON public.conversation_events;
CREATE POLICY inbox_events_read ON public.conversation_events FOR SELECT TO authenticated
  USING (app_can_see_conversation(conversation_id));
DROP POLICY IF EXISTS inbox_events_write ON public.conversation_events;
CREATE POLICY inbox_events_write ON public.conversation_events FOR INSERT TO authenticated
  WITH CHECK (app_can_write() AND actor_id = auth.uid()
              AND organization_id = app_org_id()
              AND app_can_see_conversation(conversation_id));

DROP POLICY IF EXISTS inbox_ai_read ON public.ai_suggestions;
CREATE POLICY inbox_ai_read ON public.ai_suggestions FOR SELECT TO authenticated
  USING (app_can_see_conversation(conversation_id));

-- tasks / incidents: whole organisation can see, staff can create and update
DROP POLICY IF EXISTS inbox_tasks_read ON public.tasks;
CREATE POLICY inbox_tasks_read ON public.tasks FOR SELECT TO authenticated
  USING (organization_id = app_org_id());
DROP POLICY IF EXISTS inbox_tasks_insert ON public.tasks;
CREATE POLICY inbox_tasks_insert ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (app_can_write() AND organization_id = app_org_id() AND created_by = auth.uid());
DROP POLICY IF EXISTS inbox_tasks_update ON public.tasks;
CREATE POLICY inbox_tasks_update ON public.tasks FOR UPDATE TO authenticated
  USING (app_can_write() AND organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

DROP POLICY IF EXISTS inbox_task_events_read ON public.task_events;
CREATE POLICY inbox_task_events_read ON public.task_events FOR SELECT TO authenticated
  USING (organization_id = app_org_id());
DROP POLICY IF EXISTS inbox_task_events_write ON public.task_events;
CREATE POLICY inbox_task_events_write ON public.task_events FOR INSERT TO authenticated
  WITH CHECK (app_can_write() AND organization_id = app_org_id() AND actor_id = auth.uid());

DROP POLICY IF EXISTS inbox_incidents_read ON public.incidents;
CREATE POLICY inbox_incidents_read ON public.incidents FOR SELECT TO authenticated
  USING (organization_id = app_org_id());

-- operational tables: admins only, read only from the browser
DROP POLICY IF EXISTS inbox_admin_read ON public.channel_connections;
CREATE POLICY inbox_admin_read ON public.channel_connections FOR SELECT TO authenticated
  USING (organization_id = app_org_id() AND app_role() IN ('admin', 'manager'));
DROP POLICY IF EXISTS inbox_admin_read ON public.sync_events;
CREATE POLICY inbox_admin_read ON public.sync_events FOR SELECT TO authenticated
  USING (organization_id = app_org_id() AND app_role() = 'admin');
DROP POLICY IF EXISTS inbox_admin_read ON public.audit_logs;
CREATE POLICY inbox_admin_read ON public.audit_logs FOR SELECT TO authenticated
  USING (organization_id = app_org_id() AND app_role() = 'admin');


-- ----------------------------------------------------------------------------
-- 4. Live updates in the inbox
-- ----------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversations', 'messages', 'internal_notes', 'tasks'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 5. Check: anything already on these tables that is MORE permissive than the
--    rules above? Policies add up (OR), so an old "allow all" would undo them.
--    Review the result and drop anything that is not an inbox_* policy.
-- ----------------------------------------------------------------------------

SELECT tablename, policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('organizations','profiles','properties','property_units','guests',
                     'guest_identities','reservations','channel_connections','conversations',
                     'messages','message_attachments','internal_notes','conversation_events',
                     'tasks','task_events','incidents','faq_entries','sync_events',
                     'audit_logs','ai_suggestions','property_staff')
   AND policyname NOT LIKE 'inbox_%'
 ORDER BY tablename, policyname;
