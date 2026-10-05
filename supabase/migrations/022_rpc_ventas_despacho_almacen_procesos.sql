-- ==============================================================================
-- Migración 022: Operaciones atómicas de Ventas, Despacho, Almacén, Remallado
-- y Planchado (continuación de la 021).
--
-- Antes cada flujo hacía varias escrituras sueltas desde el navegador; un fallo
-- a mitad dejaba datos a medias (venta sin productos, paquetes entregados sin
-- guía, saco almacenado sin kárdex, traspaso que restaba docenas sin crear el
-- lote destino, stock descontado con un valor leído antes...).
-- Cada función corre en UNA transacción y bloquea las filas que modifica.
--
-- Códigos correlativos (V-xxxx, GR-xxxx): se generan aquí con un bloqueo, con el
-- mismo formato que generarCodigoVenta/generarCodigoGuia de lib/utils. Antes se
-- calculaban en el navegador contando filas y dos ventas simultáneas podían
-- recibir el mismo código.
--
-- Transiciones de paquete: replican lib/domain/packaging.ts.
-- Emulación local: lib/supabase/mockRpcProcesos.ts.
-- ==============================================================================

BEGIN;

-- Siguiente número de un código PREFIJO-NNNN: el mayor entre "filas + base" (lo
-- que usaba el navegador) y "mayor número existente + 1" (por si hubo borrados).
CREATE OR REPLACE FUNCTION public._siguiente_codigo(p_prefijo TEXT, p_base INTEGER, p_cantidad BIGINT, p_maximo INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_prefijo || CASE WHEN length(n::text) >= 4 THEN n::text ELSE lpad(n::text, 4, '0') END
  FROM (SELECT GREATEST(p_cantidad + p_base, COALESCE(p_maximo, 0) + 1) AS n) x
$$;

-- ------------------------------------------------------------------------------
-- 1. Registrar venta: cliente (alta o actualización) + venta + productos + cuotas
--    p_cliente: { tipo_documento, numero_documento, nombre, telefono, direccion }
--    p_items:   [{ catalogo_media_id, docenas, precio_docena }]
--    p_cuotas:  [{ numero_cuota, monto, fecha_vencimiento }]  (solo tipo 'cuotas')
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_venta(
  p_cliente         JSONB,
  p_asesora_id      UUID,
  p_tipo_pago       TEXT,
  p_monto_adelanto  NUMERIC,
  p_items           JSONB,
  p_cuotas          JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cliente_id UUID;
  v_venta_id   UUID;
  v_codigo     TEXT;
  v_total      NUMERIC;
BEGIN
  IF p_asesora_id IS NULL THEN
    RAISE EXCEPTION 'Selecciona la vendedora / asesora encargada';
  END IF;
  IF COALESCE(btrim(p_cliente->>'nombre'), '') = '' THEN
    RAISE EXCEPTION 'Ingresa el nombre o razón social del cliente';
  END IF;
  IF COALESCE(btrim(p_cliente->>'numero_documento'), '') = '' THEN
    RAISE EXCEPTION 'Ingresa el DNI o RUC del cliente';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto a la venta';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, precio_docena NUMERIC)
    WHERE i.catalogo_media_id IS NULL OR COALESCE(i.docenas, 0) <= 0 OR COALESCE(i.precio_docena, 0) < 0
  ) THEN
    RAISE EXCEPTION 'Cada producto necesita una media, docenas mayores a 0 y un precio válido';
  END IF;
  IF p_tipo_pago = 'cuotas' AND (p_cuotas IS NULL OR jsonb_array_length(p_cuotas) = 0) THEN
    RAISE EXCEPTION 'Una venta a cuotas necesita su cronograma de pagos';
  END IF;

  SELECT SUM(i.docenas * i.precio_docena) INTO v_total
    FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, precio_docena NUMERIC);
  IF COALESCE(p_monto_adelanto, 0) < 0 OR COALESCE(p_monto_adelanto, 0) > v_total THEN
    RAISE EXCEPTION 'El adelanto debe estar entre 0 y el total de la venta';
  END IF;

  INSERT INTO clientes (tipo_documento, numero_documento, nombre, telefono, direccion)
  VALUES (
    COALESCE(NULLIF(p_cliente->>'tipo_documento', ''), 'dni'),
    btrim(p_cliente->>'numero_documento'),
    btrim(p_cliente->>'nombre'),
    COALESCE(btrim(p_cliente->>'telefono'), ''),
    COALESCE(btrim(p_cliente->>'direccion'), '')
  )
  ON CONFLICT (numero_documento) DO UPDATE
    SET tipo_documento = EXCLUDED.tipo_documento,
        nombre = EXCLUDED.nombre,
        telefono = EXCLUDED.telefono,
        direccion = EXCLUDED.direccion
  RETURNING id INTO v_cliente_id;

  PERFORM pg_advisory_xact_lock(hashtext('durey_codigo_venta'));
  SELECT _siguiente_codigo('V-', 1001, count(*),
           max(NULLIF(regexp_replace(codigo_venta, '\D', '', 'g'), '')::INTEGER))
    INTO v_codigo FROM ventas;

  INSERT INTO ventas (codigo_venta, cliente_id, asesora_id, tipo_pago, total_soles, monto_adelanto, estado)
  VALUES (v_codigo, v_cliente_id, p_asesora_id, p_tipo_pago, v_total, COALESCE(p_monto_adelanto, 0), 'pendiente')
  RETURNING id INTO v_venta_id;

  INSERT INTO items_venta (venta_id, catalogo_media_id, docenas, precio_docena)
  SELECT v_venta_id, i.catalogo_media_id, i.docenas, i.precio_docena
    FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, precio_docena NUMERIC);

  IF p_tipo_pago = 'cuotas' THEN
    INSERT INTO cuotas (venta_id, numero_cuota, monto, fecha_vencimiento, estado)
    SELECT v_venta_id, c.numero_cuota, c.monto, c.fecha_vencimiento, 'pendiente'
      FROM jsonb_to_recordset(p_cuotas) AS c(numero_cuota INTEGER, monto NUMERIC, fecha_vencimiento DATE);
  END IF;

  RETURN jsonb_build_object('venta_id', v_venta_id, 'codigo_venta', v_codigo, 'total_soles', v_total);
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Despachar venta: entrega paquetes (los más antiguos primero, completos,
--    igual que antes) + guía + venta entregada + kárdex
--    p_lineas: [{ catalogo_media_id, docenas }]
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.despachar_venta(
  p_venta_id UUID,
  p_agencia  TEXT,
  p_lineas   JSONB
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_venta      RECORD;
  v_linea      RECORD;
  v_paq        RECORD;
  v_faltantes  NUMERIC;
  v_disponible NUMERIC;
  v_codigo     TEXT;
BEGIN
  IF COALESCE(btrim(p_agencia), '') = '' THEN
    RAISE EXCEPTION 'Selecciona una agencia de transporte';
  END IF;
  IF p_lineas IS NULL OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'El pedido no tiene productos para despachar';
  END IF;

  SELECT id, codigo_venta, estado INTO v_venta FROM ventas WHERE id = p_venta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF v_venta.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La venta % ya fue despachada (estado: %)', v_venta.codigo_venta, v_venta.estado;
  END IF;

  FOR v_linea IN
    SELECT l.catalogo_media_id, l.docenas
      FROM jsonb_to_recordset(p_lineas) AS l(catalogo_media_id UUID, docenas NUMERIC)
     WHERE COALESCE(l.docenas, 0) > 0
  LOOP
    -- Bloquear el stock de esta media y comprobar que alcance
    SELECT COALESCE(SUM(docenas), 0) INTO v_disponible FROM (
      SELECT docenas FROM paquetes
       WHERE catalogo_media_id = v_linea.catalogo_media_id
         AND estado IN ('almacenado', 'pendiente_almacenar')
       FOR UPDATE
    ) s;
    IF v_disponible < v_linea.docenas THEN
      RAISE EXCEPTION 'Stock insuficiente para despachar: se necesitan % docenas y hay % en almacén',
        v_linea.docenas, v_disponible;
    END IF;

    v_faltantes := v_linea.docenas;
    FOR v_paq IN
      SELECT id, docenas FROM paquetes
       WHERE catalogo_media_id = v_linea.catalogo_media_id
         AND estado IN ('almacenado', 'pendiente_almacenar')
       ORDER BY created_at, id
    LOOP
      EXIT WHEN v_faltantes <= 0;
      UPDATE paquetes SET venta_id = p_venta_id, estado = 'entregado', ubicacion_id = NULL, updated_at = NOW()
       WHERE id = v_paq.id;
      v_faltantes := v_faltantes - v_paq.docenas;
    END LOOP;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtext('durey_codigo_guia'));
  SELECT _siguiente_codigo('GR-', 9001, count(*),
           max(NULLIF(regexp_replace(codigo_guia, '\D', '', 'g'), '')::INTEGER))
    INTO v_codigo FROM guias_remision;

  INSERT INTO guias_remision (codigo_guia, venta_id, agencia, estado, fecha_despacho, fecha_entrega)
  VALUES (v_codigo, p_venta_id, btrim(p_agencia), 'entregado', CURRENT_DATE, CURRENT_DATE);

  UPDATE ventas SET estado = 'entregado' WHERE id = p_venta_id;

  INSERT INTO movimientos_stock (tipo, referencia, docenas)
  SELECT 'salida_venta', 'Despacho ' || v_venta.codigo_venta || ' — ' || btrim(p_agencia), l.docenas
    FROM jsonb_to_recordset(p_lineas) AS l(catalogo_media_id UUID, docenas NUMERIC)
   WHERE COALESCE(l.docenas, 0) > 0;

  RETURN v_codigo;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Almacenar paquete en un salón + registro en kárdex
--    Con p_paquete_id: almacena un paquete existente (valida la transición).
--    Sin p_paquete_id: crea el paquete ya almacenado (saco nuevo o ingreso directo).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.almacenar_paquete(
  p_paquete_id        UUID,
  p_ubicacion_id      UUID,
  p_codigo_paquete    TEXT,
  p_catalogo_media_id UUID,
  p_docenas           NUMERIC,
  p_total_pares       NUMERIC,
  p_detalles          JSONB,
  p_tipo_movimiento   TEXT,
  p_referencia        TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_paq RECORD;
  v_id  UUID;
BEGIN
  IF p_ubicacion_id IS NULL OR NOT EXISTS (SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_id) THEN
    RAISE EXCEPTION 'Selecciona un salón de destino válido';
  END IF;

  IF p_paquete_id IS NOT NULL THEN
    SELECT id, codigo_paquete, estado, docenas INTO v_paq FROM paquetes WHERE id = p_paquete_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Paquete no encontrado';
    END IF;
    -- Transiciones permitidas hacia 'almacenado': pendiente_almacenar, preparado_envio (o ya almacenado)
    IF v_paq.estado NOT IN ('pendiente_almacenar', 'preparado_envio', 'almacenado') THEN
      RAISE EXCEPTION 'El paquete % no se puede almacenar (estado: %)', v_paq.codigo_paquete, v_paq.estado;
    END IF;
    UPDATE paquetes SET estado = 'almacenado', ubicacion_id = p_ubicacion_id, updated_at = NOW() WHERE id = p_paquete_id;
    v_id := p_paquete_id;
  ELSE
    IF COALESCE(btrim(p_codigo_paquete), '') = '' OR COALESCE(p_docenas, 0) <= 0 THEN
      RAISE EXCEPTION 'Indica el código del paquete y una cantidad de docenas mayor a 0';
    END IF;
    INSERT INTO paquetes (codigo_paquete, catalogo_media_id, docenas, total_pares, ubicacion_id, detalles_contenido, estado)
    VALUES (btrim(p_codigo_paquete), p_catalogo_media_id, p_docenas, p_total_pares, p_ubicacion_id, p_detalles, 'almacenado')
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO movimientos_stock (tipo, referencia, paquete_id, ubicacion_id, docenas)
  VALUES (COALESCE(p_tipo_movimiento, 'ingreso_salon'), p_referencia, v_id, p_ubicacion_id,
          COALESCE(p_docenas, (SELECT docenas FROM paquetes WHERE id = v_id)));

  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Iniciar lote de remallado: lote + máquina ocupada + operadora ocupada
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iniciar_lote_remallado(
  p_maquina_id        UUID,
  p_remalladora_id    UUID,
  p_catalogo_media_id UUID,
  p_docenas           NUMERIC
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- ------------------------------------------------------------------------------
-- 5. Traspasar docenas pendientes de un lote de remallado a otra operadora/máquina
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.traspasar_lote_remallado(
  p_lote_origen_id         UUID,
  p_remalladora_destino_id UUID,
  p_maquina_destino_id     UUID,
  p_docenas                NUMERIC
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- ------------------------------------------------------------------------------
-- 6. Registrar producción diaria de planchado: reportes + descuento de stock
--    p_items: [{ planchador_id, catalogo_media_id, docenas_planchadas, docenas_defectuosas }]
--    Se descuenta (planchadas + defectuosas) de stock_listo_planchar; no se permite
--    registrar más de lo que hay (antes el stock se dejaba en 0 sin avisar).
-- ------------------------------------------------------------------------------
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

-- El navegador todavía consulta como 'anon' (ver etapa 1b); por eso se incluye.
GRANT EXECUTE ON FUNCTION public.registrar_venta(JSONB, UUID, TEXT, NUMERIC, JSONB, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.despachar_venta(UUID, TEXT, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.almacenar_paquete(UUID, UUID, TEXT, UUID, NUMERIC, NUMERIC, JSONB, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iniciar_lote_remallado(UUID, UUID, UUID, NUMERIC) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.traspasar_lote_remallado(UUID, UUID, UUID, NUMERIC) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_produccion_planchado(JSONB) TO anon, authenticated, service_role;

COMMIT;
