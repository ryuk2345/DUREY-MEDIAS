-- ==============================================================================
-- REVERSIÓN de la migración 031 (mantenimiento preventivo e historia clínica)
--
-- Usar SOLO si, después de la 031, Mantenimiento o Máquinas dejan de funcionar.
-- ATENCIÓN: borra los planes y el registro de mantenimientos preventivos. El
-- stock que movieron los repuestos usados NO se deshace, y una máquina que
-- estuviera en un preventivo en curso queda en "mantenimiento" (cámbiala a mano).
-- Requiere confirmación escrita del dueño antes de ejecutarse en la base real.
-- ==============================================================================

BEGIN;

DROP VIEW IF EXISTS public.vista_historia_maquina;
DROP FUNCTION IF EXISTS public.terminar_mantenimiento_preventivo(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.quitar_repuesto_de_mantenimiento(UUID);
DROP FUNCTION IF EXISTS public.usar_repuesto_en_mantenimiento(UUID, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.iniciar_mantenimiento_preventivo(UUID, UUID);
DROP TABLE IF EXISTS public.mantenimiento_repuestos;
DROP TABLE IF EXISTS public.mantenimientos_preventivos;
DROP TABLE IF EXISTS public.planes_mantenimiento;

COMMIT;
