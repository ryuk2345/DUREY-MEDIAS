-- ==============================================================================
-- Migración 034: Fase 6A — un SKU por saco, salones con kardex, traslados,
-- despacho eligiendo sacos y bloqueo por rol de ventas, almacén y despacho
-- Spec: 02-DOCS/wiki/sdd/specs/fase-6-almacen-ventas-despacho.md (aprobada 2026-11-27)
-- Plan: 02-DOCS/wiki/sdd/plans/fase-6a-salones-kardex.md
--
-- 1. Un saco lleva un solo SKU (detalles_contenido con a lo sumo uno; Preparado lo exige).
-- 2. Kardex: movimientos_stock con SKU, venta, guía y usuario; traslados entre salones.
-- 3. despachar_venta_sacos: almacén elige sacos completos (decisiones 3-B y C1-A); si
--    falta no deja, si sobra queda en despacho_detalle; guarda quién despachó.
-- 4. exigir_modulo en las funciones de ventas, almacén y despacho; sin escritura
--    directa con sesión en sus tablas (solo por funciones).
-- Lo ya registrado no se borra. Reversión: supabase/scripts/revertir_034.sql
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. UN SKU POR SACO, KARDEX Y DETALLE DEL DESPACHO
-- ------------------------------------------------------------------------------
-- Antes de la regla: si quedara un saco con varios SKU, se detiene con un mensaje claro
-- (no se reparte solo: separarlo es decisión del dueño). En la base real hay 0 (2026-11-27).
DO $$
DECLARE v_codigos TEXT;
BEGIN
  SELECT string_agg(codigo_paquete, ', ') INTO v_codigos FROM public.paquetes
   WHERE jsonb_typeof(detalles_contenido) = 'array' AND jsonb_array_length(detalles_contenido) > 1;
  IF v_codigos IS NOT NULL THEN
    RAISE EXCEPTION 'Sacos con varios SKU, sepáralos antes de aplicar la 034: %', v_codigos;
  END IF;
END $$;

ALTER TABLE public.paquetes ADD CONSTRAINT paquetes_un_solo_sku
  CHECK (detalles_contenido IS NULL OR jsonb_typeof(detalles_contenido) <> 'array' OR jsonb_array_length(detalles_contenido) <= 1);

ALTER TABLE public.movimientos_stock ADD COLUMN IF NOT EXISTS catalogo_media_id UUID REFERENCES public.catalogo_medias(id);
ALTER TABLE public.movimientos_stock ADD COLUMN IF NOT EXISTS venta_id UUID REFERENCES public.ventas(id);
ALTER TABLE public.movimientos_stock ADD COLUMN IF NOT EXISTS guia_id UUID REFERENCES public.guias_remision(id);
CREATE INDEX IF NOT EXISTS movimientos_stock_ubicacion_idx ON public.movimientos_stock (ubicacion_id, created_at);

ALTER TABLE public.guias_remision ADD COLUMN IF NOT EXISTS despachado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.despacho_detalle (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guia_id            UUID NOT NULL REFERENCES public.guias_remision(id) ON DELETE CASCADE,
  venta_id           UUID NOT NULL REFERENCES public.ventas(id),
  catalogo_media_id  UUID NOT NULL REFERENCES public.catalogo_medias(id),
  docenas_pedidas    NUMERIC(10,2) NOT NULL CHECK (docenas_pedidas >= 0),
  docenas_entregadas NUMERIC(10,2) NOT NULL CHECK (docenas_entregadas >= docenas_pedidas),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 2. FUNCIONES
-- ------------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.registrar_cobro_cuotas(p_cuota_ids uuid[], p_metodo_pago text, p_comprobante_url text, p_asesora_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total  NUMERIC := 0;
  v_cuota  RECORD;
BEGIN
  PERFORM exigir_modulo('ventas');  -- 034: el rol debe tener el módulo
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
$function$;

CREATE OR REPLACE FUNCTION public.crear_ubicacion(p_nombre text, p_tipo text DEFAULT 'salon'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nombre TEXT := btrim(COALESCE(p_nombre, ''));
  v_id     UUID;
  v_activo BOOLEAN;
BEGIN
  PERFORM exigir_modulo('almacen');  -- 034: el rol debe tener el módulo
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'Ingresa el nombre del almacén';
  END IF;
  IF COALESCE(p_tipo, '') NOT IN ('salon', 'almacen_general') THEN
    RAISE EXCEPTION 'Tipo de almacén inválido';
  END IF;
  SELECT id, activo INTO v_id, v_activo FROM ubicaciones WHERE lower(btrim(nombre)) = lower(v_nombre) LIMIT 1 FOR UPDATE;
  IF v_id IS NOT NULL THEN
    IF v_activo THEN
      RAISE EXCEPTION 'Ya existe un almacén llamado %', v_nombre;
    END IF;
    UPDATE ubicaciones SET activo = true WHERE id = v_id;  -- se había eliminado: se reactiva con su historial
    RETURN v_id;
  END IF;
  INSERT INTO ubicaciones (nombre, tipo, activo) VALUES (v_nombre, p_tipo, true) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.renombrar_ubicacion(p_id uuid, p_nombre text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nombre TEXT := btrim(COALESCE(p_nombre, ''));
BEGIN
  PERFORM exigir_modulo('almacen');  -- 034: el rol debe tener el módulo
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'Ingresa el nombre del almacén';
  END IF;
  PERFORM 1 FROM ubicaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Almacén no encontrado';
  END IF;
  IF EXISTS (SELECT 1 FROM ubicaciones WHERE id <> p_id AND lower(btrim(nombre)) = lower(v_nombre) AND activo) THEN
    RAISE EXCEPTION 'Ya existe un almacén llamado %', v_nombre;
  END IF;
  IF EXISTS (SELECT 1 FROM ubicaciones WHERE id <> p_id AND lower(btrim(nombre)) = lower(v_nombre)) THEN
    RAISE EXCEPTION 'El nombre % pertenece a un almacén eliminado. Créalo con ese nombre para reactivarlo.', v_nombre;
  END IF;
  UPDATE ubicaciones SET nombre = v_nombre WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.desactivar_ubicacion(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nombre    TEXT;
  v_paquetes  INTEGER;
BEGIN
  PERFORM exigir_modulo('almacen');  -- 034: el rol debe tener el módulo
  SELECT nombre INTO v_nombre FROM ubicaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Almacén no encontrado';
  END IF;
  SELECT count(*) INTO v_paquetes FROM paquetes WHERE ubicacion_id = p_id AND estado <> 'entregado';
  IF v_paquetes > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar %: tiene % paquete(s) dentro. Muévelos o despáchalos primero.', v_nombre, v_paquetes;
  END IF;
  UPDATE ubicaciones SET activo = false WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_agencia(p_nombre text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nombre TEXT := btrim(COALESCE(p_nombre, ''));
  v_id     UUID;
BEGIN
  PERFORM exigir_modulo('despacho');  -- 034: el rol debe tener el módulo
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'Ingresa el nombre de la agencia';
  END IF;
  SELECT id INTO v_id FROM agencias WHERE lower(btrim(nombre)) = lower(v_nombre) FOR UPDATE;
  IF v_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM agencias WHERE id = v_id AND activo) THEN
      RAISE EXCEPTION 'La agencia % ya está registrada', v_nombre;
    END IF;
    UPDATE agencias SET activo = true WHERE id = v_id;  -- se había dado de baja: se reactiva
    RETURN v_id;
  END IF;
  INSERT INTO agencias (nombre) VALUES (v_nombre) RETURNING id INTO v_id;
  RETURN v_id;
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
  PERFORM exigir_modulo('preparado');  -- 033: el rol debe tener el módulo
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
  -- 034: un saco lleva un solo SKU (decisión del dueño)
  IF (SELECT count(DISTINCT catalogo_media_id) FROM t_items_preparado) > 1 THEN
    RAISE EXCEPTION 'Un saco lleva un solo SKU: crea un saco por cada SKU';
  END IF;

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

-- Almacenar un saco en un salón (o crear uno ya almacenado), con su fila de kardex.
-- Si el saco ya estaba en otro salón, queda como traslado (salida y entrada).
CREATE OR REPLACE FUNCTION public.almacenar_paquete(p_paquete_id uuid, p_ubicacion_id uuid, p_codigo_paquete text, p_catalogo_media_id uuid, p_docenas numeric, p_total_pares numeric, p_detalles jsonb, p_tipo_movimiento text, p_referencia text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := exigir_modulo('almacen');
  v_paq RECORD;
  v_id  UUID;
BEGIN
  IF p_ubicacion_id IS NULL OR NOT EXISTS (SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_id AND activo) THEN
    RAISE EXCEPTION 'Selecciona un salón de destino válido';
  END IF;

  IF p_paquete_id IS NOT NULL THEN
    SELECT id, codigo_paquete, estado, docenas, ubicacion_id, catalogo_media_id INTO v_paq FROM paquetes WHERE id = p_paquete_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Paquete no encontrado'; END IF;
    IF v_paq.estado NOT IN ('pendiente_almacenar', 'preparado_envio', 'almacenado') THEN
      RAISE EXCEPTION 'El paquete % no se puede almacenar (estado: %)', v_paq.codigo_paquete, v_paq.estado;
    END IF;
    IF v_paq.estado = 'almacenado' AND v_paq.ubicacion_id = p_ubicacion_id THEN
      RETURN p_paquete_id;  -- ya está en ese salón: nada que registrar
    END IF;
    UPDATE paquetes SET estado = 'almacenado', ubicacion_id = p_ubicacion_id, updated_at = NOW() WHERE id = p_paquete_id;
    IF v_paq.estado = 'almacenado' AND v_paq.ubicacion_id IS NOT NULL THEN
      INSERT INTO movimientos_stock (tipo, referencia, paquete_id, ubicacion_id, ubicacion_origen_id, ubicacion_destino_id, usuario_id, docenas, catalogo_media_id)
      VALUES ('traslado_salida', p_referencia, v_paq.id, v_paq.ubicacion_id, v_paq.ubicacion_id, p_ubicacion_id, v_uid, v_paq.docenas, v_paq.catalogo_media_id),
             ('traslado_entrada', p_referencia, v_paq.id, p_ubicacion_id, v_paq.ubicacion_id, p_ubicacion_id, v_uid, v_paq.docenas, v_paq.catalogo_media_id);
      RETURN p_paquete_id;
    END IF;
    v_id := p_paquete_id;
  ELSE
    IF COALESCE(btrim(p_codigo_paquete), '') = '' OR COALESCE(p_docenas, 0) <= 0 THEN
      RAISE EXCEPTION 'Indica el código del paquete y una cantidad de docenas mayor a 0';
    END IF;
    IF p_catalogo_media_id IS NULL THEN RAISE EXCEPTION 'Elige el SKU del saco'; END IF;
    INSERT INTO paquetes (codigo_paquete, catalogo_media_id, docenas, total_pares, ubicacion_id, detalles_contenido, estado)
    VALUES (btrim(p_codigo_paquete), p_catalogo_media_id, p_docenas, p_total_pares, p_ubicacion_id, p_detalles, 'almacenado')
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO movimientos_stock (tipo, referencia, paquete_id, ubicacion_id, ubicacion_destino_id, usuario_id, docenas, catalogo_media_id)
  SELECT COALESCE(p_tipo_movimiento, 'ingreso_salon'), p_referencia, p.id, p_ubicacion_id, p_ubicacion_id, v_uid, p.docenas, p.catalogo_media_id
    FROM paquetes p WHERE p.id = v_id;
  RETURN v_id;
END;
$function$;

-- Trasladar un saco almacenado a otro salón: salida del origen y entrada al destino
CREATE OR REPLACE FUNCTION public.trasladar_saco(p_paquete_id UUID, p_ubicacion_destino_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := exigir_modulo('almacen');
  v_paq RECORD;
  v_dest RECORD;
BEGIN
  SELECT id, codigo_paquete, estado, ubicacion_id, docenas, catalogo_media_id INTO v_paq FROM paquetes WHERE id = p_paquete_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saco no encontrado'; END IF;
  IF v_paq.estado <> 'almacenado' OR v_paq.ubicacion_id IS NULL THEN
    RAISE EXCEPTION 'El saco % no está en un salón (estado: %)', v_paq.codigo_paquete, v_paq.estado;
  END IF;
  SELECT id, nombre, activo INTO v_dest FROM ubicaciones WHERE id = p_ubicacion_destino_id;
  IF NOT FOUND OR NOT v_dest.activo THEN RAISE EXCEPTION 'Elige un salón de destino activo'; END IF;
  IF p_ubicacion_destino_id = v_paq.ubicacion_id THEN RAISE EXCEPTION 'El saco ya está en %', v_dest.nombre; END IF;

  UPDATE paquetes SET ubicacion_id = p_ubicacion_destino_id, updated_at = NOW() WHERE id = p_paquete_id;
  INSERT INTO movimientos_stock (tipo, referencia, paquete_id, ubicacion_id, ubicacion_origen_id, ubicacion_destino_id, usuario_id, docenas, catalogo_media_id)
  VALUES ('traslado_salida', 'Traslado a ' || v_dest.nombre, v_paq.id, v_paq.ubicacion_id, v_paq.ubicacion_id, p_ubicacion_destino_id, v_uid, v_paq.docenas, v_paq.catalogo_media_id),
         ('traslado_entrada', 'Traslado a ' || v_dest.nombre, v_paq.id, p_ubicacion_destino_id, v_paq.ubicacion_id, p_ubicacion_destino_id, v_uid, v_paq.docenas, v_paq.catalogo_media_id);
END;
$$;

-- Despachar eligiendo sacos completos (decisiones 3-B y C1-A). Lo pedido sale de items_venta.
CREATE OR REPLACE FUNCTION public.despachar_venta_sacos(p_venta_id UUID, p_agencia TEXT, p_sacos UUID[])
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid    UUID := exigir_modulo('despacho');
  v_venta  RECORD;
  v_r      RECORD;
  v_codigo TEXT;
  v_guia   UUID;
BEGIN
  IF COALESCE(btrim(p_agencia), '') = '' THEN RAISE EXCEPTION 'Selecciona una agencia de transporte'; END IF;
  IF p_sacos IS NULL OR cardinality(p_sacos) = 0 THEN RAISE EXCEPTION 'Elige los sacos que salen'; END IF;
  IF cardinality(p_sacos) <> (SELECT count(DISTINCT s) FROM unnest(p_sacos) s) THEN RAISE EXCEPTION 'Un saco aparece más de una vez'; END IF;

  SELECT id, codigo_venta, estado INTO v_venta FROM ventas WHERE id = p_venta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF v_venta.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La venta % ya fue despachada (estado: %)', v_venta.codigo_venta, v_venta.estado;
  END IF;

  PERFORM 1 FROM paquetes WHERE id = ANY (p_sacos) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM paquetes WHERE id = ANY (p_sacos)) <> cardinality(p_sacos) THEN RAISE EXCEPTION 'Uno de los sacos no existe'; END IF;
  SELECT codigo_paquete, estado INTO v_r FROM paquetes WHERE id = ANY (p_sacos) AND (estado <> 'almacenado' OR venta_id IS NOT NULL OR ubicacion_id IS NULL)
   ORDER BY codigo_paquete LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'El saco % no está disponible en un salón (estado: %)', v_r.codigo_paquete, v_r.estado; END IF;
  SELECT p.codigo_paquete, c.codigo INTO v_r FROM paquetes p JOIN catalogo_medias c ON c.id = p.catalogo_media_id
   WHERE p.id = ANY (p_sacos) AND NOT EXISTS (SELECT 1 FROM items_venta i WHERE i.venta_id = p_venta_id AND i.catalogo_media_id = p.catalogo_media_id)
   ORDER BY p.codigo_paquete LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'El saco % es de %, que no está en el pedido', v_r.codigo_paquete, v_r.codigo; END IF;

  -- Por SKU: lo elegido debe cubrir lo pedido (si sobra, queda registrado)
  CREATE TEMP TABLE IF NOT EXISTS t_despacho (catalogo_media_id UUID, pedidas NUMERIC, entregadas NUMERIC) ON COMMIT DROP;
  TRUNCATE t_despacho;
  INSERT INTO t_despacho
  SELECT i.catalogo_media_id, SUM(i.docenas),
         COALESCE((SELECT SUM(p.docenas) FROM paquetes p WHERE p.id = ANY (p_sacos) AND p.catalogo_media_id = i.catalogo_media_id), 0)
    FROM items_venta i WHERE i.venta_id = p_venta_id GROUP BY i.catalogo_media_id;
  IF NOT EXISTS (SELECT 1 FROM t_despacho) THEN RAISE EXCEPTION 'El pedido no tiene productos para despachar'; END IF;
  SELECT t.pedidas - t.entregadas AS falta, c.codigo INTO v_r FROM t_despacho t JOIN catalogo_medias c ON c.id = t.catalogo_media_id
   WHERE t.entregadas < t.pedidas ORDER BY c.codigo LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Faltan % docenas de %: elige más sacos', v_r.falta, v_r.codigo; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('durey_codigo_guia'));
  SELECT _siguiente_codigo('GR-', 9001, count(*), max(NULLIF(regexp_replace(codigo_guia, '\D', '', 'g'), '')::INTEGER))
    INTO v_codigo FROM guias_remision;
  INSERT INTO guias_remision (codigo_guia, venta_id, agencia, estado, fecha_despacho, fecha_entrega, despachado_por)
  VALUES (v_codigo, p_venta_id, btrim(p_agencia), 'entregado', (NOW() AT TIME ZONE 'America/Lima')::date, (NOW() AT TIME ZONE 'America/Lima')::date, v_uid)
  RETURNING id INTO v_guia;

  INSERT INTO despacho_detalle (guia_id, venta_id, catalogo_media_id, docenas_pedidas, docenas_entregadas)
  SELECT v_guia, p_venta_id, catalogo_media_id, pedidas, entregadas FROM t_despacho;

  INSERT INTO movimientos_stock (tipo, referencia, paquete_id, ubicacion_id, ubicacion_origen_id, usuario_id, docenas, catalogo_media_id, venta_id, guia_id)
  SELECT 'salida_venta', 'Despacho ' || v_venta.codigo_venta || ' — ' || btrim(p_agencia), p.id, p.ubicacion_id, p.ubicacion_id, v_uid, p.docenas,
         p.catalogo_media_id, p_venta_id, v_guia
    FROM paquetes p WHERE p.id = ANY (p_sacos);

  UPDATE paquetes SET venta_id = p_venta_id, estado = 'entregado', ubicacion_id = NULL, updated_at = NOW() WHERE id = ANY (p_sacos);
  UPDATE ventas SET estado = 'entregado' WHERE id = p_venta_id;
  RETURN v_codigo;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. PERMISOS
-- ------------------------------------------------------------------------------
ALTER TABLE public.despacho_detalle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.despacho_detalle;
CREATE POLICY durey_usuarios_con_sesion ON public.despacho_detalle FOR ALL TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.despacho_detalle FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.despacho_detalle TO authenticated;
GRANT ALL ON TABLE public.despacho_detalle TO service_role;

-- Ventas, almacén y despacho: con sesión solo se leen; se escriben por sus funciones
REVOKE INSERT, UPDATE, DELETE ON TABLE public.paquetes, public.movimientos_stock, public.guias_remision, public.ventas, public.items_venta, public.cuotas, public.cobros, public.ubicaciones, public.agencias FROM authenticated;

-- El despacho anterior (elegía sacos solo y entregaba de más sin avisar) ya no se llama con sesión
REVOKE EXECUTE ON FUNCTION public.despachar_venta(UUID, TEXT, JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.trasladar_saco(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trasladar_saco(UUID, UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.despachar_venta_sacos(UUID, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.despachar_venta_sacos(UUID, TEXT, UUID[]) TO authenticated, service_role;

COMMIT;
