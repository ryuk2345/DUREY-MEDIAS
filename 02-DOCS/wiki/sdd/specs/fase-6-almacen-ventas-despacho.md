---
type: spec
title: Spec — Fase 6, salones con kardex, despacho por sacos, orden de despacho, cronograma con detalle y RUC/DNI
description: Salones por almacén con stock imprimible y kardex de sacos (entradas, traslados y salidas con fecha, hora y usuario); despacho eligiendo sacos completos de un solo SKU con quién despachó; bloqueo por rol de ventas, almacén y despacho; orden de despacho imprimible; cronograma de pagos con el detalle de productos; búsqueda de cliente por RUC/DNI.
tags: [sdd, spec, fase-6]
timestamp: 2026-11-27T15:00:00Z
topic: sdd
slug: fase-6-almacen-ventas-despacho
branch: fase-6a/salones-kardex
status: approved
---

# Spec — Fase 6, almacén, ventas y despacho

> Slug: `fase-6-almacen-ventas-despacho` · Status: approved · Created: 2026-11-27
> Inherits: [constitución v1.0.0](../constitution.md) y AGENTS.md. Plan: [plan-fases](../../plan-fases.md).

## Problem & why
- Los salones no muestran su stock ni se puede imprimir; no hay un kardex que diga qué saco entró, se movió o salió, cuándo y quién.
- El despacho elige sacos solo (los más antiguos) y entrega de más sin avisar; no guarda de qué salón salió ni quién despachó.
- El stock de Ventas cuenta mal si un saco lleva varios SKU (posible desde la Fase 5A).
- Ventas no imprime una orden de despacho, el cronograma de pagos no dice qué se compró y el cliente se escribe a mano.
- Ventas, almacén y despacho no tienen bloqueo por rol en la base (decisión Q5-A de la Fase 5).

## Cost of not building it
Stock de almacén que no cuadra, entregas de más sin registro, y nadie sabe quién despachó ni dónde estaba cada saco.

## The cheapest alternative
Un cuaderno de kardex por salón. No basta: el stock de Ventas seguiría mal y el despacho seguiría eligiendo sacos a ciegas.

## Goals
- Un saco lleva un solo SKU.
- Salones: cada uno con sus sacos y su stock por SKU, imprimible; traslados entre salones.
- Kardex de sacos: entrada, traslado (salida de un salón y entrada al otro) y salida por despacho, con fecha y hora, usuario, salón, saco, SKU y docenas, y el saldo.
- Despacho: almacén elige sacos completos guiado por la orden de despacho; si falta no deja; si sobra avisa y queda registrado; se guarda quién despachó.
- Bloqueo por rol en la base para ventas, almacén y despacho.
- (6B) Orden de despacho imprimible; cronograma de pagos con el detalle de productos; búsqueda de cliente por RUC/DNI con Decolecta.

## Non-goals / out of scope
- Abrir sacos o despachar parte de un saco (decisión 3-B).
- Facturación electrónica.
- Cambiar precios o cobros.

## Users & context
Almacenero (salones, traslados, despacho), vendedora (ventas, orden de despacho, cronograma), supervisor y administrador.

## What the user can do
- **Almacén:** ver cada salón con sus sacos y su stock por SKU; imprimirlo; trasladar sacos entre salones; ver el kardex filtrado por salón, SKU o fechas.
- **Despacho:** abrir un pedido, ver lo pedido por SKU y los sacos disponibles (salón y saco), elegir sacos, ver lo que falta o sobra, y despachar; ver el kardex del pedido con todos sus productos y quién despachó.
- **Preparado:** crear un saco por SKU.
- **(6B) Ventas:** imprimir la orden de despacho; ver el detalle de productos en el cronograma de pagos; buscar al cliente por RUC o DNI.
Quién: usuarios con sesión cuyo rol tiene el módulo (`MODULOS_POR_ROL` y su tabla en la base).

## What result they get
- Stock por salón y por SKU que cuadra con los sacos; stock de Ventas por SKU correcto.
- Un kardex completo de cada saco y de cada salón.
- Cada despacho con sus sacos, el salón de origen, quién despachó y lo entregado de más, si hubo.

## What it must respect
- Constitución v1.0.0: migraciones nuevas con el checklist de AGENTS.md; RLS y política de sesión; permisos exactos; nada para `anon`; funciones atómicas con `search_path` fijo; test SQL y reversión en local.
- Bloqueo por rol con `exigir_modulo` (migración 033).
- Lo ya registrado no se borra.

## How it proves it
- Test SQL y reversión de cada migración.
- `npm test`: reglas de kardex, despacho (falta/sobra) y stock por SKU; mock igual al SQL.
- Playwright: trasladar un saco, ver el kardex, despachar eligiendo sacos con sobrante.

## Behaviour
- Edge cases: despachar con un saco de otro SKU → rechazado; despachar con lo elegido por debajo de lo pedido → rechazado; saco ya despachado o en otro pedido → rechazado; trasladar al mismo salón o a un salón inactivo → rechazado; crear un saco con dos SKU → rechazado.
- Error paths: mensajes de la base en pantalla, sin datos a medias.

## Acceptance criteria
- Given un pedido de 10 docenas de A y dos sacos de A de 6, When almacén elige los dos, Then se despacha, se registran 2 docenas de más en el kardex y queda quién despachó.
- Given un pedido de 10 docenas de A, When almacén elige un solo saco de 6, Then no deja despachar y dice que faltan 4.
- Given un saco en el Salón A, When se traslada al Salón B, Then el kardex muestra la salida de A y la entrada a B con fecha, hora y usuario, y el stock de cada salón cambia.
- Given un preparador con dos SKU, When embolsa, Then se crean dos sacos, uno por SKU.
- Given un usuario sin el módulo almacén, When intenta trasladar un saco, Then la base lo rechaza.

## Points to clarify
- **decidido (dueño, 2026-11-27)** — Q1-A: RUC/DNI con Decolecta (el token se pide en la 6B).
- **decidido (dueño, 2026-11-27)** — Q2-A: el inventario cuenta sacos, con las docenas por SKU.
- **decidido (dueño, 2026-11-27)** — Q3-B: solo se despachan sacos completos.
- **decidido (dueño, 2026-11-27)** — Q4-A: la orden de despacho dice en qué salón y saco está cada producto.
- **decidido (dueño, 2026-11-27)** — Q5-A: hay traslados entre salones y quedan en el kardex.
- **decidido (dueño, 2026-11-27)** — Un saco lleva un solo SKU («solo un sku»).
- **decidido (dueño, 2026-11-27)** — C1-A: almacén elige los sacos; si falta no deja; si sobra avisa y queda en el kardex.
- **supuesto** — Quien despacha y quien traslada es el usuario de la sesión.
- **supuesto** — Los sacos "pendiente de almacenar" (recién embolsados) no se despachan hasta entrar a un salón.

## Construction
- **6A** (migración 034): un SKU por saco, stock por SKU, kardex, traslados, despacho por sacos con quién despachó, bloqueo por rol de ventas/almacén/despacho.
- **6B** (migración 035 si hace falta): orden de despacho, cronograma con detalle, RUC/DNI.

## Approval
Decisiones del dueño del 2026-11-27 (Q1-A, Q2-A, Q3-B, Q4-A, Q5-A, un solo SKU por saco, C1-A). Plan de la Fase 6 aprobado («si traelo» y las respuestas).
