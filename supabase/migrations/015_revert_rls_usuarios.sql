-- ==============================================================================
-- Migración 015: ROLLBACK INMEDIATO DE RLS EN 'usuarios'
-- Restaura la operación normal y desbloquea Producción (Tejedores) y Ventas
-- ==============================================================================

BEGIN;

ALTER TABLE IF EXISTS public.usuarios DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.usuarios TO anon, authenticated, service_role;
DROP POLICY IF EXISTS "permitir_authenticated_usuarios" ON public.usuarios;

COMMIT;
