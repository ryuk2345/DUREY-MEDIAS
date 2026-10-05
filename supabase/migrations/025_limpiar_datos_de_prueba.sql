-- ==============================================================================
-- Migración 025: Quitar los datos de prueba que las migraciones 003, 004 y 013
-- insertaron en la base real.
--
-- Esas migraciones sembraron proveedores con RUC ficticios, hilos y repuestos
-- con stock inventado, 3 egresos "de prueba" por S/ 4,750 (que el Balance suma
-- como gastos reales) y 3 eventos de calendario de ejemplo.
--
-- Criterio CONSERVADOR: solo se borra una fila si sigue exactamente como la
-- dejó la semilla y nada depende de ella. Si ya se usó (se le cambió el stock,
-- tiene compras, movimientos o productos asociados), se conserva.
-- Las marcas de máquina y los salones de la migración 002 son datos de
-- referencia reales y NO se tocan.
--
-- Para ver antes qué se borraría, ejecutar solo los SELECT del final de este
-- archivo (sección "Vista previa").
-- ==============================================================================

BEGIN;

-- 1. Egresos de prueba (migración 004, sección "INSERTAR EGRESOS DE PRUEBA")
DELETE FROM egresos_adicionales
 WHERE (concepto, monto, categoria) IN (
   ('Pago de alquiler local agosto', 2500.00, 'alquiler'),
   ('Recibo de luz del taller', 450.00, 'servicios'),
   ('Pago de planilla semanal tejedores', 1800.00, 'planilla')
 );

-- 2. Eventos de ejemplo del calendario (migración 013), sin autor real
DELETE FROM eventos_calendario
 WHERE creado_por IS NULL
   AND (titulo, creado_por_nombre) IN (
     ('Reunión de Coordinación de Producción', 'Administración'),
     ('Mantenimiento Preventivo Máquinas M01 y M02', 'Supervisión'),
     ('Entrega Programada Pedido Mayorista', 'Ventas / Despacho')
   );

-- 3. Repuestos de ejemplo (migración 004) que nunca se movieron
DELETE FROM repuestos
 WHERE (nombre, stock_actual, costo_unitario) IN (
   ('Sensor de aguja M8', 15, 45.00),
   ('Plancha de hormado T1', 3, 250.00),
   ('Correa dentada de motor', 8, 35.00),
   ('Agujas tejedora calibre 12', 200, 1.50)
 );

-- 4. Hilos de ejemplo (migración 003) con el stock inventado intacto y sin uso
DELETE FROM materia_prima mp
 WHERE (mp.material, mp.color, mp.stock_kg) IN (
   ('Algodón', 'Blanco', 150.000),
   ('Algodón', 'Negro', 120.000),
   ('Algodón', 'Rojo', 2.000),
   ('Lana', 'Roja', 0.000),
   ('Lycra', 'Blanco', 50.000)
 )
   AND NOT EXISTS (SELECT 1 FROM compras_materia_prima c WHERE c.materia_prima_id = mp.id)
   AND NOT EXISTS (SELECT 1 FROM movimientos_materia_prima m WHERE m.materia_prima_id = mp.id)
   AND NOT EXISTS (SELECT 1 FROM catalogo_medias cm WHERE cm.materia_prima_id = mp.id);

-- 5. Proveedores de ejemplo (migración 003) con RUC ficticio y sin compras
DELETE FROM proveedores p
 WHERE (p.nombre, p.ruc) IN (
   ('Hilados del Sur', '20123456789'),
   ('Textiles Andinos', '20987654321')
 )
   AND NOT EXISTS (SELECT 1 FROM compras_materia_prima c WHERE c.proveedor_id = p.id);

COMMIT;

-- ── Vista previa (ejecutar por separado, ANTES de la migración, para revisar) ──
-- SELECT * FROM egresos_adicionales WHERE concepto IN ('Pago de alquiler local agosto','Recibo de luz del taller','Pago de planilla semanal tejedores');
-- SELECT * FROM eventos_calendario WHERE creado_por IS NULL AND creado_por_nombre IN ('Administración','Supervisión','Ventas / Despacho');
-- SELECT * FROM repuestos WHERE nombre IN ('Sensor de aguja M8','Plancha de hormado T1','Correa dentada de motor','Agujas tejedora calibre 12');
-- SELECT * FROM materia_prima WHERE (material, color) IN (('Algodón','Blanco'),('Algodón','Negro'),('Algodón','Rojo'),('Lana','Roja'),('Lycra','Blanco'));
-- SELECT * FROM proveedores WHERE ruc IN ('20123456789','20987654321');
