-- EquipCert AI — Production Schema Migration
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- ============================================================
-- 1. ORGANIZATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. PROFILES (linked to auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'technician' CHECK (role IN ('admin', 'manager', 'technician')),
  qualifications TEXT,
  avatar_url TEXT,
  esign_consent BOOLEAN DEFAULT false,
  esign_consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_org ON profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

-- ============================================================
-- 3. EQUIPMENT REGISTRY
-- ============================================================
CREATE TABLE IF NOT EXISTS equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  serial_number TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'out_of_service', 'retired')),
  photo_url TEXT,
  next_due_date DATE,
  last_inspection_date TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_org ON equipment(organization_id);

-- ============================================================
-- 4. EXPAND INSPECTIONS TABLE
-- ============================================================
-- Add new columns to existing inspections table
DO $$
BEGIN
  -- Organization scope
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='organization_id') THEN
    ALTER TABLE inspections ADD COLUMN organization_id UUID REFERENCES organizations(id);
  END IF;

  -- Link to profiles instead of string name
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='inspector_id') THEN
    ALTER TABLE inspections ADD COLUMN inspector_id UUID REFERENCES profiles(id);
  END IF;

  -- Link to equipment registry
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='equipment_id') THEN
    ALTER TABLE inspections ADD COLUMN equipment_id UUID REFERENCES equipment(id);
  END IF;

  -- GPS location evidence
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='location_lat') THEN
    ALTER TABLE inspections ADD COLUMN location_lat DECIMAL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='location_lng') THEN
    ALTER TABLE inspections ADD COLUMN location_lng DECIMAL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='location_address') THEN
    ALTER TABLE inspections ADD COLUMN location_address TEXT;
  END IF;

  -- Digital signature
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='signature_url') THEN
    ALTER TABLE inspections ADD COLUMN signature_url TEXT;
  END IF;

  -- Device info for ESIGN compliance
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='device_info') THEN
    ALTER TABLE inspections ADD COLUMN device_info JSONB;
  END IF;

  -- Audit trail of actions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='audit_trail') THEN
    ALTER TABLE inspections ADD COLUMN audit_trail JSONB DEFAULT '[]';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inspections_org ON inspections(organization_id);

-- ============================================================
-- 5. CORRECTIVE ACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS corrective_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inspection_id BIGINT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  checklist_item_id TEXT,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('critical', 'major', 'minor')),
  assigned_to UUID REFERENCES profiles(id),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'overdue')),
  resolution_notes TEXT,
  resolution_photo_url TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corrective_org ON corrective_actions(organization_id);
CREATE INDEX IF NOT EXISTS idx_corrective_inspection ON corrective_actions(inspection_id);
CREATE INDEX IF NOT EXISTS idx_corrective_status ON corrective_actions(status);

-- ============================================================
-- 6. INSPECTION SCHEDULES
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES profiles(id),
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'annually')),
  next_due DATE NOT NULL,
  last_completed TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_org ON schedules(organization_id);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(next_due) WHERE is_active = true;

-- ============================================================
-- 7. NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('inspection_due', 'corrective_assigned', 'corrective_overdue', 'inspection_failed', 'system')),
  title TEXT NOT NULL,
  body TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  action_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- ============================================================
-- 8. AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ============================================================
-- 9. ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Organizations: users can only see their own org
CREATE POLICY "Users can view own organization" ON organizations
  FOR SELECT USING (
    id IN (SELECT org_id FROM profiles WHERE user_id = auth.uid())
  );

-- Profiles: users can see profiles in their org
CREATE POLICY "Users can view org profiles" ON profiles
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM profiles WHERE user_id = auth.uid())
  );

-- Profiles: users can update their own profile
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (user_id = auth.uid());

-- Profiles: allow insert during signup
CREATE POLICY "Allow profile creation" ON profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Organizations: only allow creation if user has no org yet (signup flow)
CREATE POLICY "Allow org creation during signup" ON organizations
  FOR INSERT WITH CHECK (
    NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid())
  );

-- Equipment: org-scoped
CREATE POLICY "Org-scoped equipment access" ON equipment
  FOR ALL USING (
    organization_id IN (SELECT org_id FROM profiles WHERE user_id = auth.uid())
  );

-- Inspections: org-scoped (if org column exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='organization_id') THEN
    EXECUTE 'ALTER TABLE inspections ENABLE ROW LEVEL SECURITY';

    -- Allow all operations for users in the same org
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inspections' AND policyname='Org-scoped inspection access') THEN
      EXECUTE 'CREATE POLICY "Org-scoped inspection access" ON inspections FOR ALL USING (
        organization_id IN (SELECT org_id FROM profiles WHERE user_id = auth.uid())
      )';
    END IF;
  END IF;
END $$;

-- Corrective actions: org-scoped
CREATE POLICY "Org-scoped corrective actions" ON corrective_actions
  FOR ALL USING (
    organization_id IN (SELECT org_id FROM profiles WHERE user_id = auth.uid())
  );

-- Schedules: org-scoped
CREATE POLICY "Org-scoped schedules" ON schedules
  FOR ALL USING (
    organization_id IN (SELECT org_id FROM profiles WHERE user_id = auth.uid())
  );

-- Notifications: user can only see their own
CREATE POLICY "User-scoped notifications" ON notifications
  FOR ALL USING (user_id = auth.uid());

-- Audit log: org-scoped, read-only for non-admins
CREATE POLICY "Org-scoped audit log read" ON audit_log
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Allow audit log insert" ON audit_log
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT org_id FROM profiles WHERE user_id = auth.uid())
  );

-- ============================================================
-- 10. IMMUTABILITY: Prevent editing signed inspections (ESIGN compliance)
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_signed_inspection_edit()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.signature_url IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify a signed inspection record (ESIGN compliance)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_signed_immutability') THEN
    CREATE TRIGGER enforce_signed_immutability
      BEFORE UPDATE OR DELETE ON inspections
      FOR EACH ROW EXECUTE FUNCTION prevent_signed_inspection_edit();
  END IF;
END $$;

-- ============================================================
-- 11. FEATURE GATING AT DB LEVEL (prevent free plan bypass)
-- ============================================================

-- Free plan: max 10 inspections per month
CREATE OR REPLACE FUNCTION enforce_inspection_limits()
RETURNS TRIGGER AS $$
DECLARE
  org_plan TEXT;
  monthly_count INT;
BEGIN
  SELECT plan INTO org_plan FROM organizations WHERE id = NEW.organization_id;

  IF org_plan = 'free' THEN
    -- Check monthly inspection count
    SELECT COUNT(*) INTO monthly_count
    FROM inspections
    WHERE organization_id = NEW.organization_id
      AND created_at >= date_trunc('month', now());

    IF monthly_count >= 10 THEN
      RAISE EXCEPTION 'Free plan limit: 10 inspections per month. Upgrade to Pro for unlimited.';
    END IF;

    -- Free plan cannot use signatures
    IF NEW.signature_url IS NOT NULL THEN
      RAISE EXCEPTION 'Digital signatures require a Pro or Enterprise plan.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_plan_limits') THEN
    CREATE TRIGGER enforce_plan_limits
      BEFORE INSERT ON inspections
      FOR EACH ROW EXECUTE FUNCTION enforce_inspection_limits();
  END IF;
END $$;
