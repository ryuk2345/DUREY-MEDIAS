-- Migración 006: Estructuras del Proceso de Volteado (Turning)

-- 1. Actualizar el CHECK constraint de roles de usuario
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN (
  'admin','supervisor','tejedor','remalladora','planchador','volteador','preparador','almacenero','vendedora','tecnico'
));

-- 2. Crear tabla de stock listo para voltear
CREATE TABLE IF NOT EXISTS stock_listo_voltear (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogo_media_id        UUID UNIQUE REFERENCES catalogo_medias(id) ON DELETE RESTRICT,
  docenas                  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Crear tabla de asignación de lotes de volteado
CREATE TABLE IF NOT EXISTS lotes_volteado (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  volteador_id             UUID REFERENCES usuarios(id) ON DELETE RESTRICT,
  catalogo_media_id        UUID REFERENCES catalogo_medias(id) ON DELETE RESTRICT,
  docenas_asignadas        NUMERIC(10,2) NOT NULL,
  docenas_pendientes       NUMERIC(10,2) NOT NULL,
  estado                   TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'completado')),
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Crear tabla de reportes y control de mermas de volteado
CREATE TABLE IF NOT EXISTS reportes_volteado (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lote_volteado_id         UUID REFERENCES lotes_volteado(id) ON DELETE CASCADE,
  volteador_id             UUID REFERENCES usuarios(id) ON DELETE RESTRICT,
  catalogo_media_id        UUID REFERENCES catalogo_medias(id) ON DELETE RESTRICT,
  docenas_volteadas        NUMERIC(10,2) NOT NULL,
  pares_defectuosos        INTEGER NOT NULL DEFAULT 0,
  comentarios              TEXT,
  fecha                    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

-- Crear índices de optimización para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_stock_listo_voltear_media ON stock_listo_voltear(catalogo_media_id);
CREATE INDEX IF NOT EXISTS idx_lotes_volteado_operario ON lotes_volteado(volteador_id);
CREATE INDEX IF NOT EXISTS idx_lotes_volteado_estado ON lotes_volteado(estado);
CREATE INDEX IF NOT EXISTS idx_reportes_volteado_lote ON reportes_volteado(lote_volteado_id);
