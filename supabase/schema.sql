-- ══════════════════════════════════════════════════════════════════════
--  Value-Add Paris — Schéma Supabase
--  À coller dans l'éditeur SQL de votre projet Supabase
-- ══════════════════════════════════════════════════════════════════════

-- 1. TABLE DES COMPARABLES DVF (partagée entre les utilisateurs)
CREATE TABLE IF NOT EXISTS public.comparables (
  id                BIGSERIAL PRIMARY KEY,
  id_mutation       TEXT,
  date_mutation     DATE,
  rue               TEXT,
  numero            INT,
  code_postal       VARCHAR(10),
  arrondissement    VARCHAR(5),
  surface           DECIMAL(8,1),
  prix              INT,
  prix_m2           INT,
  pieces            SMALLINT,
  nombre_lots       SMALLINT,
  latitude          DECIMAL(10,7),
  longitude         DECIMAL(10,7),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les recherches géographiques et par critères
CREATE INDEX IF NOT EXISTS idx_comps_arr      ON public.comparables(arrondissement);
CREATE INDEX IF NOT EXISTS idx_comps_date     ON public.comparables(date_mutation);
CREATE INDEX IF NOT EXISTS idx_comps_surf     ON public.comparables(surface);
CREATE INDEX IF NOT EXISTS idx_comps_cp       ON public.comparables(code_postal);
CREATE INDEX IF NOT EXISTS idx_comps_pm2      ON public.comparables(prix_m2);

-- 2. TABLE DES BIENS ANALYSÉS
CREATE TABLE IF NOT EXISTS public.properties (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  titre           TEXT,
  adresse         TEXT,
  rue             TEXT,
  code_postal     VARCHAR(10),
  arrondissement  VARCHAR(5),
  surface         DECIMAL(8,1),
  prix            INT,
  etat            VARCHAR(20) DEFAULT 'complet',
  loyer_mensuel   INT,
  travaux_manuel  INT,
  notes           TEXT,
  url             TEXT,
  latitude        DECIMAL(10,7),
  longitude       DECIMAL(10,7),
  pm2_ask         INT,
  pieces          SMALLINT,
  comp_stats      JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLE DES PARAMÈTRES UTILISATEUR
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════
--  SÉCURITÉ (Row Level Security)
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.properties   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparables  ENABLE ROW LEVEL SECURITY;

-- Chaque utilisateur ne voit que ses propres biens
CREATE POLICY "own_properties" ON public.properties
  FOR ALL USING (auth.uid() = user_id);

-- Chaque utilisateur gère ses propres paramètres
CREATE POLICY "own_settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id);

-- Les comparables sont lisibles et insérables par tout utilisateur authentifié
CREATE POLICY "auth_read_comps" ON public.comparables
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_comps" ON public.comparables
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_delete_comps" ON public.comparables
  FOR DELETE USING (auth.role() = 'authenticated');

-- ══════════════════════════════════════════════════════════════════════
--  FONCTION UTILITAIRE : compte par arrondissement
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.count_by_arrondissement()
RETURNS TABLE(arrondissement VARCHAR, count BIGINT) AS $$
  SELECT arrondissement, COUNT(*) FROM public.comparables GROUP BY arrondissement ORDER BY arrondissement;
$$ LANGUAGE SQL SECURITY DEFINER;
