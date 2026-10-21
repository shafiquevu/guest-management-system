-- 003: AI triage + escalation.
--
-- conversations already has ai_category, ai_priority, ai_summary and
-- ai_confidence. This adds:
--   ai_triaged_at  when the AI last read the thread (re-read on each new guest message)
--   ai_flag        why the AI wants a human, e.g. "Guest reports a gas smell"
--
-- Incidents are created by the server (service role) when a conversation is
-- escalated; staff can read them and managers can update them.
--
-- Safe to run more than once.

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_triaged_at timestamptz;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_flag text;

CREATE INDEX IF NOT EXISTS conversations_last_inbound_idx ON public.conversations (organization_id, last_inbound_at DESC);
CREATE INDEX IF NOT EXISTS incidents_conversation_idx ON public.incidents (conversation_id);

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_incidents_select ON public.incidents;
CREATE POLICY inbox_incidents_select ON public.incidents FOR SELECT TO authenticated
  USING (
    organization_id = public.app_org_id()
    AND (conversation_id IS NULL OR public.app_can_see_conversation(conversation_id))
  );

DROP POLICY IF EXISTS inbox_incidents_update ON public.incidents;
CREATE POLICY inbox_incidents_update ON public.incidents FOR UPDATE TO authenticated
  USING (organization_id = public.app_org_id() AND public.app_role() IN ('admin', 'manager'))
  WITH CHECK (organization_id = public.app_org_id());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'incidents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents;
  END IF;
END $$;
