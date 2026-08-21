-- Migración 005: Vista para stock consolidado de medias en almacén
CREATE OR REPLACE VIEW vista_stock_medias AS
SELECT 
  catalogo_media_id,
  COALESCE(SUM(docenas), 0) AS stock_docenas
FROM paquetes
WHERE estado IN ('almacenado', 'pendiente_almacenar') AND catalogo_media_id IS NOT NULL
GROUP BY catalogo_media_id;
