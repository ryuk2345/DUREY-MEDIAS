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

-- Historia clínica vuelve a la versión de la 031 (antes de quitar la columna operario_id)
CREATE OR REPLACE VIEW public.vista_historia_maquina WITH (security_invoker = true) AS
  -- evento_id: identificador único de cada fila (desempate estable al leer la historia por páginas)
  SELECT 'tejido:' || r.id AS evento_id, r.maquina_id, r.fecha, r.created_at AS momento, 'produccion'::text AS tipo, t.horario AS turno,
         c.codigo AS detalle, r.docenas_producidas AS cantidad, NULL::numeric AS costo, u.nombre AS persona, NULL::text AS mecanico
    FROM reportes_produccion r
    LEFT JOIN turnos_produccion t ON t.id = r.turno_id
    LEFT JOIN usuarios u ON u.id = t.tejedor_id
    LEFT JOIN catalogo_medias c ON c.id = r.catalogo_media_id
  UNION ALL
  SELECT 'remallado:' || r.id, r.maquina_id, r.fecha, r.created_at, 'produccion', NULL, c.codigo, r.docenas_remalladas, NULL, u.nombre, NULL
    FROM reportes_remallado r
    LEFT JOIN lotes_remallado l ON l.id = r.lote_id
    LEFT JOIN catalogo_medias c ON c.id = l.catalogo_media_id
    LEFT JOIN usuarios u ON u.id = r.remalladora_id
  UNION ALL
  SELECT 'falla:' || a.id, a.maquina_id, (a.fecha_reporte AT TIME ZONE 'America/Lima')::date, a.fecha_reporte, 'falla', NULL, a.descripcion_operador, NULL, NULL,
         u.nombre, COALESCE(btrim(m.nombre) || ' ' || btrim(m.apellido), a.asignado_a)
    FROM averias_maquinas a
    LEFT JOIN usuarios u ON u.id = a.reportado_por_id
    LEFT JOIN mecanicos m ON m.id = a.mecanico_id
  UNION ALL
  SELECT 'reparacion:' || rp.id, a.maquina_id, (rp.fecha_reparacion AT TIME ZONE 'America/Lima')::date, rp.fecha_reparacion, 'reparacion', NULL, rp.descripcion_tecnico, NULL,
         rp.costo_repuestos + rp.costo_mano_obra, NULL, COALESCE(btrim(m.nombre) || ' ' || btrim(m.apellido), a.asignado_a)
    FROM reparaciones rp
    JOIN averias_maquinas a ON a.id = rp.averia_id
    LEFT JOIN mecanicos m ON m.id = rp.mecanico_id
  UNION ALL
  SELECT 'repuesto_falla:' || ar.id, a.maquina_id, (ar.created_at AT TIME ZONE 'America/Lima')::date, ar.created_at, 'repuesto', NULL, re.nombre, ar.cantidad,
         ar.cantidad * ar.costo_unitario, NULL, COALESCE(btrim(m.nombre) || ' ' || btrim(m.apellido), a.asignado_a)
    FROM averia_repuestos ar
    JOIN averias_maquinas a ON a.id = ar.averia_id
    JOIN repuestos re ON re.id = ar.repuesto_id
    LEFT JOIN mecanicos m ON m.id = ar.mecanico_id
  UNION ALL
  SELECT 'repuesto_preventivo:' || mr.id, mp.maquina_id, (mr.created_at AT TIME ZONE 'America/Lima')::date, mr.created_at, 'repuesto', NULL, re.nombre, mr.cantidad,
         mr.cantidad * mr.costo_unitario, NULL, btrim(m.nombre) || ' ' || btrim(m.apellido)
    FROM mantenimiento_repuestos mr
    JOIN mantenimientos_preventivos mp ON mp.id = mr.mantenimiento_id
    JOIN repuestos re ON re.id = mr.repuesto_id
    LEFT JOIN mecanicos m ON m.id = mp.mecanico_id
  UNION ALL
  SELECT 'preventivo:' || mp.id, mp.maquina_id, (COALESCE(mp.fecha_fin, mp.fecha_inicio) AT TIME ZONE 'America/Lima')::date, COALESCE(mp.fecha_fin, mp.fecha_inicio),
         'preventivo', NULL,
         pl.tarea || CASE WHEN mp.estado = 'en_curso' THEN ' (en curso)' ELSE COALESCE(' — ' || mp.nota, '') END,
         NULL, mp.costo_mano_obra, NULL, btrim(m.nombre) || ' ' || btrim(m.apellido)
    FROM mantenimientos_preventivos mp
    JOIN planes_mantenimiento pl ON pl.id = mp.plan_id
    LEFT JOIN mecanicos m ON m.id = mp.mecanico_id;

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
