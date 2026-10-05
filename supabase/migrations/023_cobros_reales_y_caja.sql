-- ==============================================================================
-- Migración 023: Registrar los cobros reales y alimentar la caja diaria
--
-- Problema: los paneles de Admin, Balance y Materia Prima calculan los ingresos
-- desde la tabla `cobros` (validados), pero ninguna pantalla escribía en ella:
-- los "Ingresos Recaudados" salían siempre en 0. Tampoco se actualizaban
-- `cajas_diarias.ventas_*` / `cobros_*`, así que el cierre de caja comparaba
-- solo contra el saldo inicial y marcaba faltantes/sobrantes falsos.
--
-- Decisiones de operación:
--   * Venta 'directo' = contado: se cobra el total al registrar la venta.
--   * Venta 'cuotas': se cobra el adelanto al registrar la venta (si es > 0);
--     cada cuota se cobra después con registrar_cobro_cuotas.
--   * Los cobros los registra la propia vendedora en caja: se guardan como
--     'validado'. Se suman a la caja abierta del día (la de la vendedora si
--     existe; si no, la caja general del día).
--   * Histórico: se generan los cobros que faltan a partir de las ventas y
--     cuotas ya pagadas (ver sección 4). Las cuotas pagadas no tenían fecha de
--     pago: se usa su fecha de vencimiento (o hoy si vencía en el futuro).
-- ==============================================================================

BEGIN;

-- Suma un monto a la caja abierta de hoy (efectivo o digital, venta o cobro).
CREATE OR REPLACE FUNCTION public._sumar_a_caja(p_asesora_id UUID, p_metodo TEXT, p_monto NUMERIC, p_es_venta BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caja_id UUID;
  v_efectivo BOOLEAN := (p_metodo = 'efectivo');
BEGIN
  IF COALESCE(p_monto, 0) <= 0 THEN RETURN; END IF;
  SELECT id INTO v_caja_id FROM cajas_diarias
   WHERE fecha = CURRENT_DATE AND estado = 'abierta'
   ORDER BY (asesora_id IS NOT DISTINCT FROM p_asesora_id) DESC, created_at
   LIMIT 1
   FOR UPDATE;
  IF v_caja_id IS NULL THEN RETURN; END IF;  -- sin caja abierta: el cobro igual queda en `cobros`

  UPDATE cajas_diarias SET
    ventas_efectivo = ventas_efectivo + CASE WHEN p_es_venta AND v_efectivo THEN p_monto ELSE 0 END,
    ventas_digital  = ventas_digital  + CASE WHEN p_es_venta AND NOT v_efectivo THEN p_monto ELSE 0 END,
    cobros_efectivo = cobros_efectivo + CASE WHEN NOT p_es_venta AND v_efectivo THEN p_monto ELSE 0 END,
    cobros_digital  = cobros_digital  + CASE WHEN NOT p_es_venta AND NOT v_efectivo THEN p_monto ELSE 0 END
  WHERE id = v_caja_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 1. registrar_venta: igual que en la 022 + registra el cobro inicial y la caja
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.registrar_venta(JSONB, UUID, TEXT, NUMERIC, JSONB, JSONB);

CREATE OR REPLACE FUNCTION public.registrar_venta(
  p_cliente         JSONB,
  p_asesora_id      UUID,
  p_tipo_pago       TEXT,
  p_monto_adelanto  NUMERIC,
  p_items           JSONB,
  p_cuotas          JSONB,
  p_metodo_pago     TEXT DEFAULT 'efectivo'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cliente_id UUID;
  v_venta_id   UUID;
  v_codigo     TEXT;
  v_total      NUMERIC;
  v_cobrado    NUMERIC;
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
  IF p_tipo_pago NOT IN ('directo', 'cuotas') THEN
    RAISE EXCEPTION 'Tipo de pago inválido';
  END IF;
  IF COALESCE(p_metodo_pago, '') NOT IN ('efectivo', 'yape', 'plin', 'transferencia') THEN
    RAISE EXCEPTION 'Método de pago inválido';
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

  -- Cobro al momento de la venta: total (contado) o adelanto (cuotas)
  v_cobrado := CASE WHEN p_tipo_pago = 'directo' THEN v_total ELSE COALESCE(p_monto_adelanto, 0) END;
  IF v_cobrado > 0 THEN
    INSERT INTO cobros (venta_id, asesora_id, monto, metodo_pago, estado_validacion, fecha)
    VALUES (v_venta_id, p_asesora_id, v_cobrado, p_metodo_pago, 'validado', CURRENT_DATE);
    PERFORM _sumar_a_caja(p_asesora_id, p_metodo_pago, v_cobrado, TRUE);
  END IF;

  RETURN jsonb_build_object('venta_id', v_venta_id, 'codigo_venta', v_codigo, 'total_soles', v_total, 'monto_cobrado', v_cobrado);
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. registrar_cobro_cuotas: marca cuotas pagadas + cobros + caja, todo junto.
--    Rechaza cuotas ya pagadas (antes un doble clic las "cobraba" dos veces).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_cobro_cuotas(
  p_cuota_ids       UUID[],
  p_metodo_pago     TEXT,
  p_comprobante_url TEXT,
  p_asesora_id      UUID
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total  NUMERIC := 0;
  v_cuota  RECORD;
BEGIN
  IF p_cuota_ids IS NULL OR array_length(p_cuota_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecciona al menos una cuota';
  END IF;
  IF COALESCE(p_metodo_pago, '') NOT IN ('efectivo', 'yape', 'plin', 'transferencia') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;
  IF (SELECT count(*) FROM cuotas WHERE id = ANY(p_cuota_ids)) <> array_length(p_cuota_ids, 1) THEN
    RAISE EXCEPTION 'Una de las cuotas no existe';
  END IF;

  FOR v_cuota IN
    SELECT q.id, q.venta_id, q.numero_cuota, q.monto, q.estado, v.asesora_id, v.codigo_venta
      FROM cuotas q JOIN ventas v ON v.id = q.venta_id
     WHERE q.id = ANY(p_cuota_ids)
     ORDER BY q.id
     FOR UPDATE OF q
  LOOP
    IF v_cuota.estado = 'pagada' THEN
      RAISE EXCEPTION 'La cuota N° % de la venta % ya está pagada', v_cuota.numero_cuota, v_cuota.codigo_venta;
    END IF;
    UPDATE cuotas SET estado = 'pagada', metodo_pago = p_metodo_pago, comprobante_url = p_comprobante_url WHERE id = v_cuota.id;
    INSERT INTO cobros (venta_id, cuota_id, asesora_id, monto, metodo_pago, estado_validacion, fecha)
    VALUES (v_cuota.venta_id, v_cuota.id, COALESCE(p_asesora_id, v_cuota.asesora_id), v_cuota.monto, p_metodo_pago, 'validado', CURRENT_DATE);
    v_total := v_total + v_cuota.monto;
  END LOOP;

  PERFORM _sumar_a_caja(p_asesora_id, p_metodo_pago, v_total, FALSE);
  RETURN v_total;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Permisos (el navegador todavía consulta como 'anon', ver etapa 1b)
-- ------------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.registrar_venta(JSONB, UUID, TEXT, NUMERIC, JSONB, JSONB, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_cuotas(UUID[], TEXT, TEXT, UUID) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._sumar_a_caja(UUID, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Histórico: crear los cobros que nunca se registraron (idempotente)
-- ------------------------------------------------------------------------------
-- 4a. Ventas al contado sin ningún cobro → cobro por el total en la fecha de la venta
INSERT INTO cobros (venta_id, asesora_id, monto, metodo_pago, estado_validacion, fecha)
SELECT v.id, v.asesora_id, v.total_soles, 'efectivo', 'validado', v.fecha
  FROM ventas v
 WHERE v.tipo_pago = 'directo' AND v.total_soles > 0
   AND NOT EXISTS (SELECT 1 FROM cobros c WHERE c.venta_id = v.id);

-- 4b. Adelantos de ventas a cuotas sin cobro de adelanto → cobro en la fecha de la venta
INSERT INTO cobros (venta_id, asesora_id, monto, metodo_pago, estado_validacion, fecha)
SELECT v.id, v.asesora_id, v.monto_adelanto, 'efectivo', 'validado', v.fecha
  FROM ventas v
 WHERE v.tipo_pago = 'cuotas' AND v.monto_adelanto > 0
   AND NOT EXISTS (SELECT 1 FROM cobros c WHERE c.venta_id = v.id AND c.cuota_id IS NULL);

-- 4c. Cuotas pagadas sin cobro → cobro en su fecha de vencimiento (o hoy si es futura)
INSERT INTO cobros (venta_id, cuota_id, asesora_id, monto, metodo_pago, estado_validacion, fecha)
SELECT q.venta_id, q.id, v.asesora_id, q.monto,
       CASE WHEN q.metodo_pago IN ('efectivo', 'yape', 'plin', 'transferencia') THEN q.metodo_pago ELSE 'efectivo' END,
       'validado', LEAST(q.fecha_vencimiento, CURRENT_DATE)
  FROM cuotas q JOIN ventas v ON v.id = q.venta_id
 WHERE q.estado = 'pagada'
   AND NOT EXISTS (SELECT 1 FROM cobros c WHERE c.cuota_id = q.id);

COMMIT;
