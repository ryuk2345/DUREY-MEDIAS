-- ==============================================================================
-- REVERSIÓN de la migración 033 (crudo, Volteado, Tintorería y bloqueo por rol)
--
-- Usar SOLO si, después de la 033, la producción deja de funcionar.
-- ATENCIÓN: borra los lotes de tintorería y el stock por teñir, y las medias crudas
-- creadas por la 033 que no se hayan usado (las usadas se quedan, marcadas como crudas
-- hasta quitar la columna: entonces quedan como productos normales con color "CRUDO").
-- Los usuarios con rol volteador o tintorero deben cambiarse de rol antes.
-- Requiere confirmación escrita del dueño antes de ejecutarse en la base real.
-- ==============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.recibir_lote_tintoreria(UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.enviar_lote_tintoreria(UUID, UUID, TEXT, NUMERIC, UUID);
DROP FUNCTION IF EXISTS public.reportar_lote_volteado(UUID, NUMERIC, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.iniciar_lote_volteado(UUID, UUID, NUMERIC);

-- Funciones como estaban en la 032 (texto exacto de la base)
CREATE OR REPLACE FUNCTION public.iniciar_lote_remallado(p_maquina_id uuid, p_remalladora_id uuid, p_catalogo_media_id uuid, p_docenas numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_maq     RECORD;
  v_lote_id UUID;
BEGIN
  IF p_remalladora_id IS NULL THEN RAISE EXCEPTION 'Selecciona una operadora remalladora'; END IF;
  IF p_catalogo_media_id IS NULL THEN RAISE EXCEPTION 'Selecciona el tipo de media a remallar'; END IF;
  IF COALESCE(p_docenas, 0) <= 0 THEN RAISE EXCEPTION 'Las docenas asignadas deben ser mayores a 0'; END IF;

  SELECT codigo, estado INTO v_maq FROM maquinas WHERE id = p_maquina_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona una máquina remalladora'; END IF;
  IF v_maq.estado <> 'activa' THEN
    RAISE EXCEPTION 'La máquina % no está disponible (estado: %)', v_maq.codigo, v_maq.estado;
  END IF;

  INSERT INTO lotes_remallado (catalogo_media_id, remalladora_id, maquina_remalladora_id, docenas_asignadas, docenas_pendientes, estado)
  VALUES (p_catalogo_media_id, p_remalladora_id, p_maquina_id, p_docenas, p_docenas, 'en_proceso')
  RETURNING id INTO v_lote_id;

  UPDATE maquinas SET estado = 'ocupada' WHERE id = p_maquina_id;
  UPDATE usuarios SET estado = 'ocupada' WHERE id = p_remalladora_id;

  RETURN v_lote_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.traspasar_lote_remallado(p_lote_origen_id uuid, p_remalladora_destino_id uuid, p_maquina_destino_id uuid, p_docenas numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_origen  RECORD;
  v_maq     RECORD;
  v_lote_id UUID;
BEGIN
  IF COALESCE(p_docenas, 0) <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF p_remalladora_destino_id IS NULL THEN RAISE EXCEPTION 'Selecciona la remalladora destino'; END IF;

  SELECT id, catalogo_media_id, docenas_pendientes, estado INTO v_origen
    FROM lotes_remallado WHERE id = p_lote_origen_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote de origen no encontrado'; END IF;
  IF v_origen.estado <> 'en_proceso' THEN
    RAISE EXCEPTION 'Solo se puede traspasar desde un lote en proceso (estado: %)', v_origen.estado;
  END IF;
  IF p_docenas > v_origen.docenas_pendientes THEN
    RAISE EXCEPTION 'La cantidad a traspasar (%) excede las docenas pendientes del lote de origen (%)', p_docenas, v_origen.docenas_pendientes;
  END IF;

  SELECT codigo, estado INTO v_maq FROM maquinas WHERE id = p_maquina_destino_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona la máquina destino'; END IF;
  IF v_maq.estado <> 'activa' THEN
    RAISE EXCEPTION 'La máquina destino % no está disponible (estado: %)', v_maq.codigo, v_maq.estado;
  END IF;

  UPDATE lotes_remallado SET docenas_pendientes = docenas_pendientes - p_docenas WHERE id = p_lote_origen_id;

  INSERT INTO lotes_remallado (catalogo_media_id, remalladora_id, maquina_remalladora_id, docenas_asignadas, docenas_pendientes, estado)
  VALUES (v_origen.catalogo_media_id, p_remalladora_destino_id, p_maquina_destino_id, p_docenas, p_docenas, 'en_proceso')
  RETURNING id INTO v_lote_id;

  UPDATE maquinas SET estado = 'ocupada' WHERE id = p_maquina_destino_id;
  UPDATE usuarios SET estado = 'ocupada' WHERE id = p_remalladora_destino_id;

  RETURN v_lote_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalizar_lote_remallado(p_lote_id uuid, p_docenas_remalladas numeric, p_docenas_restantes numeric, p_catalogo_media_id uuid, p_remalladora_id uuid, p_maquina_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- 1. INSERT en reportes_remallado
  INSERT INTO reportes_remallado (
    lote_id,
    remalladora_id,
    maquina_id,
    docenas_remalladas,
    docenas_restantes,
    fecha
  ) VALUES (
    p_lote_id,
    p_remalladora_id,
    p_maquina_id,
    p_docenas_remalladas,
    p_docenas_restantes,
    CURRENT_DATE
  );

  -- 2. UPDATE lotes_remallado
  UPDATE lotes_remallado
  SET estado = 'completado',
      docenas_pendientes = p_docenas_restantes
  WHERE id = p_lote_id;

  -- 3. UPSERT en stock_listo_planchar (en lugar de stock_listo_voltear)
  INSERT INTO stock_listo_planchar (catalogo_media_id, docenas)
  VALUES (p_catalogo_media_id, p_docenas_remalladas)
  ON CONFLICT (catalogo_media_id)
  DO UPDATE SET docenas = stock_listo_planchar.docenas + p_docenas_remalladas,
                updated_at = NOW();

  -- 4. UPDATE usuarios (liberar operadora si existe)
  IF p_remalladora_id IS NOT NULL THEN
    UPDATE usuarios
    SET estado = 'disponible'
    WHERE id = p_remalladora_id;
  END IF;

  -- 5. UPDATE maquinas (liberar máquina si existe)
  IF p_maquina_id IS NOT NULL THEN
    UPDATE maquinas
    SET estado = 'activa'
    WHERE id = p_maquina_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_produccion_tejido(p_fecha date, p_horario text, p_encargado_id uuid, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hoy   DATE := (NOW() AT TIME ZONE 'America/Lima')::date;
  v_fecha DATE := COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Lima')::date);
  v_turno RECORD;
  v_tid   UUID;
  v_r     RECORD;
  v_req   RECORD;
  v_mp    RECORD;
BEGIN
  IF p_horario IS NULL OR p_horario NOT IN ('dia', 'noche') THEN RAISE EXCEPTION 'Elige el turno: día o noche'; END IF;
  IF v_fecha > v_hoy THEN RAISE EXCEPTION 'No se registra producción de una fecha futura'; END IF;
  IF p_encargado_id IS NULL OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_encargado_id AND activo) THEN
    RAISE EXCEPTION 'Elige el encargado del turno';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Anota la producción de al menos una máquina';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS t_items_tejido (maquina_id UUID, docenas NUMERIC, operario_id UUID) ON COMMIT DROP;
  TRUNCATE t_items_tejido;
  INSERT INTO t_items_tejido SELECT * FROM jsonb_to_recordset(p_items) AS i(maquina_id UUID, docenas NUMERIC, operario_id UUID);
  IF EXISTS (SELECT 1 FROM t_items_tejido WHERE maquina_id IS NULL) THEN RAISE EXCEPTION 'Falta la máquina en una fila'; END IF;
  IF (SELECT count(*) <> count(DISTINCT maquina_id) FROM t_items_tejido) THEN RAISE EXCEPTION 'Una máquina aparece más de una vez'; END IF;
  IF EXISTS (SELECT 1 FROM t_items_tejido WHERE docenas IS NULL OR docenas = 'NaN'::numeric OR docenas < 0 OR docenas > 10000) THEN
    RAISE EXCEPTION 'Las docenas deben ser un número entre 0 y 10 000';
  END IF;
  IF EXISTS (SELECT 1 FROM t_items_tejido i WHERE i.operario_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = i.operario_id AND u.activo)) THEN
    RAISE EXCEPTION 'Elige el operario de cada máquina';
  END IF;

  -- Máquinas: bloqueadas en orden; tejedoras, en marcha y con producto vigente
  PERFORM 1 FROM maquinas WHERE id IN (SELECT maquina_id FROM t_items_tejido) ORDER BY id FOR UPDATE;
  FOR v_r IN
    SELECT i.maquina_id, m.codigo, m.tipo, m.estado, pm.catalogo_media_id
      FROM t_items_tejido i
      LEFT JOIN maquinas m ON m.id = i.maquina_id
      LEFT JOIN productos_maquina pm ON pm.maquina_id = i.maquina_id AND pm.hasta IS NULL
     ORDER BY m.codigo
  LOOP
    IF v_r.codigo IS NULL THEN RAISE EXCEPTION 'Una de las máquinas no existe'; END IF;
    IF v_r.tipo <> 'tejedora' THEN RAISE EXCEPTION 'La máquina % no es tejedora', v_r.codigo; END IF;
    IF v_r.estado IN ('malograda', 'mantenimiento', 'inactiva') THEN
      RAISE EXCEPTION 'La máquina % está % y no registra producción', v_r.codigo, v_r.estado;
    END IF;
    IF v_r.catalogo_media_id IS NULL THEN RAISE EXCEPTION 'La máquina % no tiene producto asignado', v_r.codigo; END IF;
  END LOOP;

  -- Turno de esa fecha y horario (se crea la primera vez)
  INSERT INTO turnos_produccion (tejedor_id, fecha, horario, duracion_horas, estado, registro_24_6)
  VALUES (p_encargado_id, v_fecha, p_horario, 12, 'cerrado', true)
  ON CONFLICT (fecha, horario) WHERE registro_24_6 DO NOTHING;
  SELECT id, tejedor_id INTO v_turno FROM turnos_produccion WHERE fecha = v_fecha AND horario = p_horario AND registro_24_6 FOR UPDATE;
  v_tid := v_turno.id;
  IF v_turno.tejedor_id IS DISTINCT FROM p_encargado_id THEN
    RAISE EXCEPTION 'El turno ya tiene otro encargado (%)', (SELECT nombre FROM usuarios WHERE id = v_turno.tejedor_id);
  END IF;
  SELECT m.codigo INTO v_r FROM reportes_produccion r JOIN maquinas m ON m.id = r.maquina_id
   WHERE r.turno_id = v_tid AND r.maquina_id IN (SELECT maquina_id FROM t_items_tejido) ORDER BY m.codigo LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'La máquina % ya está registrada en este turno', v_r.codigo; END IF;

  -- Hilo por las docenas reales: docenas × peso por docena (bloqueando cada materia prima)
  FOR v_req IN
    SELECT c.materia_prima_id, SUM(i.docenas * COALESCE(c.peso_docena_g, 360) / 1000.0) AS necesario
      FROM t_items_tejido i
      JOIN productos_maquina pm ON pm.maquina_id = i.maquina_id AND pm.hasta IS NULL
      JOIN catalogo_medias c ON c.id = pm.catalogo_media_id
     WHERE c.materia_prima_id IS NOT NULL AND i.docenas > 0
     GROUP BY c.materia_prima_id ORDER BY c.materia_prima_id
  LOOP
    SELECT material, color, stock_kg INTO v_mp FROM materia_prima WHERE id = v_req.materia_prima_id FOR UPDATE;
    IF v_mp.stock_kg < v_req.necesario THEN
      RAISE EXCEPTION 'Falta de materia prima: se requieren % kg de % % pero solo quedan % kg',
        round(v_req.necesario, 2), v_mp.material, v_mp.color, round(v_mp.stock_kg, 2);
    END IF;
    UPDATE materia_prima SET stock_kg = stock_kg - v_req.necesario WHERE id = v_req.materia_prima_id;
    INSERT INTO movimientos_materia_prima (materia_prima_id, tipo, cantidad_kg, referencia_id)
    VALUES (v_req.materia_prima_id, 'consumo_produccion', v_req.necesario, v_tid);
  END LOOP;

  INSERT INTO reportes_produccion (turno_id, maquina_id, catalogo_media_id, docenas_producidas, fecha, operario_id, registrado_por)
  SELECT v_tid, i.maquina_id, pm.catalogo_media_id, round(i.docenas, 2), v_fecha, i.operario_id, auth.uid()
    FROM t_items_tejido i
    JOIN productos_maquina pm ON pm.maquina_id = i.maquina_id AND pm.hasta IS NULL;
  RETURN v_tid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_produccion_planchado(p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
       OR i.docenas_planchadas = 'NaN'::numeric OR i.docenas_defectuosas = 'NaN'::numeric
  ) THEN
    RAISE EXCEPTION 'Las docenas no pueden ser negativas';
  END IF;

  FOR v_req IN
    SELECT i.catalogo_media_id, SUM(COALESCE(i.docenas_planchadas, 0) + COALESCE(i.docenas_defectuosas, 0)) AS total,
           SUM(COALESCE(i.docenas_planchadas, 0)) AS buenas
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
    IF v_req.buenas > 0 THEN
      INSERT INTO stock_listo_preparar (catalogo_media_id, docenas) VALUES (v_req.catalogo_media_id, v_req.buenas)
      ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_preparar.docenas + EXCLUDED.docenas, updated_at = NOW();
    END IF;
  END LOOP;

  INSERT INTO reportes_planchado (planchador_id, catalogo_media_id, docenas_planchadas, docenas_defectuosas, fecha)
  SELECT i.planchador_id, i.catalogo_media_id, COALESCE(i.docenas_planchadas, 0), COALESCE(i.docenas_defectuosas, 0),
         (NOW() AT TIME ZONE 'America/Lima')::date
    FROM jsonb_to_recordset(p_items) AS i(planchador_id UUID, catalogo_media_id UUID, docenas_planchadas NUMERIC, docenas_defectuosas NUMERIC)
   WHERE COALESCE(i.docenas_planchadas, 0) + COALESCE(i.docenas_defectuosas, 0) > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_produccion_preparado(p_preparador_id uuid, p_codigo_paquete text, p_ubicacion_id uuid, p_items jsonb, p_qr_data text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req     RECORD;
  v_stock   NUMERIC;
  v_media   TEXT;
  v_total   NUMERIC;
  v_paq     UUID;
BEGIN
  IF p_preparador_id IS NULL OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_preparador_id AND activo) THEN
    RAISE EXCEPTION 'Elige el preparador';
  END IF;
  IF p_codigo_paquete IS NULL OR btrim(p_codigo_paquete) = '' THEN RAISE EXCEPTION 'Falta el código del saco'; END IF;
  IF p_ubicacion_id IS NULL OR NOT EXISTS (SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_id AND activo) THEN
    RAISE EXCEPTION 'Elige el salón que recibe el saco';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Anota las docenas preparadas';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS t_items_preparado (catalogo_media_id UUID, docenas NUMERIC, defectuosas NUMERIC) ON COMMIT DROP;
  TRUNCATE t_items_preparado;
  INSERT INTO t_items_preparado SELECT * FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, defectuosas NUMERIC);
  IF EXISTS (SELECT 1 FROM t_items_preparado WHERE catalogo_media_id IS NULL
             OR COALESCE(docenas, 0) < 0 OR COALESCE(defectuosas, 0) < 0
             OR docenas = 'NaN'::numeric OR defectuosas = 'NaN'::numeric) THEN
    RAISE EXCEPTION 'Las docenas no pueden ser negativas';
  END IF;
  SELECT COALESCE(sum(COALESCE(docenas, 0)), 0) INTO v_total FROM t_items_preparado;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El saco debe llevar al menos una docena preparada'; END IF;

  FOR v_req IN
    SELECT catalogo_media_id, SUM(COALESCE(docenas, 0) + COALESCE(defectuosas, 0)) AS total
      FROM t_items_preparado GROUP BY catalogo_media_id
     HAVING SUM(COALESCE(docenas, 0) + COALESCE(defectuosas, 0)) > 0
     ORDER BY catalogo_media_id
  LOOP
    SELECT docenas INTO v_stock FROM stock_listo_preparar WHERE catalogo_media_id = v_req.catalogo_media_id FOR UPDATE;
    IF COALESCE(v_stock, 0) < v_req.total THEN
      SELECT codigo INTO v_media FROM catalogo_medias WHERE id = v_req.catalogo_media_id;
      RAISE EXCEPTION 'No hay suficiente stock por preparar de %: se registran % docenas y hay %',
        COALESCE(v_media, 'la media'), v_req.total, COALESCE(v_stock, 0);
    END IF;
    UPDATE stock_listo_preparar SET docenas = docenas - v_req.total, updated_at = NOW()
     WHERE catalogo_media_id = v_req.catalogo_media_id;
  END LOOP;

  INSERT INTO paquetes (codigo_paquete, preparador_id, catalogo_media_id, docenas, total_pares, qr_data, detalles_contenido, estado, ubicacion_id, fecha)
  VALUES (btrim(p_codigo_paquete), p_preparador_id,
          (SELECT catalogo_media_id FROM t_items_preparado WHERE COALESCE(docenas, 0) > 0 ORDER BY docenas DESC, catalogo_media_id LIMIT 1),
          v_total, round(v_total * 12), p_qr_data,
          (SELECT jsonb_agg(jsonb_build_object('catalogo_media_id', c.id, 'sku', COALESCE(c.sku, 'SKU-' || upper(c.codigo)), 'codigo', c.codigo,
                                               'docenas', x.docenas, 'pares', round(x.docenas * 12)) ORDER BY c.codigo)
             FROM (SELECT catalogo_media_id, SUM(COALESCE(docenas, 0)) AS docenas FROM t_items_preparado GROUP BY catalogo_media_id
                    HAVING SUM(COALESCE(docenas, 0)) > 0) x
             JOIN catalogo_medias c ON c.id = x.catalogo_media_id),
          'pendiente_almacenar', p_ubicacion_id,
          (NOW() AT TIME ZONE 'America/Lima')::date)
  RETURNING id INTO v_paq;

  INSERT INTO reportes_preparado (preparador_id, catalogo_media_id, paquete_id, docenas_preparadas, docenas_defectuosas, registrado_por)
  SELECT p_preparador_id, catalogo_media_id, v_paq, SUM(COALESCE(docenas, 0)), SUM(COALESCE(defectuosas, 0)), auth.uid()
    FROM t_items_preparado GROUP BY catalogo_media_id
   HAVING SUM(COALESCE(docenas, 0) + COALESCE(defectuosas, 0)) > 0;
  RETURN v_paq;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ingresar_stock_fuera(p_etapa text, p_catalogo_media_id uuid, p_docenas numeric, p_origen text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prod RECORD;
  v_id   UUID;
BEGIN
  IF p_etapa IS NULL OR p_etapa NOT IN ('planchado', 'preparado') THEN RAISE EXCEPTION 'Elige la etapa en la que están las medias'; END IF;
  IF p_docenas IS NULL OR p_docenas = 'NaN'::numeric OR p_docenas <= 0 OR p_docenas > 100000 THEN
    RAISE EXCEPTION 'Las docenas deben ser mayores a 0';
  END IF;
  IF p_origen IS NULL OR btrim(p_origen) = '' THEN RAISE EXCEPTION 'Indica de dónde vienen las medias'; END IF;
  SELECT id, codigo, estado INTO v_prod FROM catalogo_medias WHERE id = p_catalogo_media_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elige el producto'; END IF;

  IF p_etapa = 'planchado' THEN
    INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES (p_catalogo_media_id, round(p_docenas, 2))
    ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_planchar.docenas + EXCLUDED.docenas, updated_at = NOW();
  ELSE
    INSERT INTO stock_listo_preparar (catalogo_media_id, docenas) VALUES (p_catalogo_media_id, round(p_docenas, 2))
    ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_preparar.docenas + EXCLUDED.docenas, updated_at = NOW();
  END IF;
  INSERT INTO ingresos_stock_fuera (etapa, catalogo_media_id, docenas, origen, registrado_por)
  VALUES (p_etapa, p_catalogo_media_id, round(p_docenas, 2), btrim(p_origen), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;


DROP FUNCTION IF EXISTS public.exigir_modulo(TEXT);
DROP TRIGGER IF EXISTS catalogo_medias_proteger_es_crudo ON public.catalogo_medias;
DROP FUNCTION IF EXISTS public.proteger_es_crudo();
DROP FUNCTION IF EXISTS public.crear_crudos_faltantes();
DROP INDEX IF EXISTS public.catalogo_medias_un_crudo_uq;
GRANT INSERT ON TABLE public.paquetes TO authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE public.turnos_produccion, public.turno_maquinas, public.reportes_produccion, public.lotes_remallado, public.reportes_remallado, public.stock_listo_voltear, public.lotes_volteado, public.reportes_volteado, public.stock_listo_planchar, public.reportes_planchado TO authenticated;
GRANT EXECUTE ON FUNCTION public.cargar_lote_produccion(UUID, TEXT, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_turno_produccion(UUID, JSONB) TO authenticated;

-- Ingresos de fuera de las etapas nuevas: se quitan para volver al CHECK de la 032
DELETE FROM public.ingresos_stock_fuera WHERE etapa NOT IN ('planchado', 'preparado');
ALTER TABLE public.ingresos_stock_fuera DROP CONSTRAINT IF EXISTS ingresos_stock_fuera_etapa_check;
ALTER TABLE public.ingresos_stock_fuera ADD CONSTRAINT ingresos_stock_fuera_etapa_check CHECK (etapa IN ('planchado', 'preparado'));

DROP TABLE IF EXISTS public.lotes_tintoreria;
DROP TABLE IF EXISTS public.stock_listo_tenir;
-- Medias crudas sin uso
DELETE FROM public.catalogo_medias c WHERE c.es_crudo AND c.codigo LIKE 'CRUDO-%'
   AND NOT EXISTS (SELECT 1 FROM public.productos_maquina x WHERE x.catalogo_media_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.reportes_produccion x WHERE x.catalogo_media_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.lotes_remallado x WHERE x.catalogo_media_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.stock_listo_voltear x WHERE x.catalogo_media_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.lotes_volteado x WHERE x.catalogo_media_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.reportes_volteado x WHERE x.catalogo_media_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.ingresos_stock_fuera x WHERE x.catalogo_media_id = c.id);
ALTER TABLE public.catalogo_medias DROP COLUMN IF EXISTS es_crudo;

DROP TABLE IF EXISTS public.modulos_por_rol;
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol = ANY (ARRAY[
  'admin', 'supervisor', 'disenador', 'tejedor', 'remalladora', 'remallador', 'planchador',
  'preparador', 'almacenero', 'vendedora', 'operador']));

COMMIT;
