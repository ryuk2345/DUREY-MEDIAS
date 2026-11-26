---
type: plan
title: Plan de fases — cambios pedidos por el cliente
timestamp: 2026-11-25
---

# Plan de fases DUREY

Cada fase = una rama + un PR con pruebas. FTD en fases 1, 2 y 7; ASDD en 3 a 6.

| Fase | Contenido | Método | Estado |
|---|---|---|---|
| 1 | Correcciones y botones (materia prima, cuentas por pagar, filtros de máquinas, almacenes, agencias, copiar asignación) | FTD | hecha — PR #14; migraciones 026, 027 y 028 en la base real |
| 2 | Reportes con nombres | FTD | en curso — `fase-2/reportes-con-nombres` |
| 3 | Repuestos y mecánicos | ASDD | pendiente — antes: ratificar constitución desde AGENTS.md |
| 4 | Mantenimiento preventivo e historia clínica de máquinas | ASDD | pendiente |
| 5 | Nuevo flujo de producción, tintorería; operario por máquina y turno | ASDD | pendiente |
| 6 | Almacén, ventas y despacho; quién despachó | ASDD | pendiente |
| 7 | Transversal: filtros predictivos, editar productos, correo | FTD | pendiente |
| Final | Borrar datos (excepto personal y materia prima) | — | solo con confirmación escrita |

## Decisiones de la Fase 1 (2026-11-25)
1. Agencias: en Fase 1, migración 027 con checklist completo de AGENTS.md.
2. Pago a proveedores: cada pago con fecha, monto y método. Efectivo → resta de la caja del día con función atómica (igual que cobros de ventas). Transferencia u otro → solo historial.
3. Copiar asignación en Tejido: máquinas con su producto y operarios del turno; rellena el formulario, el usuario revisa antes de guardar.
4. Eliminar almacén: borrado suave; bloqueado si tiene paquetes dentro, explicado en pantalla.

## Decisiones de la Fase 2 (2026-11-25)
1. Tejido: encargado = tejedor del turno; operarios = asignados en el Calendario de Turnos (área tejido, misma fecha y turno). Sin migración.
2. Volteado: sin reporte. Desde la migración 011 el flujo va de remallado a planchado y Volteado ya no recibe stock.
3. Despacho: quién despachó pasa a la Fase 6.

## Pendiente para la Fase 5
- Operario por máquina y turno en tejido (máquinas 24/6 con registro diario por máquina y turno). Reemplaza la regla provisional de la Fase 2 (operarios tomados del Calendario de Turnos).
- Volteado, solo si el cliente confirma que se sigue volteando (pregunta 6).

## Pendiente para la Fase 6
- Despacho: registrar quién despachó (guías de remisión) y mostrarlo en el kardex y en el reporte de Almacén y Despacho.

## Pendiente para la Fase 7
- Egresos y Balance cuentan cada compra recibida por su costo total el día en que se recibe, aunque sea a plazos. Revisar para que reflejen los pagos reales.

## Preguntas abiertas (antes de su fase)
1. Tintorería (F5): al volver teñida, ¿otro SKU o el mismo con otro color?
2. Máquinas 24/6 (F5): ¿registro diario por turno o uno por día?
3. SUNAT (F6): ¿qué servicio de consulta RUC/DNI?
4. Correo (F7): ¿qué servicio de envío y a qué correos?
5. Borrado final: ¿"personal" incluye asignaciones de turno? ¿"materia prima" incluye proveedores, compras y repuestos?
6. Volteado (F5): ¿se sigue volteando? Desde la migración 011 el flujo va de remallado directo a planchado y la pantalla de Volteado ya no recibe stock. Si se sigue volteando, va en la Fase 5.
