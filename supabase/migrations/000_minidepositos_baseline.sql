-- =====================================================
-- MIGRACIÓN 000: Baseline Retroactivo de Minidepositos
-- =====================================================
-- Esta tabla forma parte del núcleo operacional (Tejido → Remallado).
-- Se documenta de forma idempotente para garantizar que cualquier 
-- reconstrucción limpia del schema la incluya de forma correcta.

CREATE TABLE IF NOT EXISTS minidepositos (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogo_media_id   UUID NOT NULL REFERENCES catalogo_medias(id),
  horario             TEXT NOT NULL CHECK (horario IN ('dia','noche')),
  total_docenas       NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(catalogo_media_id, horario)
);

-- Índices de optimización
CREATE INDEX IF NOT EXISTS idx_minidepositos_media ON minidepositos(catalogo_media_id);

-- Desactivar Row Level Security para coincidir con la arquitectura del proyecto
ALTER TABLE minidepositos DISABLE ROW LEVEL SECURITY;
