-- ==============================================================================
-- Migración 035: Ventas no vende crudos ni más de lo que hay para vender
-- Decisión del dueño (2026-11-27, 2-A): stock para vender = docenas en sacos
-- (almacenados o por almacenar, como vista_stock_medias) menos lo ya vendido sin
-- despachar (ventas 'pendiente'). Los crudos no se venden.
-- 1. vista_stock_vendible (security_invoker): físico, comprometidas y vendibles por SKU.
-- 2. registrar_venta lo exige dentro de la base, con cerrojo para ventas simultáneas.
-- No cambia datos. Reversión: supabase/scripts/revertir_035.sql
-- FTD: 02-DOCS/wiki/ftd/ventas-stock-crudos.md
-- ==============================================================================

BEGIN;

CREATE VIEW public.vista_stock_vendible WITH (security_invoker = true) AS
SELECT c.id AS catalogo_media_id,
       COALESCE(s.stock_docenas, 0)::NUMERIC AS fisico,
       COALESCE(k.comprometidas, 0)::NUMERIC AS comprometidas,
       (COALESCE(s.stock_docenas, 0) - COALESCE(k.comprometidas, 0))::NUMERIC AS vendibles
  FROM public.catalogo_medias c
  LEFT JOIN public.vista_stock_medias s ON s.catalogo_media_id = c.id
  LEFT JOIN (SELECT i.catalogo_media_id, SUM(i.docenas) AS comprometidas
               FROM public.items_venta i JOIN public.ventas v ON v.id = i.venta_id
              WHERE v.estado = 'pendiente'
              GROUP BY i.catalogo_media_id) k ON k.catalogo_media_id = c.id
 WHERE NOT c.es_crudo;

REVOKE ALL ON TABLE public.vista_stock_vendible FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vista_stock_vendible TO authenticated;
GRANT ALL ON TABLE public.vista_stock_vendible TO service_role;

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
  v_falta      RECORD;
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

  -- 035: los crudos no se venden; no se vende más de lo que hay en sacos menos lo ya
  -- vendido sin despachar (decisión del dueño 2026-11-27, 2-A). El cerrojo evita que dos
  -- ventas a la vez tomen el mismo stock.
  PERFORM pg_advisory_xact_lock(hashtext('durey_stock_venta'));
  SELECT c.codigo INTO v_codigo
    FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, precio_docena NUMERIC)
    JOIN catalogo_medias c ON c.id = i.catalogo_media_id
   WHERE c.es_crudo ORDER BY c.codigo LIMIT 1;
  IF v_codigo IS NOT NULL THEN
    RAISE EXCEPTION 'No se vende %: es un producto crudo', v_codigo;
  END IF;
  SELECT c.codigo, x.pedidas, COALESCE(s.vendibles, 0) AS hay INTO v_falta
    FROM (SELECT i.catalogo_media_id, SUM(i.docenas) AS pedidas
            FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, precio_docena NUMERIC)
           GROUP BY i.catalogo_media_id) x
    JOIN catalogo_medias c ON c.id = x.catalogo_media_id
    LEFT JOIN vista_stock_vendible s ON s.catalogo_media_id = x.catalogo_media_id
   WHERE x.pedidas > COALESCE(s.vendibles, 0)
   ORDER BY c.codigo LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'No hay stock suficiente de %: pides % docenas y hay % para vender', v_falta.codigo, v_falta.pedidas, GREATEST(v_falta.hay, 0);
  END IF;
  v_codigo := NULL;

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

COMMIT;
