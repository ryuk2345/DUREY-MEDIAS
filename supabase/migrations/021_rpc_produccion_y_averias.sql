-- ==============================================================================
-- Migración 021: Operaciones atómicas de Producción (tejido) y Averías
--
-- Antes, cada flujo hacía 4-6 escrituras sueltas desde el navegador. Si una
-- fallaba, las anteriores quedaban hechas (turno sin máquinas, hilo descontado
-- sin turno, avería guardada con el turno abierto, etc.) y el stock de hilo se
-- calculaba con un valor leído antes (dos cargas simultáneas perdían un descuento).
--
-- Cada función corre en UNA transacción: o se aplica todo o nada. Además
-- bloquea (FOR UPDATE) las filas que modifica, así dos usuarios no pueden
-- tomar la misma máquina ni descontar el mismo hilo a la vez.
--
-- Las reglas de transición de estado replican lib/domain/machines.ts
-- (validarTransicionEstadoMaquina), que sigue siendo la referencia para la UI.
-- La emulación local está en lib/supabase/mockDb.ts (rpc).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Cargar lote de tejido: turno + máquinas + descuento de hilo
--    p_asignaciones: [{ "maquina_id": uuid, "catalogo_media_id": uuid }, ...]
--    Hilo reservado por máquina: 15 docenas × peso_docena_g (misma regla que
--    usaba app/dashboard/produccion/page.tsx).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cargar_lote_produccion(
  p_tejedor_id     UUID,
  p_horario        TEXT,
  p_duracion_horas INTEGER,
  p_asignaciones   JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_turno_id UUID;
  v_maq      RECORD;
  v_req      RECORD;
  v_mp       RECORD;
BEGIN
  IF p_tejedor_id IS NULL THEN
    RAISE EXCEPTION 'Selecciona un operador de turno (tejedor encargado)';
  END IF;
  IF p_asignaciones IS NULL OR jsonb_typeof(p_asignaciones) <> 'array' OR jsonb_array_length(p_asignaciones) = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos una máquina disponible para cargar';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_asignaciones) AS a(maquina_id UUID, catalogo_media_id UUID)
    WHERE a.maquina_id IS NULL OR a.catalogo_media_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Asigna el código de media a todas las máquinas seleccionadas';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT a.maquina_id)
      FROM jsonb_to_recordset(p_asignaciones) AS a(maquina_id UUID, catalogo_media_id UUID)) THEN
    RAISE EXCEPTION 'Una máquina aparece más de una vez en el lote';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_tejedor_id AND activo) THEN
    RAISE EXCEPTION 'El operador seleccionado no existe o está desactivado';
  END IF;

  -- Bloquear las máquinas y validar que estén libres (activa → ocupada)
  PERFORM 1 FROM maquinas
   WHERE id IN (SELECT a.maquina_id FROM jsonb_to_recordset(p_asignaciones) AS a(maquina_id UUID, catalogo_media_id UUID))
   ORDER BY id FOR UPDATE;

  IF (SELECT count(*) FROM maquinas
       WHERE id IN (SELECT a.maquina_id FROM jsonb_to_recordset(p_asignaciones) AS a(maquina_id UUID, catalogo_media_id UUID)))
     <> jsonb_array_length(p_asignaciones) THEN
    RAISE EXCEPTION 'Una de las máquinas seleccionadas no existe';
  END IF;

  SELECT codigo, estado INTO v_maq FROM maquinas
   WHERE id IN (SELECT a.maquina_id FROM jsonb_to_recordset(p_asignaciones) AS a(maquina_id UUID, catalogo_media_id UUID))
     AND estado <> 'activa'
   ORDER BY codigo LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'La máquina % no está disponible (estado: %)', v_maq.codigo, v_maq.estado;
  END IF;

  -- Validar el stock de hilo (bloqueando cada materia prima)
  FOR v_req IN
    SELECT c.materia_prima_id, SUM(15 * COALESCE(c.peso_docena_g, 360) / 1000.0) AS necesario
      FROM jsonb_to_recordset(p_asignaciones) AS a(maquina_id UUID, catalogo_media_id UUID)
      JOIN catalogo_medias c ON c.id = a.catalogo_media_id
     WHERE c.materia_prima_id IS NOT NULL
     GROUP BY c.materia_prima_id
     ORDER BY c.materia_prima_id
  LOOP
    SELECT material, color, stock_kg INTO v_mp FROM materia_prima WHERE id = v_req.materia_prima_id FOR UPDATE;
    IF v_mp.stock_kg < v_req.necesario THEN
      RAISE EXCEPTION 'Falta de materia prima: se requieren % kg de % % pero solo quedan % kg',
        round(v_req.necesario, 2), v_mp.material, v_mp.color, round(v_mp.stock_kg, 2);
    END IF;
  END LOOP;

  -- Crear el turno y sus asignaciones
  INSERT INTO turnos_produccion (tejedor_id, horario, duracion_horas, estado, fecha)
  VALUES (p_tejedor_id, p_horario, p_duracion_horas, 'activo', CURRENT_DATE)
  RETURNING id INTO v_turno_id;

  INSERT INTO turno_maquinas (turno_id, maquina_id, catalogo_media_id)
  SELECT v_turno_id, a.maquina_id, a.catalogo_media_id
    FROM jsonb_to_recordset(p_asignaciones) AS a(maquina_id UUID, catalogo_media_id UUID);

  -- Descontar hilo (relativo al valor actual, nunca a uno leído antes) y registrar el consumo
  FOR v_req IN
    SELECT c.materia_prima_id, SUM(15 * COALESCE(c.peso_docena_g, 360) / 1000.0) AS necesario
      FROM jsonb_to_recordset(p_asignaciones) AS a(maquina_id UUID, catalogo_media_id UUID)
      JOIN catalogo_medias c ON c.id = a.catalogo_media_id
     WHERE c.materia_prima_id IS NOT NULL
     GROUP BY c.materia_prima_id
  LOOP
    UPDATE materia_prima SET stock_kg = stock_kg - v_req.necesario WHERE id = v_req.materia_prima_id;
    INSERT INTO movimientos_materia_prima (materia_prima_id, tipo, cantidad_kg, referencia_id)
    VALUES (v_req.materia_prima_id, 'consumo_produccion', v_req.necesario, v_turno_id);
  END LOOP;

  UPDATE maquinas SET estado = 'ocupada'
   WHERE id IN (SELECT a.maquina_id FROM jsonb_to_recordset(p_asignaciones) AS a(maquina_id UUID, catalogo_media_id UUID));

  UPDATE usuarios SET estado = 'ocupada' WHERE id = p_tejedor_id;

  RETURN v_turno_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Cerrar turno de tejido registrando la producción
--    p_reportes: [{ "maquina_id": uuid, "docenas": number }, ...]
--    Máquinas sin reporte se registran con 0 docenas.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cerrar_turno_produccion(
  p_turno_id UUID,
  p_reportes JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_turno RECORD;
BEGIN
  SELECT id, tejedor_id, estado INTO v_turno FROM turnos_produccion WHERE id = p_turno_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno no encontrado';
  END IF;
  IF v_turno.estado <> 'activo' THEN
    RAISE EXCEPTION 'Este turno ya fue cerrado';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(COALESCE(p_reportes, '[]'::jsonb)) AS r(maquina_id UUID, docenas NUMERIC)
    WHERE r.docenas < 0
  ) THEN
    RAISE EXCEPTION 'Las docenas producidas no pueden ser negativas';
  END IF;

  INSERT INTO reportes_produccion (turno_id, maquina_id, catalogo_media_id, docenas_producidas, fecha)
  SELECT tm.turno_id, tm.maquina_id, tm.catalogo_media_id, COALESCE(r.docenas, 0), CURRENT_DATE
    FROM turno_maquinas tm
    LEFT JOIN jsonb_to_recordset(COALESCE(p_reportes, '[]'::jsonb)) AS r(maquina_id UUID, docenas NUMERIC)
      ON r.maquina_id = tm.maquina_id
   WHERE tm.turno_id = p_turno_id;

  UPDATE turnos_produccion SET estado = 'cerrado' WHERE id = p_turno_id;

  -- Solo se liberan las máquinas que siguen ocupadas (una malograda se queda así)
  UPDATE maquinas SET estado = 'activa'
   WHERE estado = 'ocupada'
     AND id IN (SELECT maquina_id FROM turno_maquinas WHERE turno_id = p_turno_id);

  -- Liberar al tejedor si no tiene otro turno activo
  UPDATE usuarios SET estado = 'disponible'
   WHERE id = v_turno.tejedor_id
     AND NOT EXISTS (SELECT 1 FROM turnos_produccion WHERE tejedor_id = v_turno.tejedor_id AND estado = 'activo');
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Reportar avería: avería + máquina malograda + cierre del turno activo
--    Al cerrar el turno se liberan también las OTRAS máquinas del lote (antes
--    quedaban 'ocupada' para siempre con el turno ya cerrado).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reportar_averia_maquina(
  p_maquina_id       UUID,
  p_tipo_averia      TEXT,
  p_descripcion      TEXT,
  p_asignado_a       TEXT,
  p_reportado_por_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_maq       RECORD;
  v_turno     RECORD;
  v_averia_id UUID;
  v_cerrados  INTEGER := 0;
BEGIN
  IF COALESCE(btrim(p_descripcion), '') = '' THEN
    RAISE EXCEPTION 'Ingresa la descripción detallada de la falla';
  END IF;

  SELECT id, codigo, estado INTO v_maq FROM maquinas WHERE id = p_maquina_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Máquina no encontrada';
  END IF;
  IF EXISTS (SELECT 1 FROM averias_maquinas WHERE maquina_id = p_maquina_id AND estado IN ('pendiente', 'en_reparacion')) THEN
    RAISE EXCEPTION 'La máquina % ya tiene un reporte de avería activo', v_maq.codigo;
  END IF;
  -- Transiciones permitidas hacia 'malograda': activa, ocupada
  IF v_maq.estado NOT IN ('activa', 'ocupada') THEN
    RAISE EXCEPTION 'No se puede reportar una falla en la máquina % porque está en estado %', v_maq.codigo, v_maq.estado;
  END IF;

  INSERT INTO averias_maquinas (maquina_id, reportado_por_id, tipo_averia, descripcion_operador, estado, asignado_a, nivel, fecha_reporte)
  VALUES (p_maquina_id, p_reportado_por_id, p_tipo_averia, btrim(p_descripcion), 'pendiente', NULLIF(btrim(p_asignado_a), ''), 'CRÍTICO', NOW())
  RETURNING id INTO v_averia_id;

  UPDATE maquinas
     SET estado = 'malograda',
         detalle_estado = 'FALLA ' || COALESCE(NULLIF(btrim(p_tipo_averia), ''), 'REPORTADA')
   WHERE id = p_maquina_id;

  FOR v_turno IN
    SELECT t.id, t.tejedor_id FROM turnos_produccion t
      JOIN turno_maquinas tm ON tm.turno_id = t.id
     WHERE tm.maquina_id = p_maquina_id AND t.estado = 'activo'
     FOR UPDATE OF t
  LOOP
    UPDATE turnos_produccion SET estado = 'cerrado' WHERE id = v_turno.id;
    UPDATE maquinas SET estado = 'activa'
     WHERE estado = 'ocupada'
       AND id IN (SELECT maquina_id FROM turno_maquinas WHERE turno_id = v_turno.id);
    UPDATE usuarios SET estado = 'disponible'
     WHERE id = v_turno.tejedor_id
       AND NOT EXISTS (SELECT 1 FROM turnos_produccion WHERE tejedor_id = v_turno.tejedor_id AND estado = 'activo');
    v_cerrados := v_cerrados + 1;
  END LOOP;

  RETURN jsonb_build_object('averia_id', v_averia_id, 'turnos_cerrados', v_cerrados);
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Iniciar reparación: avería pendiente → en_reparacion, máquina malograda → mantenimiento
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iniciar_reparacion_averia(
  p_averia_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_averia RECORD;
  v_maq    RECORD;
BEGIN
  SELECT id, maquina_id, estado INTO v_averia FROM averias_maquinas WHERE id = p_averia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avería no encontrada';
  END IF;
  IF v_averia.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo se puede iniciar la reparación de una avería pendiente (estado actual: %)', v_averia.estado;
  END IF;

  SELECT codigo, estado INTO v_maq FROM maquinas WHERE id = v_averia.maquina_id FOR UPDATE;
  IF v_maq.estado <> 'malograda' THEN
    RAISE EXCEPTION 'La máquina % debe estar malograda para iniciar la reparación (estado: %)', v_maq.codigo, v_maq.estado;
  END IF;

  UPDATE averias_maquinas SET estado = 'en_reparacion' WHERE id = p_averia_id;
  UPDATE maquinas SET estado = 'mantenimiento', detalle_estado = 'EN REPARACIÓN' WHERE id = v_averia.maquina_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Registrar reparación: reparación + avería resuelta + máquina activa
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_reparacion_averia(
  p_averia_id           UUID,
  p_descripcion_tecnico TEXT,
  p_costo_repuestos     NUMERIC,
  p_costo_mano_obra     NUMERIC,
  p_tecnico_id          UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_averia        RECORD;
  v_maq           RECORD;
  v_reparacion_id UUID;
BEGIN
  IF COALESCE(btrim(p_descripcion_tecnico), '') = '' THEN
    RAISE EXCEPTION 'Completa el diagnóstico técnico';
  END IF;
  IF COALESCE(p_costo_repuestos, 0) < 0 OR COALESCE(p_costo_mano_obra, 0) < 0 THEN
    RAISE EXCEPTION 'Los costos no pueden ser negativos';
  END IF;

  SELECT id, maquina_id, estado INTO v_averia FROM averias_maquinas WHERE id = p_averia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avería no encontrada';
  END IF;
  IF v_averia.estado <> 'en_reparacion' THEN
    RAISE EXCEPTION 'Primero inicia la reparación (estado actual de la avería: %)', v_averia.estado;
  END IF;

  SELECT codigo, estado INTO v_maq FROM maquinas WHERE id = v_averia.maquina_id FOR UPDATE;
  IF v_maq.estado <> 'mantenimiento' THEN
    RAISE EXCEPTION 'La máquina % debe estar en mantenimiento para cerrar la reparación (estado: %)', v_maq.codigo, v_maq.estado;
  END IF;

  INSERT INTO reparaciones (averia_id, tecnico_id, descripcion_tecnico, costo_repuestos, costo_mano_obra)
  VALUES (p_averia_id, p_tecnico_id, btrim(p_descripcion_tecnico), COALESCE(p_costo_repuestos, 0), COALESCE(p_costo_mano_obra, 0))
  RETURNING id INTO v_reparacion_id;

  UPDATE averias_maquinas SET estado = 'resuelto' WHERE id = p_averia_id;
  UPDATE maquinas SET estado = 'activa', detalle_estado = 'OPERATIVA' WHERE id = v_averia.maquina_id;

  RETURN v_reparacion_id;
END;
$$;

-- El navegador todavía consulta como 'anon' (ver etapa 1b); por eso se incluye.
GRANT EXECUTE ON FUNCTION public.cargar_lote_produccion(UUID, TEXT, INTEGER, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_turno_produccion(UUID, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reportar_averia_maquina(UUID, TEXT, TEXT, TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iniciar_reparacion_averia(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_reparacion_averia(UUID, TEXT, NUMERIC, NUMERIC, UUID) TO anon, authenticated, service_role;

COMMIT;
