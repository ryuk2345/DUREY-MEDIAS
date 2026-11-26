---
type: plan
title: Plan de fases — cambios pedidos por el cliente
timestamp: 2026-11-25
---

# Plan de fases DUREY

Cada fase = una rama + un PR con pruebas. FTD en fases 1, 2 y 7; ASDD en 3 a 6.

| Fase | Contenido | Método | Estado |
|---|---|---|---|
| 1 | Correcciones y botones (materia prima, cuentas por pagar, filtros de máquinas, almacenes, agencias, copiar asignación) | FTD | en curso — `fase-1/correcciones-botones` |
| 2 | Reportes con nombres | FTD | pendiente |
| 3 | Repuestos y mecánicos | ASDD | pendiente — antes: ratificar constitución desde AGENTS.md |
| 4 | Mantenimiento preventivo e historia clínica de máquinas | ASDD | pendiente |
| 5 | Nuevo flujo de producción, tintorería | ASDD | pendiente |
| 6 | Almacén, ventas y despacho | ASDD | pendiente |
| 7 | Transversal: filtros predictivos, editar productos, correo | FTD | pendiente |
| Final | Borrar datos (excepto personal y materia prima) | — | solo con confirmación escrita |

## Decisiones de la Fase 1 (2026-11-25)
1. Agencias: en Fase 1, migración 027 con checklist completo de AGENTS.md.
2. Pago a proveedores: cada pago con fecha, monto y método. Efectivo → resta de la caja del día con función atómica (igual que cobros de ventas). Transferencia u otro → solo historial.
3. Copiar asignación en Tejido: máquinas con su producto y operarios del turno; rellena el formulario, el usuario revisa antes de guardar.
4. Eliminar almacén: borrado suave; bloqueado si tiene paquetes dentro, explicado en pantalla.

## Pendiente para la Fase 7
- Egresos y Balance cuentan cada compra recibida por su costo total el día en que se recibe, aunque sea a plazos. Revisar para que reflejen los pagos reales.

## Preguntas abiertas (antes de su fase)
1. Tintorería (F5): al volver teñida, ¿otro SKU o el mismo con otro color?
2. Máquinas 24/6 (F5): ¿registro diario por turno o uno por día?
3. SUNAT (F6): ¿qué servicio de consulta RUC/DNI?
4. Correo (F7): ¿qué servicio de envío y a qué correos?
5. Borrado final: ¿"personal" incluye asignaciones de turno? ¿"materia prima" incluye proveedores, compras y repuestos?
