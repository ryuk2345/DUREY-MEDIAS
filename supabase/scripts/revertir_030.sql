-- ==============================================================================
-- REVERSIÓN de la migración 030 (permisos de authenticated en tablas nuevas)
--
-- Usar SOLO si, después de la 030, alguna pantalla con sesión recibe
-- "permission denied" al leer o guardar agencias, pagos a proveedores,
-- mecánicos, compras de repuestos o repuestos usados. Devuelve a esas 5 tablas
-- todos los permisos para authenticated (como antes de la 030) y restaura los
-- permisos por defecto de Supabase para tablas nuevas. No toca datos.
-- ==============================================================================

BEGIN;

GRANT ALL ON TABLE public.agencias, public.pagos_proveedores, public.mecanicos,
                   public.compras_repuestos, public.averia_repuestos TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;

COMMIT;
