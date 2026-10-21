-- ============================================================================
-- 002  Let managers edit property information and saved replies
--
-- Run after 001, in Supabase -> SQL Editor. Safe to run more than once.
--
-- Property names, addresses and bookings come from Beds24 and are refreshed
-- by the sync. What the team adds by hand -- Wi-Fi, check-in instructions,
-- parking, house rules -- is edited here by admins and managers. Agents see
-- it in the guest panel but cannot change it.
-- ============================================================================

DROP POLICY IF EXISTS inbox_properties_update ON public.properties;
CREATE POLICY inbox_properties_update ON public.properties FOR UPDATE TO authenticated
  USING (organization_id = app_org_id() AND app_role() IN ('admin', 'manager'))
  WITH CHECK (organization_id = app_org_id());

DROP POLICY IF EXISTS inbox_faq_insert ON public.faq_entries;
CREATE POLICY inbox_faq_insert ON public.faq_entries FOR INSERT TO authenticated
  WITH CHECK (organization_id = app_org_id() AND app_role() IN ('admin', 'manager'));

DROP POLICY IF EXISTS inbox_faq_update ON public.faq_entries;
CREATE POLICY inbox_faq_update ON public.faq_entries FOR UPDATE TO authenticated
  USING (organization_id = app_org_id() AND app_role() IN ('admin', 'manager'))
  WITH CHECK (organization_id = app_org_id());

DROP POLICY IF EXISTS inbox_faq_delete ON public.faq_entries;
CREATE POLICY inbox_faq_delete ON public.faq_entries FOR DELETE TO authenticated
  USING (organization_id = app_org_id() AND app_role() IN ('admin', 'manager'));
