---
type: plan
title: Plan — Fase 6A, un SKU por saco, salones con kardex, traslados, despacho por sacos y bloqueo por rol
tags: [sdd, plan, fase-6]
timestamp: 2026-11-27T15:30:00Z
topic: sdd
slug: fase-6-almacen-ventas-despacho
spec: ../specs/fase-6-almacen-ventas-despacho.md
---

# Plan — Fase 6A (migración 034)

## Lo que hay hoy (base real, 2026-11-27)
- 10 salones, 6 sacos (3 almacenados, 3 entregados; ninguno con varios SKU), 3 ventas, 3 guías, 9 movimientos de stock.
- `despachar_venta` recibe las líneas desde la pantalla, elige los sacos más antiguos y entrega de más sin avisar; el movimiento no guarda salón, saco ni usuario.
- `almacenar_paquete` registra la entrada sin usuario ni SKU. No hay traslados.
- `vista_stock_medias` suma por el SKU principal del saco (correcta si el saco es de un solo SKU).
- Las funciones de ventas, almacén y despacho no tienen bloqueo por rol; varias tablas aceptan escritura directa con sesión.

## Diseño
1. **Un SKU por saco.** `paquetes.detalles_contenido` con a lo sumo un SKU (CHECK). `registrar_produccion_preparado` rechaza varios SKU. Preparado crea un saco por SKU.
2. **Kardex.** `movimientos_stock` gana `catalogo_media_id`, `venta_id`, `guia_id`. Tipos: `ingreso_salon`, `traslado_salida`, `traslado_entrada`, `salida_venta`. Cada fila con usuario (`auth.uid()`), salón y saco.
3. **Traslados.** `trasladar_saco(saco, salón destino)`: almacén; saco almacenado; destino activo y distinto; dos filas de kardex.
4. **Despacho por sacos.** `despachar_venta_sacos(venta, agencia, sacos[])`: despacho; venta pendiente; sacos almacenados, libres, de SKU del pedido; por SKU lo elegido ≥ lo pedido (si falta, rechaza diciendo cuánto); `guias_remision.despachado_por`; tabla `despacho_detalle` (pedidas vs entregadas por SKU: el sobrante queda registrado); una fila de kardex por saco. Lo pedido sale de `items_venta`, no de la pantalla. La función anterior deja de poder llamarse con sesión.
5. **Bloqueo por rol.** `exigir_modulo` en `registrar_venta` y `registrar_cobro_cuotas` (ventas), `almacenar_paquete` y las de salones (almacén), `registrar_agencia` y el despacho nuevo (despacho). Sin escritura directa con sesión en `paquetes`, `movimientos_stock`, `guias_remision`, `ventas`, `items_venta`, `cuotas`, `cobros`, `ubicaciones`, `agencias`.
6. **Pantallas.** Almacén: pestaña Salones (sacos y stock por SKU de cada salón, imprimir, trasladar) y pestaña Kardex (filtros por salón, SKU y fechas). Despacho: elegir sacos con la tabla pedido / elegido / falta / sobra; kardex del pedido con quién despachó. Preparado: un saco por SKU.

## Tareas
| # | Tarea | Nivel | Comprobación |
|---|---|---|---|
| T1 | Migración 034 + test SQL + reversión | 2 | `probar_migraciones.sh` PASA 034 y su reversión |
| T2 | Dominio (falta/sobra, saldo de kardex) y mock | 1 | `npm test` |
| T3 | Almacén: salones, imprimir, traslados, kardex | 1 | Playwright |
| T4 | Despacho por sacos y Preparado un saco por SKU | 2 | Playwright |
| T5 | Panel, PR, fusión, 034 en la base real | 2 | permisos y advisors |

## Evidencia (2026-11-27)
| # | Estado | Prueba observada |
|---|---|---|
| T1 | hecha (51c0584) | `probar_migraciones.sh`: PASA 034 y "PASA reversión 034"; 023, 027, 030 y 032 adaptadas (sesión, permisos de agencias, saco de un SKU) |
| T2 | hecha (d99bb96) | `tests/e2e/21-salones-kardex-despacho.test.ts` |
| T3 | hecha | Playwright "Almacén: el salón muestra su stock, se traslada un saco y el kardex lo registra con usuario" |
| T4 | hecha | Playwright "Despacho: … GR-9001" (elige un saco de 3 para un pedido de 2: aviso de sobrante, quién despachó) y Preparado por SKU |
| T5 | en curso | panel ronda 1 (L95-L104): 7 corregidos (saldo anterior del kardex, fechas en hora de Lima, aviso previo de sacos mezclados, pruebas de bloqueo, entrega exacta, líneas repetidas, saco inexistente, kardex sin NULL); 3 aparcados (L102 se comprueba en la base real antes de aplicar; L103 cajas y clientes, para la Fase 7; L104 menor); ronda 2: mutantes de la ronda 1 todos muertos; 1 corregido (L105: el kardex se lee por páginas, `lib/supabase/paginar.ts`) |

Batería: `npm test` 281/281 · Playwright 55/55 · build y `tsc` en verde · ESLint sin errores nuevos.

## Anotado
- El tipo `ingreso_directo` (ingreso directo de Almacén) cuenta como entrada en el kardex.
- `clientes` y `cajas_diarias` se siguen escribiendo directo desde sus pantallas (no mueven stock).
- Los sacos "pendiente de almacenar" no se despachan hasta entrar a un salón (supuesto de la spec).
