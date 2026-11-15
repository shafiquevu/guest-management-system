-- Invoices: replaces the team's desktop "Commercial Invoice Generator".
--
-- invoice_companies  the companies they bill from (JAK's Homes, Samara House...),
--                    each with its own letterhead, logo and bank details.
-- invoice_settings   one shared number sequence per organisation, e.g.
--                    GPS-2026-002776 -- the same series runs across every company,
--                    as it does in the old tool.
-- invoices           one row per invoice, line items as JSON.
--
-- Only the server (service key) reads and writes these, after checking the
-- caller's role, so RLS is on with no policies: the browser cannot touch them.

CREATE TABLE IF NOT EXISTS public.invoice_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  trading_as text,
  address text,
  company_no text,
  vat_no text,
  email text,
  phone text,
  website text,
  logo_url text,
  account_name text,
  account_no text,
  sort_code text,
  footer_note text,
  default_notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  prefix text NOT NULL DEFAULT 'GPS',
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  company_id uuid NOT NULL REFERENCES public.invoice_companies(id),
  invoice_no text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'cancelled')),
  invoice_date date NOT NULL,
  due_date date,
  terms text,
  currency text NOT NULL DEFAULT 'GBP',
  bill_to text NOT NULL,
  customer_ref text,
  property_ref text,
  ledger_booking_id text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  vat numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_number_unique UNIQUE (organization_id, invoice_no)
);

CREATE INDEX IF NOT EXISTS invoices_org_date ON public.invoices (organization_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS invoices_ledger_booking ON public.invoices (organization_id, ledger_booking_id);

ALTER TABLE public.invoice_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Hand out the next number atomically: two people saving at the same moment
-- can never get the same one. Format: PREFIX-YYYY-000123.
CREATE OR REPLACE FUNCTION public.next_invoice_number(org uuid, for_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p text;
  n integer;
BEGIN
  INSERT INTO invoice_settings (organization_id) VALUES (org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE invoice_settings
     SET next_number = next_number + 1, updated_at = now()
   WHERE organization_id = org
  RETURNING prefix, next_number - 1 INTO p, n;
  RETURN p || '-' || for_year::text || '-' || lpad(n::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_invoice_number(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Company logos, uploaded through /api/invoices/companies/logo (service key).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('invoice-logos', 'invoice-logos', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
