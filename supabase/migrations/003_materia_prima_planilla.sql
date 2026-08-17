-- =====================================================
-- SCHEMA DUREY — VERSIÓN MATERIA PRIMA Y PLANILLAS
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- =====================================================

-- 1. PROVEEDORES
CREATE TABLE IF NOT EXISTS proveedores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT UNIQUE NOT NULL,
  ruc         TEXT UNIQUE,
  contacto    TEXT,
  telefono    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. MATERIA PRIMA (HILO)
CREATE TABLE IF NOT EXISTS materia_prima (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  material    TEXT NOT NULL, -- Algodón, Lana, Lycra, Poliéster, etc.
  color       TEXT NOT NULL,
  stock_kg    NUMERIC(10,3) NOT NULL DEFAULT 0.000, -- Stock en Kilogramos
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(material, color)
);

-- 3. COMPRAS/INGRESOS DE MATERIA PRIMA
CREATE TABLE IF NOT EXISTS compras_materia_prima (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proveedor_id        UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  materia_prima_id    UUID NOT NULL REFERENCES materia_prima(id) ON DELETE CASCADE,
  cantidad_kg         NUMERIC(10,3) NOT NULL,
  costo_total         NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  estado              TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'recibida', 'devuelta')),
  motivo_devolucion   TEXT,
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MOVIMIENTOS DE MATERIA PRIMA
CREATE TABLE IF NOT EXISTS movimientos_materia_prima (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  materia_prima_id    UUID NOT NULL REFERENCES materia_prima(id) ON DELETE CASCADE,
  tipo                TEXT NOT NULL CHECK (tipo IN ('ingreso_compra', 'consumo_produccion', 'devolucion')),
  cantidad_kg         NUMERIC(10,3) NOT NULL,
  referencia_id       UUID, -- ID de compras_materia_prima o turno_produccion
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 5. COLUMNAS EXTRA EN CATALOGO_MEDIAS PARA DICCIONARIO DUREY
ALTER TABLE catalogo_medias ADD COLUMN IF NOT EXISTS peso_docena_g NUMERIC(10,2) NOT NULL DEFAULT 360.00;
ALTER TABLE catalogo_medias ADD COLUMN IF NOT EXISTS materia_prima_id UUID REFERENCES materia_prima(id) ON DELETE SET NULL;

-- 6. DESACTIVAR RLS EN NUEVAS TABLAS
ALTER TABLE proveedores DISABLE ROW LEVEL SECURITY;
ALTER TABLE materia_prima DISABLE ROW LEVEL SECURITY;
ALTER TABLE compras_materia_prima DISABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_materia_prima DISABLE ROW LEVEL SECURITY;

-- 7. INSERTAR ALGUNOS PROVEEDORES Y MATERIAS PRIMAS DE EJEMPLO
INSERT INTO proveedores (nombre, ruc, contacto, telefono) VALUES
  ('Hilados del Sur', '20123456789', 'Roberto Cárdenas', '987654321'),
  ('Textiles Andinos', '20987654321', 'Ana Torres', '912345678')
ON CONFLICT DO NOTHING;

INSERT INTO materia_prima (material, color, stock_kg) VALUES
  ('Algodón', 'Blanco', 150.000),
  ('Algodón', 'Negro', 120.000),
  ('Algodón', 'Rojo', 2.000), -- Para probar la alerta de stock crítico
  ('Lana', 'Roja', 0.000),
  ('Lycra', 'Blanco', 50.000)
ON CONFLICT DO NOTHING;
