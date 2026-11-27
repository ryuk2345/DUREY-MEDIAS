---
author: ryuk2345
branch: fix/ventas-stock-crudos
status: done
merged: 2026-11-27
pr: #26
---
# Ventas sin crudos y sin vender sin stock

## Intent
Que Ventas no venda productos crudos ni más docenas de las que hay para vender. Encontrado en las pruebas de la Fase 6B: la fila nueva tomaba el crudo `CRU-1` y la venta se registraba sin stock.

## Decisiones del dueño (2026-11-27)
- 2-A: Ventas no ofrece crudos y no deja vender sin stock.
- Stock para vender (A): docenas en sacos (almacenados o por almacenar, como `vista_stock_medias`) menos lo ya vendido sin despachar (ventas `pendiente`). Así no se vende dos veces lo mismo.
- Límite de búsquedas a Decolecta (1-A): sin tope por ahora (L112 cerrado como decidido).

## Scope
Dentro: migración 035 (`vista_stock_vendible` y `registrar_venta` con cerrojo), regla en `lib/domain/stockVenta.ts` para el mock y la pantalla, Ventas sin crudos y con el stock para vender.
Fuera: anular ventas pendientes; las ventas ya sobrevendidas antes de la 035 dejan saldo negativo visible y bloquean nuevas ventas de ese producto.

## Checklist
- [x] T1 Migración 035 + test SQL + reversión — prueba: `probar_migraciones.sh` PASA 035 y su reversión; 022 y 023 con sacos de stock.
- [x] T2 Dominio y mock (`stockVendible`, `motivoNoVendible`, vista en el mock, `registrar_venta` del mock) — prueba: `tests/e2e/23-stock-venta.test.ts`; test 09 con stock donde vende.
- [x] T3 Ventas: catálogo sin crudos, stock para vender, aviso antes de enviar — prueba: Playwright «Ventas no ofrece crudos y marca sin stock…».
- [x] T4 Controles: `npm test` 301/301, Playwright 59/59, build y `tsc` en verde, ESLint sin errores nuevos.
- [x] T5 `rsc risk` nivel 2: panel de 3 revisores, ronda 1 (L113-L117). Corregidos: prueba del orden del cerrojo, aviso previo en pantalla con lo vendible (no lo físico), orden del aviso con dos SKU y decimales. Aparcados: L116 formato 10.00 en la base frente a 10 en pantalla (igual que en la 6A); L117 el despacho con sobrante no toma el cerrojo (ventana mínima: una sobreventa por el sobrante, visible como saldo negativo).
- [x] T5b Ronda 2: la prueba de pantalla falla a la vista si falta el stock previo (antes se saltaba); el orden del aviso con varios SKU queda aparcado (con estos datos Postgres devuelve el orden por código aun sin ORDER BY).
- [ ] T6 PR, fusión y 035 en la base real.

## Next
Fusionado en main el 2026-11-27 (a1359d8).
