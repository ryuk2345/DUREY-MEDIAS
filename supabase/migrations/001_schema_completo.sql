-- =====================================================
-- SCHEMA COMPLETO — Sistema DUREY
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -------------------------------------------------------
-- 1. USUARIOS Y ROLES
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_id UUID UNIQUE, -- referencia a auth.users de Supabase
  nombre TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN (
    'admin', 'supervisor', 'tejedor', 'remalladora',
    'planchador', 'preparador', 'almacenero', 'vendedora', 'tecnico'
  )),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 2. CATÁLOGO DE MEDIAS
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalogo_medias (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo TEXT UNIQUE NOT NULL, -- autogenerado: modelo-publico-diseño-talla
  modelo TEXT NOT NULL,
  publico TEXT NOT NULL,       -- dama, hombre, niño, unisex
  diseno_color TEXT NOT NULL,
  talla TEXT NOT NULL,
  costo_produccion_docena NUMERIC(10,2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 3. MARCAS Y MÁQUINAS
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS marcas_maquinas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maquinas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo TEXT UNIQUE NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('tejedora', 'remalladora')),
  marca_id UUID REFERENCES marcas_maquinas(id) ON DELETE SET NULL,
  anio INTEGER,
  caracteristicas TEXT,
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'ocupada', 'malograda')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 4. PRODUCCIÓN — TURNOS Y REPORTES
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS turnos_produccion (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tejedor_id UUID REFERENCES usuarios(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  horario TEXT NOT NULL CHECK (horario IN ('dia', 'noche')),
  duracion_horas INTEGER NOT NULL CHECK (duracion_horas IN (8, 12)),
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'cerrado')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS turno_maquinas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  turno_id UUID NOT NULL REFERENCES turnos_produccion(id) ON DELETE CASCADE,
  maquina_id UUID NOT NULL REFERENCES maquinas(id),
  catalogo_media_id UUID NOT NULL REFERENCES catalogo_medias(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reportes_produccion (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  turno_id UUID NOT NULL REFERENCES turnos_produccion(id),
  maquina_id UUID NOT NULL REFERENCES maquinas(id),
  catalogo_media_id UUID NOT NULL REFERENCES catalogo_medias(id),
  docenas_producidas NUMERIC(10,2) NOT NULL DEFAULT 0,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 5. MINIDEPÓSITOS Y REMALLADO
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS minidepositos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogo_media_id UUID NOT NULL REFERENCES catalogo_medias(id),
  horario TEXT NOT NULL CHECK (horario IN ('dia', 'noche')),
  total_docenas NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(catalogo_media_id, horario)
);

CREATE TABLE IF NOT EXISTS lotes_remallado (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  minideposito_id UUID NOT NULL REFERENCES minidepositos(id),
  catalogo_media_id UUID NOT NULL REFERENCES catalogo_medias(id),
  remalladora_id UUID REFERENCES usuarios(id),
  maquina_remalladora_id UUID NOT NULL REFERENCES maquinas(id),
  docenas_asignadas NUMERIC(10,2) NOT NULL DEFAULT 75,
  docenas_pendientes NUMERIC(10,2) NOT NULL DEFAULT 75,
  estado TEXT NOT NULL DEFAULT 'en_proceso' CHECK (estado IN ('en_proceso', 'completado', 'traspasado')),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reportes_remallado (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lote_id UUID NOT NULL REFERENCES lotes_remallado(id),
  remalladora_id UUID REFERENCES usuarios(id),
  maquina_id UUID NOT NULL REFERENCES maquinas(id),
  docenas_remalladas NUMERIC(10,2) NOT NULL DEFAULT 0,
  docenas_restantes NUMERIC(10,2) NOT NULL DEFAULT 0,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 6. PLANCHADO
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS cronograma_planchado (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  semana INTEGER NOT NULL,
  anio INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  planchador_id UUID NOT NULL REFERENCES usuarios(id),
  dia_semana TEXT NOT NULL CHECK (dia_semana IN ('lunes','martes','miercoles','jueves','viernes','sabado')),
  criterio TEXT NOT NULL CHECK (criterio IN ('talla', 'publico')),
  valor_criterio TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reportes_planchado (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  planchador_id UUID REFERENCES usuarios(id),
  catalogo_media_id UUID NOT NULL REFERENCES catalogo_medias(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  docenas_planchadas NUMERIC(10,2) NOT NULL DEFAULT 0,
  docenas_defectuosas NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 7. PREPARADO, PAQUETES Y STOCK DE LISTO PARA EMPACAR
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_listo_planchar (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogo_media_id UUID NOT NULL REFERENCES catalogo_medias(id),
  docenas NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(catalogo_media_id)
);

CREATE TABLE IF NOT EXISTS ubicaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT UNIQUE NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('salon', 'almacen_general')),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paquetes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_paquete TEXT UNIQUE NOT NULL, -- PKG-XXXX
  preparador_id UUID REFERENCES usuarios(id),
  catalogo_media_id UUID NOT NULL REFERENCES catalogo_medias(id),
  docenas NUMERIC(10,2) NOT NULL,
  qr_data TEXT NOT NULL, -- JSON encriptado para el QR
  estado TEXT NOT NULL DEFAULT 'pendiente_almacenar'
    CHECK (estado IN ('pendiente_almacenar','almacenado','preparado_envio','en_transito','entregado')),
  ubicacion_id UUID REFERENCES ubicaciones(id),
  venta_id UUID REFERENCES ventas(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movimientos_stock (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  paquete_id UUID NOT NULL REFERENCES paquetes(id),
  ubicacion_origen_id UUID REFERENCES ubicaciones(id),
  ubicacion_destino_id UUID REFERENCES ubicaciones(id),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  motivo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 8. CLIENTES Y VENTAS
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo_documento TEXT NOT NULL CHECK (tipo_documento IN ('dni', 'ruc')),
  numero_documento TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,         -- nombre natural o razón social
  telefono TEXT,
  direccion TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ventas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_venta TEXT UNIQUE NOT NULL, -- V-XXXX
  cliente_id UUID NOT NULL REFERENCES clientes(id),
  asesora_id UUID REFERENCES usuarios(id),
  tipo_pago TEXT NOT NULL CHECK (tipo_pago IN ('directo', 'cuotas')),
  total_soles NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','despachado','en_transito','entregado','cerrado')),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS items_venta (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  catalogo_media_id UUID NOT NULL REFERENCES catalogo_medias(id),
  docenas NUMERIC(10,2) NOT NULL,
  precio_docena NUMERIC(10,2) NOT NULL,
  subtotal NUMERIC(12,2) GENERATED ALWAYS AS (docenas * precio_docena) STORED
);

CREATE TABLE IF NOT EXISTS cuotas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  numero_cuota INTEGER NOT NULL,
  monto NUMERIC(12,2) NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada','vencida')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cobros (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id UUID NOT NULL REFERENCES ventas(id),
  cuota_id UUID REFERENCES cuotas(id),
  asesora_id UUID REFERENCES usuarios(id),
  monto NUMERIC(12,2) NOT NULL,
  metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('efectivo', 'yape', 'plin', 'transferencia')),
  evidencia_billetes_url TEXT,      -- foto de billetes en Supabase Storage
  evidencia_digital_url TEXT,       -- captura de Yape/Plin/transferencia
  estado_validacion TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado_validacion IN ('pendiente','validado','rechazado')),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 9. CAJA DIARIA
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS cajas_diarias (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asesora_id UUID REFERENCES usuarios(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  saldo_inicial NUMERIC(12,2) NOT NULL DEFAULT 0,
  ventas_efectivo NUMERIC(12,2) DEFAULT 0,
  ventas_digital NUMERIC(12,2) DEFAULT 0,
  cobros_efectivo NUMERIC(12,2) DEFAULT 0,
  cobros_digital NUMERIC(12,2) DEFAULT 0,
  saldo_esperado_efectivo NUMERIC(12,2) DEFAULT 0,
  saldo_declarado_efectivo NUMERIC(12,2),
  saldo_esperado_digital NUMERIC(12,2) DEFAULT 0,
  saldo_declarado_digital NUMERIC(12,2),
  diferencia NUMERIC(12,2),
  justificacion TEXT,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada_cuadrada','cerrada_faltante','cerrada_sobrante')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asesora_id, fecha)
);

-- -------------------------------------------------------
-- 10. DESPACHOS Y GUÍAS DE REMISIÓN
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS guias_remision (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_guia TEXT UNIQUE NOT NULL, -- GR-XXXX
  venta_id UUID NOT NULL REFERENCES ventas(id),
  agencia TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'en_transito' CHECK (estado IN ('en_transito','entregado')),
  firma_cargo_url TEXT,
  fecha_despacho DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 11. MANTENIMIENTO DE MÁQUINAS
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS averias_maquinas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  maquina_id UUID NOT NULL REFERENCES maquinas(id),
  reportado_por_id UUID REFERENCES usuarios(id), -- tejedor o remalladora
  descripcion_operador TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_reparacion','resuelto')),
  fecha_reporte TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reparaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  averia_id UUID NOT NULL REFERENCES averias_maquinas(id),
  tecnico_id UUID REFERENCES usuarios(id),
  descripcion_tecnico TEXT NOT NULL,
  costo_repuestos NUMERIC(10,2) DEFAULT 0,
  costo_mano_obra NUMERIC(10,2) DEFAULT 0,
  costo_total NUMERIC(10,2) GENERATED ALWAYS AS (costo_repuestos + costo_mano_obra) STORED,
  fecha_reparacion TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- SECUENCIAS PARA CÓDIGOS ÚNICOS
-- -------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_paquetes START 1001;
CREATE SEQUENCE IF NOT EXISTS seq_ventas START 1001;
CREATE SEQUENCE IF NOT EXISTS seq_guias START 9001;

-- -------------------------------------------------------
-- DATOS INICIALES
-- -------------------------------------------------------
-- Marcas de máquinas base
INSERT INTO marcas_maquinas (nombre) VALUES
  ('Angies'), ('Chinas Azules'), ('Chinas Verdes')
ON CONFLICT (nombre) DO NOTHING;

-- Ubicaciones base
INSERT INTO ubicaciones (nombre, tipo) VALUES
  ('Salón A', 'salon'),
  ('Salón B', 'salon'),
  ('Almacén General', 'almacen_general')
ON CONFLICT (nombre) DO NOTHING;

-- Usuarios base para pruebas sin requerir auth de Supabase vinculado inicialmente
INSERT INTO usuarios (nombre, email, rol, activo) VALUES
  ('Admin General', 'admin@durey.com', 'admin', true),
  ('Supervisor Durey', 'supervisor@durey.com', 'supervisor', true),
  ('Carlos Tejedor', 'tejedor@durey.com', 'tejedor', true),
  ('Ana Remalladora', 'remalladora@durey.com', 'remalladora', true),
  ('Mario Planchador', 'planchador@durey.com', 'planchador', true),
  ('Lucia Preparadora', 'preparador@durey.com', 'preparador', true),
  ('Juan Almacenero', 'almacenero@durey.com', 'almacenero', true),
  ('Sofia Vendedora', 'vendedora@durey.com', 'vendedora', true),
  ('Pedro Tecnico', 'tecnico@durey.com', 'tecnico', true)
ON CONFLICT (email) DO NOTHING;

-- Máquinas base
INSERT INTO maquinas (codigo, tipo, marca_id, anio, caracteristicas, estado) VALUES
  ('A-01', 'tejedora', (SELECT id FROM marcas_maquinas WHERE nombre='Angies'), 2024, 'Tejido fino', 'activa'),
  ('A-02', 'tejedora', (SELECT id FROM marcas_maquinas WHERE nombre='Angies'), 2024, 'Tejido grueso', 'activa'),
  ('B-01', 'tejedora', (SELECT id FROM marcas_maquinas WHERE nombre='Chinas Azules'), 2023, 'Tejido deportivo', 'activa'),
  ('R-01', 'remalladora', (SELECT id FROM marcas_maquinas WHERE nombre='Chinas Verdes'), 2024, 'Remallado rápido', 'activa'),
  ('R-02', 'remalladora', (SELECT id FROM marcas_maquinas WHERE nombre='Chinas Verdes'), 2024, 'Remallado estándar', 'activa')
ON CONFLICT (codigo) DO NOTHING;

-- Productos base del catálogo
INSERT INTO catalogo_medias (codigo, modelo, publico, diseno_color, talla, costo_produccion_docena, estado) VALUES
  ('tobillera-niño-con_diseño-10-13', 'Tobillera', 'Niño', 'con diseño', '10-13', 12.50, 'activo'),
  ('tobillera-hombre-negro-única', 'Tobillera', 'Hombre', 'negro', 'única', 15.00, 'activo'),
  ('tobillera-dama-diseño-única', 'Tobillera', 'Dama', 'diseño', 'única', 14.50, 'activo'),
  ('tobillera-niño-con_diseño-5', 'Tobillera', 'Niño', 'con diseño', '5', 11.00, 'activo')
ON CONFLICT (codigo) DO NOTHING;


-- -------------------------------------------------------
-- ÍNDICES PARA PERFORMANCE
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reportes_produccion_fecha ON reportes_produccion(fecha);
CREATE INDEX IF NOT EXISTS idx_minidepositos_media ON minidepositos(catalogo_media_id);
CREATE INDEX IF NOT EXISTS idx_ventas_cliente ON ventas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ventas_asesora ON ventas(asesora_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_venta ON cuotas(venta_id);
CREATE INDEX IF NOT EXISTS idx_cobros_asesora ON cobros(asesora_id);
CREATE INDEX IF NOT EXISTS idx_paquetes_ubicacion ON paquetes(ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_averias_maquina ON averias_maquinas(maquina_id);
CREATE INDEX IF NOT EXISTS idx_reparaciones_averia ON reparaciones(averia_id);
