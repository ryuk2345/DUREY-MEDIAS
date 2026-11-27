---
type: plan
title: Plan de fases — cambios pedidos por el cliente
timestamp: 2026-11-27
---

# Plan de fases DUREY

Cada fase = una rama + un PR con pruebas. FTD en fases 1, 2 y 7; ASDD en 3 a 6.

| Fase | Contenido | Método | Estado |
|---|---|---|---|
| 1 | Correcciones y botones (materia prima, cuentas por pagar, filtros de máquinas, almacenes, agencias, copiar asignación) | FTD | hecha — PR #14; migraciones 026, 027 y 028 en la base real |
| 2 | Reportes con nombres | FTD | hecha — PR #16 (sin migración) |
| 3 | Repuestos y mecánicos | ASDD | hecha — PR #18 (migración 029) y PR #19 (030, permisos exactos); constitución v1.0.0 en PR #17 |
| 4 | Mantenimiento preventivo e historia clínica de máquinas | ASDD | hecha — PR #20; migración 031 en la base real (2026-11-26) |
| 5 | Nuevo flujo de producción, tintorería; operario por máquina y turno | ASDD | hecha — 5A PR #22 (032) y 5B PR #23 (033), en la base real |
| 6 | Almacén, ventas y despacho; quién despachó | ASDD | hecha — 6A PR #24 (034) y 6B PR #25; corrección de Ventas PR #26 (035); en la base real |
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

## Decisiones de la Fase 3 (2026-11-25)
1. Todo es al contado. El gasto de un repuesto se cuenta al comprarlo, por el precio pagado; usarlo en una falla ya no crea egreso.
2. Costo del repuesto = último precio pagado. Precio 0 permitido.
3. Compra en efectivo con casilla «Pagado con efectivo de la caja del día» (marcada por defecto): resta de la caja; desmarcada, solo cuenta como gasto.
4. Proveedor opcional. El ajuste manual de stock se mantiene, sin egreso. Quitar un repuesto usado devuelve su stock.
5. Se quita el rol técnico. Mecánico = nombre, apellido y número. Las fallas antiguas guardan el técnico como texto.
6. Gasto de reparación = solo mano de obra (los repuestos ya se contaron al comprarlos).
7. Lección de la 029: Supabase da todos los permisos a `authenticated` en tablas nuevas. La 030 los dejó exactos y cada migración nueva los revoca y los da uno a uno.

Detalle: `02-DOCS/wiki/sdd/specs/fase-3-repuestos-mecanicos.md`.

## Decisiones de la Fase 4 (2026-11-26)
1. Plan de mantenimiento por máquina, cada N días. La próxima fecha cuenta desde el día en que se terminó el último.
2. «Próximo» = vence en 3 días o menos. Máquinas avisa de los vencidos.
3. Al iniciar, la máquina pasa a «mantenimiento»; al terminar vuelve a «activa».
4. Un plan no se borra: se desactiva (su historial queda protegido).
5. Historia clínica por día o por semana, con PDF y Excel; incluye la producción de remallado.
6. Gasto de mantenimiento = mano de obra de reparaciones y de preventivos.

Detalle: `02-DOCS/wiki/sdd/specs/fase-4-mantenimiento-preventivo.md`.

## Anotado de la Fase 4 (no bloquea)
- Ya existía antes: al borrar una máquina con fallas o producción, primero se quitan sus diseños asignados y después la base rechaza el borrado. Corregir aparte.
- La comprobación previa al borrar una máquina no tiene test en el mock.

## Decisiones de la Fase 5 (2026-11-26 y 2026-11-27)
- Tejido 24/6: registro por máquina y turno con operario; tejido y remallado no se controlan por máquina: el dueño reúne la producción y asigna lotes a la remalladora.
- Stock de fuera: medias ya producidas se ingresan eligiendo la etapa en que están.
- Una media cruda pasa a teñida con otro SKU (otro color). Volteado se mantiene y va antes de tintorería. No hay tintorería externa.
- Bloqueo por rol en las funciones de producción (`exigir_modulo`, migración 033).

## Decisiones de la Fase 6 (2026-11-27)
- Q1-A Decolecta para RUC/DNI; Q2-A el inventario cuenta sacos con docenas por SKU; Q3-B solo se despachan sacos completos; Q4-A la orden dice salón y saco; Q5-A hay traslados entre salones en el kardex.
- Un saco lleva un solo SKU. C1-A: almacén elige los sacos; si falta no deja; si sobra avisa y queda en el kardex.
- 6B-1-B: la orden lista todos los sacos disponibles por SKU. 6B-2-A: búsqueda RUC/DNI construida; sin token dice «no configurada». Sin tope de consultas por ahora.
- Ventas (2-A): sin crudos; stock para vender = sacos menos lo vendido sin despachar.

## Pendiente fuera de fase
- Token de Decolecta: crear `DECOLECTA_TOKEN` en Vercel cuando el dueño lo tenga.
- Supuesto sin confirmar: los sacos por almacenar cuentan como stock para vender.

## Pendiente para la Fase 7
- `proxy.ts` repite la lista de rutas por rol: unificarla con `MODULOS_POR_ROL`.
- `cajas_diarias` y `clientes` aún se escriben directo con sesión (dinero, no stock): pasarlas a funciones.
- El mock escribe «10» donde la base escribe «10.00» en algunos mensajes.
- El despacho con sobrante no toma el cerrojo de stock de Ventas (ventana mínima).
- Egresos y Balance cuentan cada compra recibida por su costo total el día en que se recibe, aunque sea a plazos. Revisar para que reflejen los pagos reales.

## Preguntas abiertas (antes de su fase)
1. Tintorería (F5): respondida — otro SKU (el del color).
2. Máquinas 24/6 (F5): respondida — por máquina y turno con operario.
3. SUNAT (F6): respondida — Decolecta; falta el token.
4. Correo (F7): ¿qué servicio de envío y a qué correos?
5. Borrado final: ¿"personal" incluye asignaciones de turno? ¿"materia prima" incluye proveedores, compras y repuestos?
6. Volteado (F5): respondida — sí, antes de tintorería. Pregunta original: ¿se sigue volteando? Desde la migración 011 el flujo va de remallado directo a planchado y la pantalla de Volteado ya no recibe stock. Si se sigue volteando, va en la Fase 5.
