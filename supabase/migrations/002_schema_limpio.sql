-- =====================================================
-- SCHEMA DUREY — VERSIÓN LIMPIA (SIN DATOS DE PRUEBA)
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- =====================================================

-- Borrar todo lo existente (orden inverso por dependencias)
DROP TABLE IF EXISTS reparaciones CASCADE;
DROP TABLE IF EXISTS averias_maquinas CASCADE;
DROP TABLE IF EXISTS guias_remision CASCADE;
DROP TABLE IF EXISTS cajas_diarias CASCADE;
DROP TABLE IF EXISTS cobros CASCADE;
DROP TABLE IF EXISTS cuotas CASCADE;
DROP TABLE IF EXISTS items_venta CASCADE;
DROP TABLE IF EXISTS ventas CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS movimientos_stock CASCADE;
DROP TABLE IF EXISTS paquetes CASCADE;
DROP TABLE IF EXISTS ubicaciones CASCADE;
DROP TABLE IF EXISTS stock_listo_planchar CASCADE;
DROP TABLE IF EXISTS reportes_planchado CASCADE;
DROP TABLE IF EXISTS cronograma_planchado CASCADE;
DROP TABLE IF EXISTS reportes_remallado CASCADE;
DROP TABLE IF EXISTS lotes_remallado CASCADE;
DROP TABLE IF EXISTS minidepositos CASCADE;
DROP TABLE IF EXISTS reportes_produccion CASCADE;
DROP TABLE IF EXISTS turno_maquinas CASCADE;
DROP TABLE IF EXISTS turnos_produccion CASCADE;
DROP TABLE IF EXISTS maquinas CASCADE;
DROP TABLE IF EXISTS marcas_maquinas CASCADE;
DROP TABLE IF EXISTS catalogo_medias CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP SEQUENCE IF EXISTS seq_paquetes;
DROP SEQUENCE IF EXISTS seq_ventas;
DROP SEQUENCE IF EXISTS seq_guias;

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -------------------------------------------------------
-- 1. USUARIOS Y ROLES
-- -------------------------------------------------------
CREATE TABLE usuarios (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_id     UUID UNIQUE,
  nombre      TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  rol         TEXT NOT NULL CHECK (rol IN (
                'admin','supervisor','tejedor','remalladora',
                'planchador','preparador','almacenero','vendedora','tecnico'
              )),
  activo      BOOLEAN DEFAULT TRUE,
  estado      TEXT DEFAULT 'disponible',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- -------------------------------------------------------
-- 2. CATÁLOGO DE MEDIAS
-- -------------------------------------------------------
CREATE TABLE catalogo_medias (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku                      TEXT UNIQUE,
  codigo                   TEXT UNIQUE NOT NULL,
  modelo                   TEXT NOT NULL,
  publico                  TEXT NOT NULL,
  diseno_color             TEXT NOT NULL,
  talla                    TEXT NOT NULL,
  costo_produccion_docena  NUMERIC(10,2) NOT NULL DEFAULT 0,
  estado                   TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo')),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 3. MARCAS Y MÁQUINAS
-- -------------------------------------------------------
CREATE TABLE marcas_maquinas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE maquinas (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo           TEXT UNIQUE NOT NULL,
  tipo             TEXT NOT NULL CHECK (tipo IN ('tejedora','remalladora')),
  marca_id         UUID REFERENCES marcas_maquinas(id) ON DELETE SET NULL,
  anio             INTEGER,
  caracteristicas  TEXT,
  estado           TEXT NOT NULL DEFAULT 'activa'
                   CHECK (estado IN ('activa','ocupada','malograda','mantenimiento','standby','inactiva')),
  detalle_estado   TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);


-- -------------------------------------------------------
-- 4. PRODUCCIÓN
-- -------------------------------------------------------
CREATE TABLE turnos_produccion (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tejedor_id      UUID REFERENCES usuarios(id),
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  horario         TEXT NOT NULL CHECK (horario IN ('dia','noche')),
  duracion_horas  INTEGER NOT NULL CHECK (duracion_horas IN (8,12)),
  estado          TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','cerrado')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE turno_maquinas (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  turno_id            UUID NOT NULL REFERENCES turnos_produccion(id) ON DELETE CASCADE,
  maquina_id          UUID NOT NULL REFERENCES maquinas(id),
  catalogo_media_id   UUID NOT NULL REFERENCES catalogo_medias(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reportes_produccion (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  turno_id            UUID NOT NULL REFERENCES turnos_produccion(id),
  maquina_id          UUID NOT NULL REFERENCES maquinas(id),
  catalogo_media_id   UUID NOT NULL REFERENCES catalogo_medias(id),
  docenas_producidas  NUMERIC(10,2) NOT NULL DEFAULT 0,
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 5. REMALLADO
-- -------------------------------------------------------
CREATE TABLE minidepositos (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogo_media_id   UUID NOT NULL REFERENCES catalogo_medias(id),
  horario             TEXT NOT NULL CHECK (horario IN ('dia','noche')),
  total_docenas       NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(catalogo_media_id, horario)
);

CREATE TABLE lotes_remallado (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  minideposito_id          UUID NOT NULL REFERENCES minidepositos(id),
  catalogo_media_id        UUID NOT NULL REFERENCES catalogo_medias(id),
  remalladora_id           UUID REFERENCES usuarios(id),
  maquina_remalladora_id   UUID NOT NULL REFERENCES maquinas(id),
  docenas_asignadas        NUMERIC(10,2) NOT NULL DEFAULT 75,
  docenas_pendientes       NUMERIC(10,2) NOT NULL DEFAULT 75,
  estado                   TEXT NOT NULL DEFAULT 'en_proceso'
                           CHECK (estado IN ('en_proceso','completado','traspasado')),
  fecha                    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reportes_remallado (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lote_id             UUID NOT NULL REFERENCES lotes_remallado(id),
  remalladora_id      UUID REFERENCES usuarios(id),
  maquina_id          UUID NOT NULL REFERENCES maquinas(id),
  docenas_remalladas  NUMERIC(10,2) NOT NULL DEFAULT 0,
  docenas_restantes   NUMERIC(10,2) NOT NULL DEFAULT 0,
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 6. PLANCHADO
-- -------------------------------------------------------
CREATE TABLE cronograma_planchado (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  semana          INTEGER NOT NULL,
  anio            INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  planchador_id   UUID NOT NULL REFERENCES usuarios(id),
  dia_semana      TEXT NOT NULL CHECK (dia_semana IN ('lunes','martes','miercoles','jueves','viernes','sabado')),
  criterio        TEXT NOT NULL CHECK (criterio IN ('talla','publico','media')),

  valor_criterio  TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reportes_planchado (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  planchador_id         UUID REFERENCES usuarios(id),
  catalogo_media_id     UUID NOT NULL REFERENCES catalogo_medias(id),
  fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
  docenas_planchadas    NUMERIC(10,2) NOT NULL DEFAULT 0,
  docenas_defectuosas   NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 7. PREPARADO Y ALMACÉN
-- -------------------------------------------------------
CREATE TABLE stock_listo_planchar (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogo_media_id   UUID NOT NULL REFERENCES catalogo_medias(id),
  docenas             NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(catalogo_media_id)
);

CREATE TABLE ubicaciones (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT UNIQUE NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('salon','almacen_general')),
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE paquetes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_paquete      TEXT UNIQUE NOT NULL,
  preparador_id       UUID REFERENCES usuarios(id),
  catalogo_media_id   UUID REFERENCES catalogo_medias(id),
  docenas             NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_pares         NUMERIC(10,2),
  qr_data             TEXT,
  detalles_contenido  JSONB,
  estado              TEXT NOT NULL DEFAULT 'pendiente_almacenar'
                      CHECK (estado IN ('pendiente_almacenar','almacenado','preparado_envio','en_transito','entregado')),
  ubicacion_id        UUID REFERENCES ubicaciones(id),
  venta_id            UUID,
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE movimientos_stock (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo                  TEXT NOT NULL DEFAULT 'ingreso_salon',
  referencia            TEXT,
  paquete_id            UUID REFERENCES paquetes(id),
  ubicacion_id          UUID REFERENCES ubicaciones(id),
  ubicacion_origen_id   UUID REFERENCES ubicaciones(id),
  ubicacion_destino_id  UUID REFERENCES ubicaciones(id),
  usuario_id            UUID REFERENCES usuarios(id),
  docenas               NUMERIC(10,2) DEFAULT 0,
  motivo                TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 8. CLIENTES Y VENTAS
-- -------------------------------------------------------
CREATE TABLE clientes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo_documento    TEXT NOT NULL CHECK (tipo_documento IN ('dni','ruc')),
  numero_documento  TEXT UNIQUE NOT NULL,
  nombre            TEXT NOT NULL,
  telefono          TEXT,
  direccion         TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ventas (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_venta  TEXT UNIQUE NOT NULL,
  cliente_id    UUID NOT NULL REFERENCES clientes(id),
  asesora_id    UUID REFERENCES usuarios(id),
  tipo_pago     TEXT NOT NULL CHECK (tipo_pago IN ('directo','cuotas')),
  total_soles   NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente','despachado','en_transito','entregado','cerrado')),
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE paquetes ADD CONSTRAINT fk_paquetes_venta
  FOREIGN KEY (venta_id) REFERENCES ventas(id);

CREATE TABLE items_venta (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id            UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  catalogo_media_id   UUID NOT NULL REFERENCES catalogo_medias(id),
  docenas             NUMERIC(10,2) NOT NULL,
  precio_docena       NUMERIC(10,2) NOT NULL,
  subtotal            NUMERIC(12,2) GENERATED ALWAYS AS (docenas * precio_docena) STORED
);

CREATE TABLE cuotas (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id          UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  numero_cuota      INTEGER NOT NULL,
  monto             NUMERIC(12,2) NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada','vencida')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cobros (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id               UUID NOT NULL REFERENCES ventas(id),
  cuota_id               UUID REFERENCES cuotas(id),
  asesora_id             UUID REFERENCES usuarios(id),
  monto                  NUMERIC(12,2) NOT NULL,
  metodo_pago            TEXT NOT NULL CHECK (metodo_pago IN ('efectivo','yape','plin','transferencia')),
  evidencia_billetes_url TEXT,
  evidencia_digital_url  TEXT,
  estado_validacion      TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK (estado_validacion IN ('pendiente','validado','rechazado')),
  fecha                  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 9. CAJA DIARIA
-- -------------------------------------------------------
CREATE TABLE cajas_diarias (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asesora_id               UUID REFERENCES usuarios(id),
  fecha                    DATE NOT NULL DEFAULT CURRENT_DATE,
  saldo_inicial            NUMERIC(12,2) NOT NULL DEFAULT 0,
  ventas_efectivo          NUMERIC(12,2) DEFAULT 0,
  ventas_digital           NUMERIC(12,2) DEFAULT 0,
  cobros_efectivo          NUMERIC(12,2) DEFAULT 0,
  cobros_digital           NUMERIC(12,2) DEFAULT 0,
  saldo_esperado_efectivo  NUMERIC(12,2) DEFAULT 0,
  saldo_declarado_efectivo NUMERIC(12,2),
  saldo_esperado_digital   NUMERIC(12,2) DEFAULT 0,
  saldo_declarado_digital  NUMERIC(12,2),
  diferencia               NUMERIC(12,2),
  justificacion            TEXT,
  estado                   TEXT NOT NULL DEFAULT 'abierta'
                           CHECK (estado IN ('abierta','cerrada_cuadrada','cerrada_faltante','cerrada_sobrante')),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asesora_id, fecha)
);

-- -------------------------------------------------------
-- 10. DESPACHO
-- -------------------------------------------------------
CREATE TABLE guias_remision (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_guia     TEXT UNIQUE NOT NULL,
  venta_id        UUID NOT NULL REFERENCES ventas(id),
  agencia         TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'en_transito' CHECK (estado IN ('en_transito','entregado')),
  firma_cargo_url TEXT,
  fecha_despacho  DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega   DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 11. MANTENIMIENTO
-- -------------------------------------------------------
CREATE TABLE averias_maquinas (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  maquina_id            UUID NOT NULL REFERENCES maquinas(id),
  reportado_por_id      UUID REFERENCES usuarios(id),
  tipo_averia           TEXT,
  descripcion_operador  TEXT NOT NULL,
  estado                TEXT NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente','en_reparacion','resuelto')),
  asignado_a            TEXT,
  nivel                 TEXT DEFAULT 'CRÍTICO',
  fecha_reporte         TIMESTAMPTZ DEFAULT NOW(),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE reparaciones (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  averia_id           UUID NOT NULL REFERENCES averias_maquinas(id),
  tecnico_id          UUID REFERENCES usuarios(id),
  descripcion_tecnico TEXT NOT NULL,
  costo_repuestos     NUMERIC(10,2) DEFAULT 0,
  costo_mano_obra     NUMERIC(10,2) DEFAULT 0,
  costo_total         NUMERIC(10,2) GENERATED ALWAYS AS (costo_repuestos + costo_mano_obra) STORED,
  fecha_reparacion    TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- SECUENCIAS
-- -------------------------------------------------------
CREATE SEQUENCE seq_paquetes START 1001;
CREATE SEQUENCE seq_ventas   START 1001;
CREATE SEQUENCE seq_guias    START 9001;

-- -------------------------------------------------------
-- DATOS DE REFERENCIA MÍNIMOS (sin usuarios ni productos)
-- -------------------------------------------------------
INSERT INTO marcas_maquinas (nombre) VALUES
  ('Angies'), ('Chinas Azules'), ('Chinas Verdes'), ('Singer'), ('Brother');

INSERT INTO ubicaciones (nombre, tipo) VALUES
  ('Salón A', 'salon'),
  ('Salón B', 'salon'),
  ('Almacén General', 'almacen_general');

-- -------------------------------------------------------
-- ÍNDICES
-- -------------------------------------------------------
CREATE INDEX idx_reportes_produccion_fecha ON reportes_produccion(fecha);
CREATE INDEX idx_minidepositos_media        ON minidepositos(catalogo_media_id);
CREATE INDEX idx_ventas_cliente             ON ventas(cliente_id);
CREATE INDEX idx_ventas_asesora             ON ventas(asesora_id);
CREATE INDEX idx_cuotas_venta               ON cuotas(venta_id);
CREATE INDEX idx_cobros_asesora             ON cobros(asesora_id);
CREATE INDEX idx_paquetes_ubicacion         ON paquetes(ubicacion_id);
CREATE INDEX idx_averias_maquina            ON averias_maquinas(maquina_id);
CREATE INDEX idx_reparaciones_averia        ON reparaciones(averia_id);
CREATE INDEX idx_catalogo_sku               ON catalogo_medias(sku);
CREATE INDEX idx_movimientos_tipo           ON movimientos_stock(tipo);

-- =====================================================
-- DESACTIVAR ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE usuarios               DISABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_medias        DISABLE ROW LEVEL SECURITY;
ALTER TABLE marcas_maquinas        DISABLE ROW LEVEL SECURITY;
ALTER TABLE maquinas               DISABLE ROW LEVEL SECURITY;
ALTER TABLE turnos_produccion      DISABLE ROW LEVEL SECURITY;
ALTER TABLE turno_maquinas         DISABLE ROW LEVEL SECURITY;
ALTER TABLE reportes_produccion    DISABLE ROW LEVEL SECURITY;
ALTER TABLE minidepositos          DISABLE ROW LEVEL SECURITY;
ALTER TABLE lotes_remallado        DISABLE ROW LEVEL SECURITY;
ALTER TABLE reportes_remallado     DISABLE ROW LEVEL SECURITY;
ALTER TABLE cronograma_planchado   DISABLE ROW LEVEL SECURITY;
ALTER TABLE reportes_planchado     DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_listo_planchar   DISABLE ROW LEVEL SECURITY;
ALTER TABLE ubicaciones            DISABLE ROW LEVEL SECURITY;
ALTER TABLE paquetes               DISABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_stock      DISABLE ROW LEVEL SECURITY;
ALTER TABLE clientes               DISABLE ROW LEVEL SECURITY;
ALTER TABLE ventas                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE items_venta            DISABLE ROW LEVEL SECURITY;
ALTER TABLE cuotas                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE cobros                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE cajas_diarias          DISABLE ROW LEVEL SECURITY;
ALTER TABLE guias_remision         DISABLE ROW LEVEL SECURITY;
ALTER TABLE averias_maquinas       DISABLE ROW LEVEL SECURITY;
ALTER TABLE reparaciones           DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- Base de datos en CERO y lista.
-- Crea el primer usuario Admin desde el modulo Usuarios.
-- =====================================================

