-- ==============================================================================
-- REVERSIÓN de la migración 028 (search_path fijo y vista security_invoker)
--
-- Usar SOLO si, después de la 028, el stock deja de verse o una de estas
-- funciones falla con "does not exist". Deja la vista y las cinco funciones
-- como estaban antes. No toca datos ni permisos.
-- ==============================================================================

BEGIN;

ALTER VIEW public.vista_stock_medias RESET (security_invoker);

-- Las cinco funciones que no tenían search_path antes de la 028
ALTER FUNCTION public._siguiente_codigo(TEXT, INTEGER, BIGINT, INTEGER) RESET search_path;
ALTER FUNCTION public.finalizar_lote_remallado(UUID, NUMERIC, NUMERIC, UUID, UUID, UUID) RESET search_path;
ALTER FUNCTION public.asignar_diseno_a_maquinas(UUID, UUID[]) RESET search_path;
ALTER FUNCTION public.actualizar_estado_muestra_diseno(UUID, TEXT, TEXT) RESET search_path;
ALTER FUNCTION public.registrar_diseno_con_asignaciones(TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, INTEGER, TEXT, UUID[]) RESET search_path;

COMMIT;
