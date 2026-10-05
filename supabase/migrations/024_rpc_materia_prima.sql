-- ==============================================================================
-- Migración 024: Operaciones atómicas de Materia Prima y Repuestos
--
-- Problemas que corrige:
--   * Aprobar una compra (control de calidad) guardaba el stock como
--     "stock leído al abrir la pantalla + compra": si en medio se cargó un lote
--     de tejido, su descuento de hilo se perdía. Además eran 3 escrituras
--     sueltas (compra, stock, movimiento) y una compra se podía aprobar 2 veces.
--   * Editar un hilo reescribía el stock con el valor viejo aunque solo se
--     cambiara el color, sin dejar movimiento; y sin id válido editaba por
--     nombre de material (todos los "Algodón" a la vez).
--   * Registrar una compra a crédito: compra y cuotas por separado; las cuotas
--     no sumaban exactamente el total por redondeo.
--   * Ajustar repuestos: stock leído antes; una salida mayor al stock lo dejaba
--     en 0 sin avisar y registraba como gasto todas las unidades pedidas.
--
-- Emulación local: lib/supabase/mockRpcMateriaPrima.ts
-- ==============================================================================

BEGIN;

-- Nuevo tipo de movimiento para ajustes por conteo físico (no hay datos que migrar)
ALTER TABLE public.movimientos_materia_prima DROP CONSTRAINT IF EXISTS movimientos_materia_prima_tipo_check;
ALTER TABLE public.movimientos_materia_prima ADD CONSTRAINT movimientos_materia_prima_tipo_check
  CHECK (tipo IN ('ingreso_compra', 'consumo_produccion', 'devolucion', 'ajuste_inventario'));

-- ------------------------------------------------------------------------------
-- 1. Editar hilo: nombre/color/empaque; el stock solo cambia si el usuario lo
--    modificó (conteo físico) y queda como movimiento 'ajuste_inventario'.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editar_materia_prima(
  p_id             UUID,
  p_material       TEXT,
  p_color          TEXT,
  p_tipo_empaque   TEXT,
  p_stock_anterior NUMERIC,
  p_stock_nuevo    NUMERIC
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actual NUMERIC;
BEGIN
  IF COALESCE(btrim(p_material), '') = '' OR COALESCE(btrim(p_color), '') = '' THEN
    RAISE EXCEPTION 'Material y color son obligatorios';
  END IF;
  IF p_stock_nuevo IS NOT NULL AND p_stock_nuevo < 0 THEN
    RAISE EXCEPTION 'El stock no puede ser negativo';
  END IF;

  SELECT stock_kg INTO v_actual FROM materia_prima WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insumo no encontrado'; END IF;

  UPDATE materia_prima
     SET material = btrim(p_material), color = btrim(p_color), tipo_empaque = COALESCE(p_tipo_empaque, 'cono')
   WHERE id = p_id;

  IF p_stock_nuevo IS NOT NULL AND p_stock_nuevo IS DISTINCT FROM p_stock_anterior AND p_stock_nuevo <> v_actual THEN
    UPDATE materia_prima SET stock_kg = p_stock_nuevo WHERE id = p_id;
    INSERT INTO movimientos_materia_prima (materia_prima_id, tipo, cantidad_kg, referencia_id)
    VALUES (p_id, 'ajuste_inventario', p_stock_nuevo - v_actual, NULL);
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Registrar compra (+ cronograma de cuotas si es a crédito)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_compra_materia_prima(
  p_proveedor_id     UUID,
  p_materia_prima_id UUID,
  p_cantidad_kg      NUMERIC,
  p_costo_total      NUMERIC,
  p_condicion_pago   TEXT,
  p_metodo_pago      TEXT,
  p_cuotas_num       INTEGER
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_compra_id UUID;
  v_base      NUMERIC;
  i           INTEGER;
BEGIN
  IF p_proveedor_id IS NULL OR p_materia_prima_id IS NULL THEN
    RAISE EXCEPTION 'Selecciona el proveedor y el insumo';
  END IF;
  IF COALESCE(p_cantidad_kg, 0) <= 0 OR COALESCE(p_costo_total, 0) <= 0 THEN
    RAISE EXCEPTION 'La cantidad y el costo deben ser mayores a 0';
  END IF;
  IF p_condicion_pago NOT IN ('contado', 'pago_diferido') THEN
    RAISE EXCEPTION 'Condición de pago inválida';
  END IF;
  IF p_condicion_pago = 'pago_diferido' AND COALESCE(p_cuotas_num, 0) < 1 THEN
    RAISE EXCEPTION 'Indica el número de cuotas';
  END IF;

  INSERT INTO compras_materia_prima (proveedor_id, materia_prima_id, cantidad_kg, costo_total, condicion_pago, metodo_pago, estado)
  VALUES (p_proveedor_id, p_materia_prima_id, p_cantidad_kg, p_costo_total, p_condicion_pago, p_metodo_pago, 'pendiente')
  RETURNING id INTO v_compra_id;

  IF p_condicion_pago = 'pago_diferido' THEN
    -- Cuotas iguales redondeadas hacia abajo; la última absorbe la diferencia para sumar exacto
    v_base := floor(p_costo_total / p_cuotas_num * 100) / 100;
    FOR i IN 1..p_cuotas_num LOOP
      INSERT INTO cuotas_compras (compra_id, monto, fecha_vencimiento, estado)
      VALUES (
        v_compra_id,
        CASE WHEN i = p_cuotas_num THEN p_costo_total - v_base * (p_cuotas_num - 1) ELSE v_base END,
        (CURRENT_DATE + make_interval(months => i))::DATE,
        'pendiente'
      );
    END LOOP;
  END IF;

  RETURN v_compra_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Control de calidad de una compra: aprobar (suma al stock) o devolver
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.procesar_control_calidad_compra(
  p_compra_id UUID,
  p_aprobar   BOOLEAN,
  p_motivo    TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_compra RECORD;
BEGIN
  SELECT id, materia_prima_id, cantidad_kg, estado INTO v_compra
    FROM compras_materia_prima WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF v_compra.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Esta compra ya fue procesada (estado: %)', v_compra.estado;
  END IF;
  IF NOT p_aprobar AND COALESCE(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Indica el motivo de la devolución';
  END IF;

  UPDATE compras_materia_prima
     SET estado = CASE WHEN p_aprobar THEN 'recibida' ELSE 'devuelta' END,
         motivo_devolucion = CASE WHEN p_aprobar THEN NULL ELSE btrim(p_motivo) END
   WHERE id = p_compra_id;

  IF p_aprobar THEN
    -- Relativo al stock actual (nunca a un valor leído antes)
    UPDATE materia_prima SET stock_kg = stock_kg + v_compra.cantidad_kg WHERE id = v_compra.materia_prima_id;
  END IF;

  INSERT INTO movimientos_materia_prima (materia_prima_id, tipo, cantidad_kg, referencia_id)
  VALUES (v_compra.materia_prima_id, CASE WHEN p_aprobar THEN 'ingreso_compra' ELSE 'devolucion' END, v_compra.cantidad_kg, p_compra_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Ajustar stock de un repuesto (+ egreso por el consumo si es salida)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ajustar_stock_repuesto(
  p_repuesto_id UUID,
  p_tipo        TEXT,
  p_cantidad    INTEGER,
  p_motivo      TEXT
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rep   RECORD;
  v_nuevo INTEGER;
BEGIN
  IF p_tipo NOT IN ('ingreso', 'salida') THEN RAISE EXCEPTION 'Tipo de ajuste inválido'; END IF;
  IF COALESCE(p_cantidad, 0) <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;

  SELECT id, nombre, stock_actual, costo_unitario INTO v_rep FROM repuestos WHERE id = p_repuesto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repuesto no encontrado'; END IF;
  IF p_tipo = 'salida' AND p_cantidad > v_rep.stock_actual THEN
    RAISE EXCEPTION 'Solo hay % unidades de %; no se pueden sacar %', v_rep.stock_actual, v_rep.nombre, p_cantidad;
  END IF;

  v_nuevo := v_rep.stock_actual + CASE WHEN p_tipo = 'ingreso' THEN p_cantidad ELSE -p_cantidad END;
  UPDATE repuestos SET stock_actual = v_nuevo WHERE id = p_repuesto_id;

  IF p_tipo = 'salida' THEN
    INSERT INTO egresos_adicionales (concepto, monto, categoria, fecha)
    VALUES (
      'Consumo repuesto: ' || v_rep.nombre || ' (' || p_cantidad || ' uds.) — ' || COALESCE(NULLIF(btrim(p_motivo), ''), 'Mantenimiento'),
      p_cantidad * COALESCE(v_rep.costo_unitario, 0),
      'repuestos',
      CURRENT_DATE
    );
  END IF;

  RETURN v_nuevo;
END;
$$;

-- El navegador todavía consulta como 'anon' (ver etapa 1b); por eso se incluye.
GRANT EXECUTE ON FUNCTION public.editar_materia_prima(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_compra_materia_prima(UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.procesar_control_calidad_compra(UUID, BOOLEAN, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ajustar_stock_repuesto(UUID, TEXT, INTEGER, TEXT) TO anon, authenticated, service_role;

COMMIT;
