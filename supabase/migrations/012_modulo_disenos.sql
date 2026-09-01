-- ============================================================================
-- Migración 012: Módulo de Diseñadores, Fichas de Muestras y Asignación N-a-N
-- ============================================================================

BEGIN;

-- 1. Storage Bucket 'disenos' (5MB máx, JPG/PNG/WEBP)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'disenos',
  'disenos',
  true,
  5242880, -- 5 MB exactos (5 * 1024 * 1024 bytes)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Políticas de Storage
DO $$
BEGIN
  -- Lectura pública
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Permitir lectura publica fotos disenos'
  ) THEN
    CREATE POLICY "Permitir lectura publica fotos disenos"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'disenos');
  END IF;

  -- Inserción autenticada
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Permitir subida fotos disenos autenticados'
  ) THEN
    CREATE POLICY "Permitir subida fotos disenos autenticados"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'disenos');
  END IF;

  -- Actualización autenticada
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Permitir actualizacion fotos disenos'
  ) THEN
    CREATE POLICY "Permitir actualizacion fotos disenos"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'disenos');
  END IF;

  -- Eliminación autenticada
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Permitir eliminacion fotos disenos'
  ) THEN
    CREATE POLICY "Permitir eliminacion fotos disenos"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'disenos');
  END IF;
END $$;


-- 2. Tabla Principal: disenos
CREATE TABLE IF NOT EXISTS disenos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              TEXT UNIQUE NOT NULL,                       -- Ej: DIS-001
  nombre              TEXT NOT NULL,                              -- Ej: Media Invisible Talon Alto
  foto_url            TEXT,                                       -- URL en Supabase Storage
  color_muestra       TEXT NOT NULL,                              -- Ej: Azul Marino / Blanco
  marca_id            UUID REFERENCES marcas_maquinas(id) ON DELETE SET NULL,
  disenador_id        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  orden_muestra       TEXT NOT NULL,                              -- Lote u orden de muestra (Ej: MUE-849)
  cantidad_muestra    INTEGER NOT NULL DEFAULT 1,                 -- Pares / Docenas
  estado              TEXT NOT NULL DEFAULT 'en_muestra' 
                      CHECK (estado IN ('en_muestra', 'aprobada', 'rechazada', 'en_produccion', 'archivada')),
  observaciones       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);


-- 3. Tabla de Relación N-a-N: disenos_maquinas (con ON DELETE RESTRICT)
CREATE TABLE IF NOT EXISTS disenos_maquinas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diseno_id         UUID NOT NULL REFERENCES disenos(id) ON DELETE RESTRICT,
  maquina_id        UUID NOT NULL REFERENCES maquinas(id) ON DELETE RESTRICT,
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_asignacion  TIMESTAMPTZ DEFAULT NOW(),
  
  -- Garantiza que el mismo diseño no se duplique en la misma máquina
  UNIQUE (diseno_id, maquina_id)
);

CREATE INDEX IF NOT EXISTS idx_disenos_maquinas_maquina ON disenos_maquinas(maquina_id);
CREATE INDEX IF NOT EXISTS idx_disenos_maquinas_diseno ON disenos_maquinas(diseno_id);


-- 4. Funciones RPC Transaccionales

-- RPC 1: Registrar diseño con sus asignaciones iniciales en 1 transacción atómica
CREATE OR REPLACE FUNCTION registrar_diseno_con_asignaciones(
  p_codigo           TEXT,
  p_nombre           TEXT,
  p_foto_url         TEXT,
  p_color_muestra    TEXT,
  p_marca_id         UUID,
  p_disenador_id     UUID,
  p_orden_muestra    TEXT,
  p_cantidad_muestra INTEGER,
  p_observaciones    TEXT,
  p_maquina_ids      UUID[]
) RETURNS UUID AS $$
DECLARE
  v_diseno_id UUID;
  v_maquina_id UUID;
BEGIN
  -- Insertar diseño
  INSERT INTO disenos (
    codigo,
    nombre,
    foto_url,
    color_muestra,
    marca_id,
    disenador_id,
    orden_muestra,
    cantidad_muestra,
    observaciones,
    estado
  ) VALUES (
    p_codigo,
    p_nombre,
    p_foto_url,
    p_color_muestra,
    p_marca_id,
    p_disenador_id,
    p_orden_muestra,
    COALESCE(p_cantidad_muestra, 1),
    p_observaciones,
    'en_muestra'
  ) RETURNING id INTO v_diseno_id;

  -- Insertar asignaciones de máquinas
  IF p_maquina_ids IS NOT NULL AND array_length(p_maquina_ids, 1) > 0 THEN
    FOREACH v_maquina_id IN ARRAY p_maquina_ids LOOP
      INSERT INTO disenos_maquinas (diseno_id, maquina_id, activo)
      VALUES (v_diseno_id, v_maquina_id, TRUE)
      ON CONFLICT (diseno_id, maquina_id) 
      DO UPDATE SET activo = TRUE, fecha_asignacion = NOW();
    END LOOP;
  END IF;

  RETURN v_diseno_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 2: Asignar o reasignar máquinas a un diseño en 1 transacción
CREATE OR REPLACE FUNCTION asignar_diseno_a_maquinas(
  p_diseno_id   UUID,
  p_maquina_ids UUID[]
) RETURNS VOID AS $$
DECLARE
  v_maquina_id UUID;
BEGIN
  -- Desactivar asignaciones previas que ya no estén en la lista
  UPDATE disenos_maquinas
  SET activo = FALSE
  WHERE diseno_id = p_diseno_id
    AND (p_maquina_ids IS NULL OR NOT (maquina_id = ANY(p_maquina_ids)));

  -- Activar / insertar las nuevas asignaciones seleccionadas
  IF p_maquina_ids IS NOT NULL AND array_length(p_maquina_ids, 1) > 0 THEN
    FOREACH v_maquina_id IN ARRAY p_maquina_ids LOOP
      INSERT INTO disenos_maquinas (diseno_id, maquina_id, activo)
      VALUES (p_diseno_id, v_maquina_id, TRUE)
      ON CONFLICT (diseno_id, maquina_id)
      DO UPDATE SET activo = TRUE, fecha_asignacion = NOW();
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 3: Actualizar estado de la muestra de un diseño
CREATE OR REPLACE FUNCTION actualizar_estado_muestra_diseno(
  p_diseno_id      UUID,
  p_nuevo_estado   TEXT,
  p_observaciones  TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE disenos
  SET estado = p_nuevo_estado,
      observaciones = COALESCE(p_observaciones, observaciones),
      updated_at = NOW()
  WHERE id = p_diseno_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Otorgar permisos a roles de Supabase
GRANT EXECUTE ON FUNCTION registrar_diseno_con_asignaciones TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION asignar_diseno_a_maquinas TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION actualizar_estado_muestra_diseno TO authenticated, service_role, anon;

-- Desactivar RLS en tablas internas de la aplicación
ALTER TABLE disenos DISABLE ROW LEVEL SECURITY;
ALTER TABLE disenos_maquinas DISABLE ROW LEVEL SECURITY;

COMMIT;
