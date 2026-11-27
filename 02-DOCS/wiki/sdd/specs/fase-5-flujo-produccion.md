---
type: spec
title: Spec — Fase 5, nuevo flujo de producción (tejido 24/6, crudo, volteado, tintorería, preparado, stock de fuera)
description: Máquinas de tejido con producto fijo y registro por turno; todas las medias se tejen y remallan en crudo, se voltean y se tiñen en tintorería interna, donde pasan a su SKU con color; preparado con la lógica de planchado; ingreso de stock traído de fuera.
tags: [sdd, spec, fase-5]
timestamp: 2026-11-26T21:00:00Z
topic: sdd
slug: fase-5-flujo-produccion
branch: fase-5/flujo-produccion
status: approved
---

# Spec — Fase 5, nuevo flujo de producción

> Slug: `fase-5-flujo-produccion` · Status: approved · Created: 2026-11-26
> Inherits: [constitución v1.0.0](../constitution.md) y AGENTS.md. Plan: [plan-fases](../../plan-fases.md).

## Problem & why
- Las máquinas de tejido trabajan 24/6 con el mismo producto, pero el sistema obliga a asignarlo cada turno.
- No se sabe qué operario produjo en cada máquina y turno (regla provisional de la Fase 2).
- En la planta todas las medias se tejen y remallan en crudo, se voltean y se tiñen antes del planchado. El sistema no lo refleja: trata cada media con su color desde el tejido, y Volteado quedó sin stock desde la migración 011.
- Preparado no descuenta lo planchado, y a planchadores y preparadores no se les puede dar más de un SKU al día.
- No hay forma de ingresar medias traídas de fuera.

## Cost of not building it
El stock en proceso no cuadra con la planta, no se puede saber cuánto hay en crudo, volteado o en tintorería, y los reportes por persona quedan incompletos.

## The cheapest alternative
Seguir asignando cada turno y llevar tintorería en un cuaderno. No basta: el stock de cada etapa no se puede controlar y el color real solo aparece al planchar.

## Goals
- Tejido 24/6: cada máquina tiene un producto fijo que solo cambia el supervisor; cada turno (día y noche) se registra cuánto produjo cada máquina y qué operario la atendió.
- Flujo en crudo: tejido → remallado → volteado → tintorería → planchado → preparado. Desde el remallado, cada etapa toma de la anterior y deja en la siguiente (entre tejido y remallado la asignación es manual).
- Tintorería (interna, sin costo): enviar un lote crudo con su color; al volver, las docenas entran a planchado ya con su SKU de color; la diferencia es merma con motivo.
- Preparado con la lógica de planchado (sin las tarjetas de resumen) y varios SKU por persona y día en planchado y preparado.
- Botón "stock de fuera" en remallado, planchado y preparado: docenas, de dónde vino y quién lo ingresó, sin egreso.

## Non-goals / out of scope
- Costo de tintorería (decisión: es interna, sin costo).
- Egreso por el stock de fuera (decisión: solo se registra).
- Almacén, ventas y despacho (Fase 6).
- Borrar o reescribir lo ya registrado.

## Users & context
Supervisor (asigna producto a cada máquina, asigna planchadores y preparadores), tejedores y operarios de cada turno, remalladoras, volteado, tintorería, planchadores y preparadores.

## What the user can do
- **Tejido:** ver cada máquina con su producto; el supervisor lo cambia cuando decide. En cada turno (día o noche) registrar, por máquina, las docenas producidas y el operario.
- **Remallado:** asignar a mano un lote crudo a la remalladora (como hoy, sin descontar de tejido); al terminar queda listo para voltear.
- **Volteado:** tomar lo remallado; al terminar queda listo para tintorería.
- **Tintorería:** enviar un lote (media cruda, docenas, color, material algodón o poliéster, operadora que remalló); al volver, registrar las docenas recibidas y la merma con motivo; lo recibido entra a planchado con el SKU de ese color.
- **Planchado y preparado:** asignar a cada persona uno o varios SKU por día; registrar lo planchado o preparado; preparado toma de lo planchado.
- **Stock de fuera:** ingresar docenas eligiendo la etapa en la que están (remallado, volteado, tintorería, planchado o preparado) y el producto, con su origen; queda registrado quién lo ingresó.
Quién: usuarios con sesión y acceso al módulo (MODULOS_POR_ROL). Nadie sin sesión.

## What result they get
- Stock en proceso por etapa: crudo por remallar, por voltear, por teñir, en tintorería, por planchar, por preparar.
- Reportes por persona: operario por máquina y turno en tejido (reemplaza la regla provisional de la Fase 2), remalladora, volteado, planchador y preparador.
- Lo de fuera se ve separado de lo producido en la planta.

## What it must respect
- Constitución v1.0.0: migraciones nuevas con el checklist de AGENTS.md Regla 2; RLS y política `durey_usuarios_con_sesion`; permisos exactos para `authenticated` tabla por tabla; nada para `anon`; `search_path` fijo; test SQL y reversión en local.
- Cada paso que mueve stock es una función atómica de la base; el stock nunca queda negativo.
- Lo ya registrado se conserva; lo que esté en proceso con el modelo viejo puede terminar su camino.
- Flujo crítico (AGENTS.md Regla 4): tests E2E 01 y 03 actualizados.

## How it proves it
- Test SQL de cada migración y su reversión con `probar_migraciones.sh`.
- `npm test`: el camino completo de una docena (tejido → … → preparado), merma, stock de fuera, cambio de producto de una máquina.
- Playwright: registrar un turno, remallar, voltear, enviar y recibir de tintorería, planchar y preparar.
- Después de fusionar: migraciones aplicadas y verificadas en la base real.

## Behaviour
- Main path: como en "What the user can do".
- Edge cases: tomar más de lo que hay en una etapa → rechazado con el disponible; recibir de tintorería más de lo enviado → rechazado; merma sin motivo → rechazada; máquina en falla o mantenimiento → no se registra producción en ese turno; dos registros de la misma máquina y turno → rechazado.
- Error paths: mensajes de la base en pantalla, sin datos a medias.

## Acceptance criteria
- Given una máquina con producto fijo, When pasan varios turnos, Then no se vuelve a asignar; When el supervisor lo cambia, Then los turnos siguientes usan el nuevo.
- Given el turno noche de una máquina, When se registran 12 docenas con el operario Juan, Then el reporte de tejido muestra 12 docenas de Juan en esa máquina y turno.
- Given 12 docenas remalladas y volteadas, When se envían 12 a tintorería con color azul y vuelven 11 con 1 de merma "manchada", Then hay 11 docenas del SKU azul por planchar y la merma queda registrada.
- Given 11 docenas por planchar, When un planchador asignado a ese SKU plancha 11, Then hay 11 por preparar; When se preparan, Then se descuentan.
- Given 5 docenas traídas de fuera ingresadas en planchado, Then suben 5 por planchar y el registro dice de dónde vinieron y quién las ingresó, sin egreso.
- Given un usuario sin sesión, Then no ve ni toca nada de esto.

## Points to clarify
- **decidido (dueño, 2026-11-26)** — Todas las medias se tejen y remallan en crudo; en tintorería reciben color y pasan a su SKU final (respuestas 1-A y 3-B).
- **decidido (dueño, 2026-11-26)** — Tejido 24/6 se registra por turno, día y noche (2-A).
- **decidido (dueño, 2026-11-26)** — Tintorería interna, sin costo (4). Stock de fuera sin egreso (5-A). Diferencia en tintorería = merma con motivo (7-A).
- **decidido (dueño, 2026-11-26)** — Se sigue volteando; volteado va entre remallado y tintorería (6, opción A).
- **decidido (dueño, 2026-11-26)** — C1. Stock de fuera = medias que no salieron de las máquinas registradas: las ya producidas antes de usar el sistema y las traídas de otro lugar. Al ingresarlas se elige la etapa en la que están y el producto (crudo o SKU de color); entran como pendientes de esa etapa y siguen el flujo normal.
- **decidido (dueño, 2026-11-26)** — C2. Sin control de stock entre tejido y remallado: el dueño junta lo que sacan las máquinas y asigna cada lote a mano a la remalladora, como hoy. El control de stock por etapa empieza al terminar el remallado.
- **supuesto** — Stock de fuera en remallado: como remallado se asigna a mano, el lote se marca con origen "de fuera" (para separarlo de lo producido en la planta). *Riesgo:* bajo.
- **decidido (dueño, 2026-11-26)** — C3. El hilo se descuenta por las docenas reales registradas en cada turno (peso por docena del producto), no por el estimado de 15 docenas al abrir el turno.
- **supuesto** — La media cruda es un producto del catálogo con color "crudo" (mismo modelo, talla y público que sus SKU de color). Tintorería solo puede convertirla a un SKU de color con el mismo modelo, talla y público. *Riesgo:* si un modelo crudo da medias de otro modelo, cambia la regla.
- **supuesto** — Un lote de tintorería lleva un solo color y vuelve en una sola entrega. *Riesgo:* si un lote se divide en varios colores, se envían como lotes separados.
- **supuesto** — Planchado y preparado se asignan por SKU (uno o varios por persona y día); se dejan los criterios por talla o público. *Riesgo:* si se siguen usando, se mantienen como atajo para elegir varios SKU.
- **supuesto** — Lo que hoy está en proceso con color (lotes de remallado abiertos, stock por planchar) termina su camino como antes.

## Construction
Dos PRs en esta rama de trabajo:
- **5A** (migración 032): tejido 24/6 con operario por turno, preparado con la lógica de planchado, varios SKU por día, stock de fuera.
- **5B** (migración 033): catálogo crudo, remallado → volteado → tintorería → planchado, tintorería con merma.

## Approval
Decisiones del dueño (2026-11-26): 1-A (todo se teje crudo; en tintorería pasa a su SKU de color), 2-A (por turno), 3-B (todas pasan por tintorería), 4 (tintorería interna sin costo), 5-A (stock de fuera sin egreso), 6 (se sigue volteando, entre remallado y tintorería), 7-A (merma con motivo), C1 (stock de fuera: se elige la etapa), C2 (remallado sigue manual), C3-A (hilo por docenas reales). Supuestos mostrados y no objetados. Especificación aprobada el 2026-11-26.
