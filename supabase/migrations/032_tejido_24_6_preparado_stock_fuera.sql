-- ==============================================================================
-- Migración 032: Fase 5A — tejido 24/6, preparado con la lógica de planchado,
-- varios SKU por día y stock de fuera
-- Spec: 02-DOCS/wiki/sdd/specs/fase-5-flujo-produccion.md (aprobada 2026-11-26)
-- Plan: 02-DOCS/wiki/sdd/plans/fase-5-flujo-produccion.md
--
-- 1. productos_maquina: producto fijo de cada tejedora, con historial. Lo cambian
--    administrador y supervisor (decisión P1-A) con asignar_producto_maquina.
-- 2. registrar_produccion_tejido: registro por fecha y turno (día/noche) con
--    encargado; una fila por máquina con docenas y operario. El hilo se descuenta
--    por las docenas reales (decisión C3-A). corregir_produccion_tejido: el mismo
--    día, administrador o supervisor (P2-A); ajusta el hilo por la diferencia.
-- 3. stock_listo_preparar: lo planchado (sin defectuosas) queda por preparar.
--    registrar_produccion_preparado descuenta de ahí, guarda reportes_preparado y
--    crea el saco en paquetes, todo atómico.
-- 4. ingresos_stock_fuera: medias que no salieron de las máquinas registradas
--    (producidas antes del sistema o traídas de otro lugar). En 5A entran a
--    planchado o preparado; sin egreso (decisión 5-A).
--
-- Lo ya registrado no se toca. Las funciones de tejido anteriores
-- (cargar_lote_produccion, cerrar_turno_produccion) quedan sin uso.
-- Permisos: tablas nuevas solo lectura para authenticated (se escriben por sus
-- funciones); nada para anon. Reversión: supabase/scripts/revertir_032.sql
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. TABLAS Y COLUMNAS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.productos_maquina (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  maquina_id        UUID NOT NULL REFERENCES public.maquinas(id) ON DELETE CASCADE,
  catalogo_media_id UUID NOT NULL REFERENCES public.catalogo_medias(id),
  desde             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hasta             TIMESTAMPTZ,
  asignado_por      UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (hasta IS NULL OR hasta >= desde)
);
-- Un solo producto vigente por máquina
CREATE UNIQUE INDEX IF NOT EXISTS productos_maquina_vigente_uq ON public.productos_maquina (maquina_id) WHERE hasta IS NULL;

-- Turno del registro 24/6: uno por fecha y horario (los turnos anteriores no cuentan)
ALTER TABLE public.turnos_produccion ADD COLUMN IF NOT EXISTS registro_24_6 BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS turnos_produccion_24_6_uq ON public.turnos_produccion (fecha, horario) WHERE registro_24_6;

-- Operario de cada máquina en el turno; una máquina se registra una vez por turno
ALTER TABLE public.reportes_produccion ADD COLUMN IF NOT EXISTS operario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;
ALTER TABLE public.reportes_produccion ADD COLUMN IF NOT EXISTS registrado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reportes_produccion_turno_maquina_uq ON public.reportes_produccion (turno_id, maquina_id);

CREATE TABLE IF NOT EXISTS public.stock_listo_preparar (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogo_media_id UUID NOT NULL UNIQUE REFERENCES public.catalogo_medias(id),
  docenas           NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (docenas >= 0),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reportes_preparado (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  preparador_id       UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  catalogo_media_id   UUID NOT NULL REFERENCES public.catalogo_medias(id),
  paquete_id          UUID REFERENCES public.paquetes(id) ON DELETE SET NULL,
  fecha               DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
  docenas_preparadas  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (docenas_preparadas >= 0),
  docenas_defectuosas NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (docenas_defectuosas >= 0),
  registrado_por      UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ingresos_stock_fuera (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- 5A: planchado y preparado. Remallado, volteado y tintorería llegan con la 033.
  etapa             TEXT NOT NULL CHECK (etapa IN ('planchado', 'preparado')),
  catalogo_media_id UUID NOT NULL REFERENCES public.catalogo_medias(id),
  docenas           NUMERIC(10,2) NOT NULL CHECK (docenas > 0),
  origen            TEXT NOT NULL CHECK (btrim(origen) <> ''),
  registrado_por    UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 2. FUNCIONES
-- ------------------------------------------------------------------------------

-- Quien llama debe ser administrador o supervisor (decisiones P1-A y P2-A).
-- La sesión (auth.uid()) es el usuario de DUREY; sin sesión no pasa.
CREATE OR REPLACE FUNCTION public.exigir_admin_o_supervisor(p_accion TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = v_uid AND activo AND rol IN ('admin', 'supervisor')) THEN
    RAISE EXCEPTION 'Solo el administrador o el supervisor pueden %', p_accion;
  END IF;
  RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.asignar_producto_maquina(p_maquina_id UUID, p_catalogo_media_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   UUID := exigir_admin_o_supervisor('cambiar el producto de una máquina');
  v_maq   RECORD;
  v_prod  RECORD;
  v_vig   UUID;
  v_id    UUID;
BEGIN
  SELECT id, codigo, tipo INTO v_maq FROM maquinas WHERE id = p_maquina_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Máquina no encontrada'; END IF;
  IF v_maq.tipo <> 'tejedora' THEN RAISE EXCEPTION 'La máquina % no es tejedora', v_maq.codigo; END IF;
  SELECT id, codigo, estado INTO v_prod FROM catalogo_medias WHERE id = p_catalogo_media_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elige el producto de la máquina'; END IF;
  IF v_prod.estado <> 'activo' THEN RAISE EXCEPTION 'El producto % está inactivo', v_prod.codigo; END IF;

  SELECT catalogo_media_id INTO v_vig FROM productos_maquina WHERE maquina_id = p_maquina_id AND hasta IS NULL FOR UPDATE;
  IF v_vig = p_catalogo_media_id THEN RAISE EXCEPTION 'La máquina % ya tiene el producto %', v_maq.codigo, v_prod.codigo; END IF;
  UPDATE productos_maquina SET hasta = NOW() WHERE maquina_id = p_maquina_id AND hasta IS NULL;
  INSERT INTO productos_maquina (maquina_id, catalogo_media_id, asignado_por)
  VALUES (p_maquina_id, p_catalogo_media_id, v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- p_items: [{ "maquina_id": uuid, "docenas": number, "operario_id": uuid }, ...]
CREATE OR REPLACE FUNCTION public.registrar_produccion_tejido(p_fecha DATE, p_horario TEXT, p_encargado_id UUID, p_items JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.corregir_produccion_tejido(p_reporte_id UUID, p_docenas NUMERIC, p_operario_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  UUID := exigir_admin_o_supervisor('corregir la producción de un turno');
  v_r    RECORD;
  v_dif  NUMERIC;
  v_kg   NUMERIC;
  v_mp   RECORD;
BEGIN
  IF p_docenas IS NULL OR p_docenas = 'NaN'::numeric OR p_docenas < 0 OR p_docenas > 10000 THEN
    RAISE EXCEPTION 'Las docenas deben ser un número entre 0 y 10 000';
  END IF;
  IF p_operario_id IS NULL OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_operario_id AND activo) THEN
    RAISE EXCEPTION 'Elige el operario de la máquina';
  END IF;
  SELECT r.id, r.turno_id, r.docenas_producidas, r.created_at, c.materia_prima_id, COALESCE(c.peso_docena_g, 360) AS peso, t.registro_24_6
    INTO v_r
    FROM reportes_produccion r
    JOIN turnos_produccion t ON t.id = r.turno_id
    JOIN catalogo_medias c ON c.id = r.catalogo_media_id
   WHERE r.id = p_reporte_id FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de producción no encontrado'; END IF;
  IF NOT v_r.registro_24_6 THEN RAISE EXCEPTION 'Solo se corrigen registros del turno 24/6'; END IF;
  IF (v_r.created_at AT TIME ZONE 'America/Lima')::date <> (NOW() AT TIME ZONE 'America/Lima')::date THEN
    RAISE EXCEPTION 'Solo se corrige el mismo día en que se registró';
  END IF;

  v_dif := round(p_docenas, 2) - v_r.docenas_producidas;
  IF v_dif <> 0 AND v_r.materia_prima_id IS NOT NULL THEN
    v_kg := abs(v_dif) * v_r.peso / 1000.0;
    SELECT material, color, stock_kg INTO v_mp FROM materia_prima WHERE id = v_r.materia_prima_id FOR UPDATE;
    IF v_dif > 0 AND v_mp.stock_kg < v_kg THEN
      RAISE EXCEPTION 'Falta de materia prima: se requieren % kg de % % pero solo quedan % kg',
        round(v_kg, 2), v_mp.material, v_mp.color, round(v_mp.stock_kg, 2);
    END IF;
    UPDATE materia_prima SET stock_kg = stock_kg - sign(v_dif) * v_kg WHERE id = v_r.materia_prima_id;
    INSERT INTO movimientos_materia_prima (materia_prima_id, tipo, cantidad_kg, referencia_id)
    VALUES (v_r.materia_prima_id, CASE WHEN v_dif > 0 THEN 'consumo_produccion' ELSE 'devolucion' END, v_kg, v_r.turno_id);
  END IF;
  UPDATE reportes_produccion SET docenas_producidas = round(p_docenas, 2), operario_id = p_operario_id, registrado_por = v_uid
   WHERE id = p_reporte_id;
END;
$$;

-- Planchado: misma firma y validaciones que la 022; además lo planchado queda por preparar
CREATE OR REPLACE FUNCTION public.registrar_produccion_planchado(
  p_items JSONB
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
$$;

-- Preparado: un saco por llamada (un preparador; uno o varios SKU)
-- p_items: [{ "catalogo_media_id": uuid, "docenas": number, "defectuosas": number }, ...]
-- El contenido del saco (detalles_contenido) se arma aquí con lo que se descontó:
-- [{ catalogo_media_id, sku, codigo, docenas, pares }], el formato que lee Almacén.
CREATE OR REPLACE FUNCTION public.registrar_produccion_preparado(
  p_preparador_id  UUID,
  p_codigo_paquete TEXT,
  p_ubicacion_id   UUID,
  p_items          JSONB,
  p_qr_data        TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.ingresar_stock_fuera(p_etapa TEXT, p_catalogo_media_id UUID, p_docenas NUMERIC, p_origen TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
$$;

-- Historia clínica (031): en el turno 24/6 la persona de la producción es el operario
-- de la máquina; en los turnos anteriores, el encargado. Mismas columnas y permisos.
CREATE OR REPLACE VIEW public.vista_historia_maquina WITH (security_invoker = true) AS
  -- evento_id: identificador único de cada fila (desempate estable al leer la historia por páginas)
  SELECT 'tejido:' || r.id AS evento_id, r.maquina_id, r.fecha, r.created_at AS momento, 'produccion'::text AS tipo, t.horario AS turno,
         c.codigo AS detalle, r.docenas_producidas AS cantidad, NULL::numeric AS costo, COALESCE(op.nombre, u.nombre) AS persona, NULL::text AS mecanico
    FROM reportes_produccion r
    LEFT JOIN turnos_produccion t ON t.id = r.turno_id
    LEFT JOIN usuarios u ON u.id = t.tejedor_id
    LEFT JOIN usuarios op ON op.id = r.operario_id  -- 032: operario de la máquina en el turno 24/6
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

-- ------------------------------------------------------------------------------
-- 3. PERMISOS (exactos para authenticated; nada para anon)
-- ------------------------------------------------------------------------------
ALTER TABLE public.productos_maquina     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_listo_preparar  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes_preparado    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingresos_stock_fuera  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.productos_maquina;
CREATE POLICY durey_usuarios_con_sesion ON public.productos_maquina FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.stock_listo_preparar;
CREATE POLICY durey_usuarios_con_sesion ON public.stock_listo_preparar FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.reportes_preparado;
CREATE POLICY durey_usuarios_con_sesion ON public.reportes_preparado FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.ingresos_stock_fuera;
CREATE POLICY durey_usuarios_con_sesion ON public.ingresos_stock_fuera FOR ALL TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.productos_maquina, public.stock_listo_preparar, public.reportes_preparado, public.ingresos_stock_fuera
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.productos_maquina, public.stock_listo_preparar, public.reportes_preparado, public.ingresos_stock_fuera TO authenticated;
GRANT ALL ON TABLE public.productos_maquina, public.stock_listo_preparar, public.reportes_preparado, public.ingresos_stock_fuera TO service_role;

REVOKE ALL ON FUNCTION public.exigir_admin_o_supervisor(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exigir_admin_o_supervisor(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.asignar_producto_maquina(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_produccion_tejido(DATE, TEXT, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.corregir_produccion_tejido(UUID, NUMERIC, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_produccion_planchado(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_produccion_preparado(UUID, TEXT, UUID, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ingresar_stock_fuera(TEXT, UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asignar_producto_maquina(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_produccion_tejido(DATE, TEXT, UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.corregir_produccion_tejido(UUID, NUMERIC, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_produccion_planchado(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_produccion_preparado(UUID, TEXT, UUID, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ingresar_stock_fuera(TEXT, UUID, NUMERIC, TEXT) TO authenticated, service_role;

COMMIT;
