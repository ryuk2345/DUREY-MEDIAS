---
type: spec
title: Spec — Ventas no vende crudos ni más de lo que hay para vender
description: Ventas deja de ofrecer y vender productos crudos y no vende más docenas que las que hay en sacos menos lo ya vendido sin despachar; la base lo exige (migración 035).
tags: [sdd, spec, ventas]
timestamp: 2026-11-27T21:10:00Z
topic: sdd
slug: ventas-stock-crudos
branch: fix/ventas-stock-crudos
status: approved
---

# Spec — Ventas sin crudos y sin vender sin stock

> Slug: `ventas-stock-crudos` · Status: approved · Created: 2026-11-27
> Inherits: [constitución v1.0.0](../constitution.md) y AGENTS.md. Trabajo: [FTD](../../ftd/ventas-stock-crudos.md).

## Problem & why
En las pruebas de la Fase 6B, la fila nueva de una venta tomó el crudo `CRU-1` y la venta se registró sin stock. Se podía vender lo que no existe o vender dos veces lo mismo.

## Cost of not building it
Ventas promete mercadería que no hay; el despacho no puede cumplir y el cliente espera. Un crudo vendido sale sin teñir.

## The cheapest alternative
Solo filtrar en la pantalla. No basta: la base seguiría aceptando la venta por otra vía y dos vendedoras a la vez podrían vender el mismo stock.

## Goals
- Ninguna venta de crudos.
- Ninguna venta por encima de lo que hay para vender.

## Users & context
Vendedoras, supervisor y administrador (roles con el módulo ventas), al registrar una venta en la pantalla de Ventas.

## What the user can do
- Vendedora (rol con el módulo ventas): elegir solo productos que no son crudos; ver cuánto hay para vender de cada uno; recibir un aviso claro si pide más.

## What result they get
- Ninguna venta de crudos.
- Ninguna venta por encima de lo que hay para vender: docenas en sacos (almacenados o por almacenar) menos lo vendido sin despachar.

## What it must respect
- Constitución v1.0.0: migración nueva con el checklist de AGENTS.md; nada para `anon`; permisos exactos; función con `search_path` fijo y `exigir_modulo`; test SQL y reversión en local.
- Una sola definición de la regla: `vista_stock_vendible` y `registrar_venta` en la base; `lib/domain/stockVenta.ts` para el mock y la pantalla.
- Lo ya registrado no se borra ni se cambia.

## How it proves it
- Test SQL `035_*` y su reversión; 022 y 023 adaptadas.
- `npm test`: `tests/e2e/23-stock-venta.test.ts`.
- Playwright: Ventas no ofrece crudos y avisa con lo que hay para vender.

## Acceptance criteria
- Given un crudo, When se intenta vender, Then la base lo rechaza y la pantalla no lo ofrece.
- Given 10 docenas en sacos y una venta pendiente de 8, When se vende 3, Then se rechaza diciendo que hay 2.
- Given 10 docenas en sacos, When se venden exactamente 10, Then se registra.
- Given una venta pendiente que se entrega, When se mira el stock para vender, Then ya no cuenta como comprometida.

## Behaviour
- Edge cases: dos líneas del mismo producto se suman; vender exactamente lo que hay se permite; un saldo negativo de antes (sobreventa) bloquea nuevas ventas de ese producto y se muestra como 0.
- Error paths: el mensaje de la base sale en pantalla y no queda nada a medias (ni cliente ni venta).

## Non-goals / out of scope
- Anular ventas pendientes.
- Tope de consultas a Decolecta (decidido 1-A: sin tope por ahora).

## Points to clarify
- **decidido (dueño, 2026-11-27)** — 2-A: Ventas no ofrece crudos y no deja vender sin stock.
- **decidido (dueño, 2026-11-27)** — A: el stock para vender resta lo vendido sin despachar.
- **supuesto** — Los sacos «por almacenar» cuentan como stock para vender (igual que `vista_stock_medias`).

## Approval
Decisiones del dueño del 2026-11-27 («2-a» y «1-A,2-a»). Escrita después del trabajo FTD porque el cambio resultó de nivel 2 (dinero y migración).
