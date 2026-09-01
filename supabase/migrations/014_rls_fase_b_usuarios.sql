-- ==============================================================================
-- Migración 014: FASE B - Paso 1: Habilitar RLS y Cerrar Acceso Anónimo en 'usuarios'
-- Sistema DUREY
-- ==============================================================================

BEGIN;

-- 1. Habilitar RLS en la tabla usuarios
ALTER TABLE IF EXISTS public.usuarios ENABLE ROW LEVEL SECURITY;

-- 2. Revocar todos los permisos directos al rol anónimo (anon)
REVOKE ALL ON TABLE public.usuarios FROM anon;

-- 3. Conceder permisos completos a los roles autenticados y service_role
GRANT ALL ON TABLE public.usuarios TO authenticated, service_role;

-- 4. Crear política RLS permisiva para cualquier usuario autenticado con JWT
DROP POLICY IF EXISTS "permitir_authenticated_usuarios" ON public.usuarios;

CREATE POLICY "permitir_authenticated_usuarios" ON public.usuarios
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
