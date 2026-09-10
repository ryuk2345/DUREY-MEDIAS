-- ==============================================================================
-- Migración 019: Tabla modelos_media (catálogo de tipos de media editable)
-- Reemplaza el array hardcodeado ['Tobillera', 'Media larga', ...] del frontend
-- por una tabla gestionable desde la UI, sin romper productos existentes.
-- ==============================================================================

BEGIN;

-- 1. Crear tabla modelos_media
CREATE TABLE IF NOT EXISTS public.modelos_media (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre     TEXT NOT NULL UNIQUE,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Insertar los 5 modelos actuales en el mismo orden que aparecen en el frontend
INSERT INTO public.modelos_media (nombre) VALUES
  ('Tobillera'),
  ('Media larga'),
  ('Media corta'),
  ('Calcetín ejecutivo'),
  ('Media deportiva')
ON CONFLICT (nombre) DO NOTHING;

-- 3. RLS deshabilitado (mismo patrón que marcas_maquinas y todas las tablas del sistema)
ALTER TABLE public.modelos_media DISABLE ROW LEVEL SECURITY;

-- 4. Permisos para todos los roles de Supabase
GRANT ALL ON TABLE public.modelos_media TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- NOTA: Los productos existentes en catalogo_medias NO se ven afectados.
-- El campo catalogo_medias.modelo es TEXT libre — seguirá almacenando y leyendo
-- el nombre del modelo como texto plano. No se agrega FK intencionalmente para
-- mantener retrocompatibilidad con registros históricos.

COMMIT;
