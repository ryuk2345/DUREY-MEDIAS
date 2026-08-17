-- =====================================================
-- SCHEMA DUREY — REPUESTOS, EGRESOS Y PAGO DIFERIDO
-- =====================================================

-- 1. TABLA DE REPUESTOS DE MÁQUINAS
CREATE TABLE IF NOT EXISTS repuestos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          TEXT UNIQUE NOT NULL,
  stock_actual    INTEGER NOT NULL DEFAULT 0,
  costo_unitario  NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. MODIFICAR COMPRAS_MATERIA_PRIMA PARA INCLUIR CONDICIÓN DE PAGO
ALTER TABLE compras_materia_prima ADD COLUMN IF NOT EXISTS metodo_pago TEXT DEFAULT 'efectivo';
ALTER TABLE compras_materia_prima ADD COLUMN IF NOT EXISTS condicion_pago TEXT DEFAULT 'contado' CHECK (condicion_pago IN ('contado', 'pago_diferido'));

-- 3. CRONOGRAMA DE CUOTAS PARA COMPRAS A PROVEEDORES (PAGO DIFERIDO)
CREATE TABLE IF NOT EXISTS cuotas_compras (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  compra_id           UUID NOT NULL REFERENCES compras_materia_prima(id) ON DELETE CASCADE,
  monto               NUMERIC(10,2) NOT NULL,
  fecha_vencimiento   DATE NOT NULL,
  estado              TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado')),
  fecha_pago          DATE,
  metodo_pago         TEXT,
  comprobante_url     TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 4. REGISTRO DE EGRESOS ADICIONALES (PLANILLA, SERVICIOS, ALQUILER, ETC.)
CREATE TABLE IF NOT EXISTS egresos_adicionales (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  concepto        TEXT NOT NULL,
  monto           NUMERIC(10,2) NOT NULL,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  categoria       TEXT NOT NULL DEFAULT 'general', -- planilla, servicios, alquiler, otros
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 5. DESACTIVAR RLS
ALTER TABLE repuestos DISABLE ROW LEVEL SECURITY;
ALTER TABLE cuotas_compras DISABLE ROW LEVEL SECURITY;
ALTER TABLE egresos_adicionales DISABLE ROW LEVEL SECURITY;

-- 6. INSERTAR DATOS INICIALES DE REPUESTOS
INSERT INTO repuestos (nombre, stock_actual, costo_unitario) VALUES
  ('Sensor de aguja M8', 15, 45.00),
  ('Plancha de hormado T1', 3, 250.00),
  ('Correa dentada de motor', 8, 35.00),
  ('Agujas tejedora calibre 12', 200, 1.50)
ON CONFLICT DO NOTHING;

-- 7. INSERTAR EGRESOS DE PRUEBA
INSERT INTO egresos_adicionales (concepto, monto, fecha, categoria) VALUES
  ('Pago de alquiler local agosto', 2500.00, CURRENT_DATE - INTERVAL '10 days', 'alquiler'),
  ('Recibo de luz del taller', 450.00, CURRENT_DATE - INTERVAL '5 days', 'servicios'),
  ('Pago de planilla semanal tejedores', 1800.00, CURRENT_DATE - INTERVAL '2 days', 'planilla')
ON CONFLICT DO NOTHING;
