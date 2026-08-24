-- Migración 010: Función RPC para finalizar lote de remallado de forma transaccional (atómica)

BEGIN;

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

  -- 3. UPSERT en stock_listo_voltear
  INSERT INTO stock_listo_voltear (catalogo_media_id, docenas)
  VALUES (p_catalogo_media_id, p_docenas_remalladas)
  ON CONFLICT (catalogo_media_id)
  DO UPDATE SET docenas = stock_listo_voltear.docenas + p_docenas_remalladas,
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

-- Otorgar permisos de ejecución para roles de Supabase
GRANT EXECUTE ON FUNCTION finalizar_lote_remallado TO authenticated;
GRANT EXECUTE ON FUNCTION finalizar_lote_remallado TO service_role;

COMMIT;
