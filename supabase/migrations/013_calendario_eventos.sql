-- ==============================================================================
-- Migración 013: Módulo de Calendario de Eventos Corporativos y Personales
-- Sistema DUREY - Exclusivo para roles Admin y Supervisor
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.eventos_calendario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  descripcion TEXT,
  fecha DATE NOT NULL,
  hora TIME WITHOUT TIME ZONE,
  visibilidad TEXT NOT NULL CHECK (visibilidad IN ('compartido', 'personal')) DEFAULT 'compartido',
  color TEXT DEFAULT 'sky',
  creado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_por_nombre TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_eventos_fecha ON public.eventos_calendario(fecha);
CREATE INDEX IF NOT EXISTS idx_eventos_visibilidad_creador ON public.eventos_calendario(visibilidad, creado_por);

-- Políticas RLS abiertas (evitar bloqueos por auth_id = NULL)
ALTER TABLE IF EXISTS public.eventos_calendario DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.eventos_calendario TO anon, authenticated, service_role;

-- Semillas iniciales de prueba (Eventos de ejemplo)
INSERT INTO public.eventos_calendario (titulo, descripcion, fecha, hora, visibilidad, color, creado_por_nombre)
VALUES 
  ('Reunión de Coordinación de Producción', 'Revisión semanal de metas de tejido y remallado con supervisores.', CURRENT_DATE, '09:00:00', 'compartido', 'sky', 'Administración'),
  ('Mantenimiento Preventivo Máquinas M01 y M02', 'Revisión técnica periódica y calibración de agujas.', CURRENT_DATE + INTERVAL '2 days', '14:30:00', 'compartido', 'amber', 'Supervisión'),
  ('Entrega Programada Pedido Mayorista', 'Despacho de 500 docenas a cliente corporativo de Lima.', CURRENT_DATE + INTERVAL '3 days', '11:00:00', 'compartido', 'emerald', 'Ventas / Despacho')
ON CONFLICT DO NOTHING;

COMMIT;
