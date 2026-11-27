---
type: plan
title: Plan — Fase 6B, orden de despacho imprimible, cronograma con detalle y búsqueda RUC/DNI
tags: [sdd, plan, fase-6]
timestamp: 2026-11-27T17:00:00Z
topic: sdd
slug: fase-6-almacen-ventas-despacho
spec: ../specs/fase-6-almacen-ventas-despacho.md
---

# Plan — Fase 6B (sin migración)

## Decisiones
- 6B-1-B: la orden lista todos los sacos disponibles por SKU pedido, con su salón.
- 6B-2-A: búsqueda RUC/DNI construida; sin `DECOLECTA_TOKEN` responde «no configurada».

## Diseño
1. **Orden de despacho** (`lib/domain/ordenDespacho.ts` + impresión): por cada SKU del pedido, docenas pedidas y sacos `almacenado` de ese SKU (código, salón, docenas) y el total disponible; aviso si no alcanza. HTML escapado con `escaparHtml`. Botón en Ventas (pedidos pendientes) y en Despacho.
2. **Cronograma con detalle**: el cronograma (pantalla e impresión) lleva la tabla de productos de la venta.
3. **RUC/DNI**: ruta de servidor `app/api/documento/route.ts`. Exige sesión y el módulo `ventas` o `clientes` (`requerirSesion`). Valida DNI (8 dígitos) o RUC (11 dígitos) antes de llamar. Sin token, 503 `{ configurado: false }`. Llama a `https://api.decolecta.com/v1/reniec/dni?numero=` o `/v1/sunat/ruc?numero=` con `Authorization: Bearer`. Devuelve solo nombre, documento, tipo y dirección. Normalización en `lib/domain/documento.ts`. Fuente: documentación de Decolecta (decolecta.gitbook.io/docs, leída 2026-11-27).
4. **Corrección**: la impresión de la cartera de cobranza escapa el nombre de la vendedora y los datos de cliente.

## Tareas
| # | Tarea | Nivel | Comprobación |
|---|---|---|---|
| T1 | Orden de despacho imprimible | 1 | `npm test` (dominio) + Playwright |
| T2 | Cronograma con detalle de productos | 1 | Playwright |
| T3 | Búsqueda RUC/DNI con Decolecta | 2 | `npm test` (ruta: sin sesión, sin módulo, sin token, documento inválido, respuesta normalizada) |
| T4 | Escapado en impresiones de Ventas | 1 | `npm test` |
| T5 | Panel, PR, fusión | 2 | batería completa |

## Evidencia (2026-11-27)
| # | Estado | Prueba observada |
|---|---|---|
| T1 | hecha | `tests/e2e/22`: `armarOrdenDespacho` y la página impresa (salón, saco, docenas, faltante, textos protegidos); Playwright «Orden de despacho: se imprime desde Ventas y desde Despacho» |
| T2 | hecha | `tests/e2e/22`: cronograma con productos y subtotales; Playwright «Venta a cuotas: el cronograma impreso lleva el detalle de productos» y «Cartera: el cliente muestra qué compró» |
| T3 | hecha | `tests/e2e/22` sobre `GET /api/documento`: sin sesión 401, sin módulo 403, documento inválido 400, sin token 503 `configurado: false` (sin llamar a Decolecta), con token URL y Bearer correctos y respuesta reducida, errores 502/404 |
| T4 | hecha | `tests/e2e/22`: cronograma y cartera escapan `<img onerror>` |
| T5 | hecha (PR #25; sin migración) | panel ronda 1 (L106-L112): 6 corregidos (pruebas del filtro de sacos y del escapado, prefijos RUC, desempate, 429/5xx como «no responde», orden desde Despacho con dirección y vendedora); L112 aparcado: límite de consultas a Decolecta, se pregunta al dueño |

Batería: `npm test` 297/297 · Playwright 58/58 · build y `tsc` en verde · ESLint sin errores nuevos.

## Anotado
- La fila nueva de una venta toma el primer producto del catálogo (hoy un crudo, `CRU-1`) y la venta se registra aunque no haya stock. Ya pasaba antes; se pregunta al dueño.
