-- Migración 011: Redefinición de RPC finalizar_lote_remallado
-- Redirige la salida del proceso de Remallado directamente a Planchado,
-- ignorando el paso intermedio de Volteado.

BEGIN;

-- Asegurar que existe la restricción UNIQUE en stock_listo_planchar(catalogo_media_id)
-- de forma segura (sin fallar si ya está definida en el schema real)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints tc 
    JOIN information_schema.key_column_usage kcu 
      ON tc.constraint_name = kcu.constraint_name 
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_name = 'stock_listo_planchar' 
      AND tc.constraint_type = 'UNIQUE' 
      AND kcu.column_name = 'catalogo_media_id'
  ) THEN
    ALTER TABLE stock_listo_planchar 
      ADD CONSTRAINT stock_listo_planchar_catalogo_media_id_key UNIQUE (catalogo_media_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION finalizar_lote_remallado(
  p_lote_id UUID,
  p_docenas_remalladas NUMERIC(10,2),
  p_docenas_restantes NUMERIC(10,2),
  p_catalogo_media_id UUID,
  p_remalladora_id UUID,
  p_maquina_id UUID
) RETURNS VOID AS $$
BEGIN
  -- 1. INSERT en reportes_remallado
  INSERT INTO reportes_remallado (
    lote_id,
    remalladora_id,
    maquina_id,
    docenas_remalladas,
    docenas_restantes,
    fecha
  ) VALUES (
    p_lote_id,
    p_remalladora_id,
    p_maquina_id,
    p_docenas_remalladas,
    p_docenas_restantes,
    CURRENT_DATE
  );

  -- 2. UPDATE lotes_remallado
  UPDATE lotes_remallado
  SET estado = 'completado',
      docenas_pendientes = p_docenas_restantes
  WHERE id = p_lote_id;

  -- 3. UPSERT en stock_listo_planchar (en lugar de stock_listo_voltear)
  INSERT INTO stock_listo_planchar (catalogo_media_id, docenas)
  VALUES (p_catalogo_media_id, p_docenas_remalladas)
  ON CONFLICT (catalogo_media_id)
  DO UPDATE SET docenas = stock_listo_planchar.docenas + p_docenas_remalladas,
                updated_at = NOW();

  -- 4. UPDATE usuarios (liberar operadora si existe)
  IF p_remalladora_id IS NOT NULL THEN
    UPDATE usuarios
    SET estado = 'disponible'
    WHERE id = p_remalladora_id;
  END IF;

  -- 5. UPDATE maquinas (liberar máquina si existe)
  IF p_maquina_id IS NOT NULL THEN
    UPDATE maquinas
    SET estado = 'activa'
    WHERE id = p_maquina_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION finalizar_lote_remallado TO authenticated;
GRANT EXECUTE ON FUNCTION finalizar_lote_remallado TO service_role;

COMMIT;
