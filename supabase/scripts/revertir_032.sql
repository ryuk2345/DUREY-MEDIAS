-- ==============================================================================
-- REVERSIÓN de la migración 032 (tejido 24/6, preparado, stock de fuera)
--
-- Usar SOLO si, después de la 032, Tejido, Planchado o Preparado dejan de funcionar.
-- ATENCIÓN: borra los productos fijos de las máquinas, el stock por preparar,
-- los reportes de preparado y los ingresos de stock de fuera. Los registros de
-- tejido hechos con la 032 quedan en reportes_produccion sin su operario, y el
-- hilo ya descontado no se devuelve. Los sacos creados siguen en paquetes.
-- Requiere confirmación escrita del dueño antes de ejecutarse en la base real.
-- ==============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.ingresar_stock_fuera(TEXT, UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.registrar_produccion_preparado(UUID, TEXT, UUID, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.corregir_produccion_tejido(UUID, NUMERIC, UUID);
DROP FUNCTION IF EXISTS public.registrar_produccion_tejido(DATE, TEXT, UUID, JSONB);
DROP FUNCTION IF EXISTS public.asignar_producto_maquina(UUID, UUID);
DROP FUNCTION IF EXISTS public.exigir_admin_o_supervisor(TEXT);

-- Planchado vuelve a la versión de la 022 (sin sumar a por preparar)
CREATE OR REPLACE FUNCTION public.registrar_produccion_planchado(
  p_items JSONB
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req   RECORD;
  v_stock NUMERIC;
  v_media TEXT;
  v_n     INTEGER;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS i(planchador_id UUID, catalogo_media_id UUID, docenas_planchadas NUMERIC, docenas_defectuosas NUMERIC)
    WHERE COALESCE(i.docenas_planchadas, 0) + COALESCE(i.docenas_defectuosas, 0) > 0
  ) THEN
    RAISE EXCEPTION 'Ingresa al menos una docena planchada o defectuosa para guardar';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS i(planchador_id UUID, catalogo_media_id UUID, docenas_planchadas NUMERIC, docenas_defectuosas NUMERIC)
    WHERE COALESCE(i.docenas_planchadas, 0) < 0 OR COALESCE(i.docenas_defectuosas, 0) < 0 OR i.catalogo_media_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Las docenas no pueden ser negativas';
  END IF;

  FOR v_req IN
    SELECT i.catalogo_media_id, SUM(COALESCE(i.docenas_planchadas, 0) + COALESCE(i.docenas_defectuosas, 0)) AS total
      FROM jsonb_to_recordset(p_items) AS i(planchador_id UUID, catalogo_media_id UUID, docenas_planchadas NUMERIC, docenas_defectuosas NUMERIC)
     GROUP BY i.catalogo_media_id
     HAVING SUM(COALESCE(i.docenas_planchadas, 0) + COALESCE(i.docenas_defectuosas, 0)) > 0
     ORDER BY i.catalogo_media_id
  LOOP
    SELECT docenas INTO v_stock FROM stock_listo_planchar WHERE catalogo_media_id = v_req.catalogo_media_id FOR UPDATE;
    IF COALESCE(v_stock, 0) < v_req.total THEN
      SELECT codigo INTO v_media FROM catalogo_medias WHERE id = v_req.catalogo_media_id;
      RAISE EXCEPTION 'No hay suficiente stock listo para planchar de %: se registran % docenas y hay %',
        COALESCE(v_media, 'la media'), v_req.total, COALESCE(v_stock, 0);
    END IF;
    UPDATE stock_listo_planchar SET docenas = docenas - v_req.total, updated_at = NOW()
     WHERE catalogo_media_id = v_req.catalogo_media_id;
  END LOOP;

  INSERT INTO reportes_planchado (planchador_id, catalogo_media_id, docenas_planchadas, docenas_defectuosas, fecha)
  SELECT i.planchador_id, i.catalogo_media_id, COALESCE(i.docenas_planchadas, 0), COALESCE(i.docenas_defectuosas, 0), CURRENT_DATE
    FROM jsonb_to_recordset(p_items) AS i(planchador_id UUID, catalogo_media_id UUID, docenas_planchadas NUMERIC, docenas_defectuosas NUMERIC)
   WHERE COALESCE(i.docenas_planchadas, 0) + COALESCE(i.docenas_defectuosas, 0) > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_n;
END;
$$;

DROP TABLE IF EXISTS public.ingresos_stock_fuera;
DROP TABLE IF EXISTS public.reportes_preparado;
DROP TABLE IF EXISTS public.stock_listo_preparar;
DROP TABLE IF EXISTS public.productos_maquina;
DROP INDEX IF EXISTS public.reportes_produccion_turno_maquina_uq;
ALTER TABLE public.reportes_produccion DROP COLUMN IF EXISTS registrado_por;
ALTER TABLE public.reportes_produccion DROP COLUMN IF EXISTS operario_id;
DROP INDEX IF EXISTS public.turnos_produccion_24_6_uq;
ALTER TABLE public.turnos_produccion DROP COLUMN IF EXISTS registro_24_6;

COMMIT;
