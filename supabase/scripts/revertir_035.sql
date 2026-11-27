-- Reversión de la migración 035: registrar_venta vuelve al texto de la 034 y se quita
-- la vista. Se aplica a mano, nunca como migración numerada.
BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_venta(p_cliente jsonb, p_asesora_id uuid, p_tipo_pago text, p_monto_adelanto numeric, p_items jsonb, p_cuotas jsonb, p_metodo_pago text DEFAULT 'efectivo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cliente_id UUID;
  v_venta_id   UUID;
  v_codigo     TEXT;
  v_total      NUMERIC;
  v_cobrado    NUMERIC;
BEGIN
  PERFORM exigir_modulo('ventas');  -- 034: el rol debe tener el módulo
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
$function$;

DROP VIEW IF EXISTS public.vista_stock_vendible;

COMMIT;
