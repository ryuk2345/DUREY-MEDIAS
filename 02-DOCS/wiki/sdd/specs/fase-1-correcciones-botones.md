---
type: spec
title: Spec — Fase 1, correcciones y botones
description: WHAT y WHY de la Fase 1 — compras y cuentas por pagar visibles, pagos a proveedores, filtros de máquinas, editar/eliminar almacenes, agencias y copiar asignación de tejido.
tags: [sdd, spec, fase-1]
timestamp: 2026-11-25T21:30:00Z
topic: sdd
slug: fase-1-correcciones-botones
branch: fase-1/correcciones-botones
status: approved
---

# Spec — Fase 1, correcciones y botones

> Slug: `fase-1-correcciones-botones` · Status: approved · Created: 2026-11-25
> Inherits: [constitution](../constitution.md) (borrador; se ratifica antes de la Fase 3) y AGENTS.md
> Promovida desde el documento FTD [fase-1-correcciones-botones](../../ftd/fase-1-correcciones-botones.md) porque `rsc risk` la clasificó como nivel 2 (migración con tablas nuevas).

## Problem & why
El cliente ve fallos y le faltan botones en el uso diario: registra una compra a crédito y no la ve reflejada ni en el insumo ni en la deuda del proveedor; las cuentas por pagar no se resumen arriba ni se pueden planificar ni pagar con registro de la salida; las tarjetas de máquinas no filtran; no puede editar ni eliminar almacenes; solo hay 4 agencias fijas; y cada día rehace a mano la asignación de tejido.

## Cost of not building it
La deuda con proveedores se ve en 0 aunque exista, y los pagos en efectivo no salen de la caja: el cierre de caja marca sobrantes falsos. El supervisor pierde tiempo cada día copiando la asignación de máquinas. Agencias nuevas no se pueden usar.

## The cheapest alternative
Llevar las cuotas y pagos en una hoja aparte y explicar el flujo de control de calidad de palabra. No basta: duplica datos fuera de la base (prohibido por el proyecto) y el cierre de caja seguiría sin cuadrar.

## Goals
- Lo que se compra se ve: "en camino" hasta aprobar control de calidad, y su deuda en las cuentas por pagar.
- Cada pago a proveedor queda registrado; el efectivo sale de la caja del día.
- Las 4 tarjetas de máquinas filtran la lista.
- Almacenes se renombran y se eliminan (borrado suave) sin perder historial.
- Agencias se añaden desde Despacho.
- La asignación de tejido del día anterior se copia al formulario para revisar.

## Non-goals / out of scope
- Egresos y Balance siguen contando la compra recibida por su costo total (anotado para la Fase 7).
- No se cambia cuándo sube el stock (sigue siendo al aprobar control de calidad).
- No se elimina físicamente ningún almacén ni agencia.
- No se copia la asignación de operarios de otras áreas (Calendario de Turnos); solo el tejedor encargado del lote.
- Pagos parciales de una cuota.

## Users & context
Administrador y supervisor de planta (materia prima, máquinas, almacén, tejido) y personal de despacho y caja.

## What the user can do
- Registrar una compra y ver en el insumo cuánto está "en camino" y, si es a crédito, sus cuotas.
- Ver arriba en Cuentas por Pagar: total, vencido, vence en 7 días y en 30 días.
- Pagar una cuota indicando fecha (no futura) y método; reprogramar la fecha de una cuota pendiente.
- Pulsar una tarjeta de estado de máquinas y ver solo esas máquinas; volver a "todas".
- Renombrar un almacén; eliminarlo si no tiene paquetes dentro.
- Añadir una agencia al despachar.
- Copiar la asignación de tejido del último día anterior (mismo horario) al formulario.
Quién: usuarios con sesión y acceso al módulo (MODULOS_POR_ROL). Nadie sin sesión.

## What result they get
Referencia aprobada por el dueño: el plan de la Fase 1 y sus respuestas del 2026-11-25 (abajo, en Approval).
- Pago en efectivo con fecha de hoy y caja abierta: la caja del día muestra el pago y el efectivo esperado baja en ese monto. Transferencia u otro: solo historial.
- Almacén con paquetes dentro: la pantalla dice «No se puede eliminar X: tiene N paquete(s) dentro. Muévelos o despáchalos primero.»
- Copiar asignación: el formulario queda relleno con máquinas, producto y tejedor; nada se guarda hasta "Validar y Cargar Lote"; las máquinas no activas se informan y no se copian.

## What it must respect
- AGENTS.md: migración 027 nueva dentro de BEGIN/COMMIT; datos migrados antes de restricciones; GRANT solo a authenticated y service_role; RLS con política `durey_usuarios_con_sesion` en tablas nuevas.
- Lógica de negocio en la base (funciones atómicas) o en `lib/domain`, no duplicada en pantallas.
- Los datos se guardan solo en la base.
- Las guías de remisión antiguas conservan su agencia (texto).
- El stock sigue subiendo solo al aprobar control de calidad (migración 024).
- Los cobros de ventas en caja siguen igual (migración 023).

## How it proves it
- `npm test`: tests/e2e/15-fase1-correcciones-botones.test.ts (reglas de pago, caja, agencias, almacenes, filtros, copia) y checklist estático de la migración.
- `npm run test:browser`: tests/browser/fase1-correcciones-botones.spec.ts y flujo-comercial (agencia nueva) en verde.
- supabase/tests/027_agencias_pagos_proveedores_almacenes.test.sql contra una base de prueba con la 027.
- `npm run build` en verde. Evidencia en el documento FTD.

## Behaviour
- Main path: como en "What the user can do".
- Edge cases: efectivo sin caja abierta → queda en historial y se avisa (mismo criterio que los cobros); efectivo con fecha pasada → no toca la caja de hoy; cuota ya pagada → no se paga ni reprograma; agencia repetida (mayúsculas/espacios) → rechazada, y si estaba dada de baja se reactiva; nombre de almacén repetido → rechazado; paquetes 'entregado' no cuentan como "dentro".
- Error paths: mensajes de la base en pantalla, sin datos a medias.

## Acceptance criteria
- Given una compra a crédito de 3 cuotas, When se registra, Then el insumo muestra la cantidad en camino y Cuentas por Pagar muestra 3 cuotas pendientes y la deuda del proveedor.
- Given una caja abierta hoy, When se paga una cuota en efectivo con fecha de hoy, Then pagos_efectivo de la caja sube en el monto y el pago queda en el historial con esa caja.
- Given una cuota, When se paga por transferencia, Then la caja no cambia y el pago queda en el historial.
- Given una cuota pagada, When se intenta pagar o reprogramar, Then se rechaza.
- Given un almacén con un paquete no entregado, When se elimina, Then se rechaza con el mensaje y sigue visible; vacío, se oculta y su historial se conserva.
- Given la tarjeta Mantenimiento, When se pulsa, Then solo aparecen máquinas en mantenimiento.
- Given un turno anterior con una máquina hoy en mantenimiento, When se copia, Then esa máquina no se copia y se informa.
- Given la migración 027, Then no da permisos a anon y las tablas nuevas tienen RLS.

## Points to clarify
- **suposición tomada** — "Operarios del turno" en Tejido = el tejedor encargado del lote. *Base:* es el operario del formulario que se rellena. *Riesgo:* si se refería al Calendario de Turnos (todas las áreas), falta un botón allí.
- **suposición tomada** — "Paquetes dentro" = paquetes del almacén con estado distinto de 'entregado'. *Base:* los entregados ya salieron. *Riesgo:* bajo.
- **suposición tomada** — Efectivo sin caja abierta se registra igual (sin restar). *Base:* el dueño pidió "igual que los cobros de ventas", que funcionan así. *Riesgo:* si se quiere bloquear, cambia la función.
- **decisión diferida** — Egresos/Balance a plazos → Fase 7.

## Approval
Aprobada por el dueño del proyecto el 2026-11-25: «Respuestas al plan de la Fase 1 (OK al plan con esto): 1. Agencias: hazlo en la Fase 1, con la migración 027 y el checklist completo de AGENTS.md … 2. Pago a proveedores: registra cada pago con fecha, monto y método. Si el método es efectivo, réstalo de la caja del día con una función atómica en la base (igual que los cobros de ventas). Si es transferencia u otro, solo queda en el historial. 3. Copiar asignación en Tejido: ambos, máquinas con su producto y operarios del turno. Se rellena el formulario y yo reviso antes de guardar. 4. Eliminar almacén: sí, borrado suave. Bloquear si tiene paquetes dentro y explicarlo en pantalla.»
