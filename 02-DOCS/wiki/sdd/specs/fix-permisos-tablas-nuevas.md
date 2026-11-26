---
type: spec
title: Spec — Migración 030, permisos de authenticated en tablas nuevas
description: Cerrar el hueco de permisos por defecto de Supabase visto tras aplicar la 029 en la base real.
tags: [sdd, spec, seguridad, migracion]
timestamp: 2026-11-26T15:00:00Z
topic: sdd
slug: fix-permisos-tablas-nuevas
branch: fix/permisos-tablas-nuevas
status: approved
---

# Spec — Migración 030, permisos de authenticated en tablas nuevas

> Slug: `fix-permisos-tablas-nuevas` · Status: approved · Created: 2026-11-26
> Inherits: [constitución v1.0.0](../constitution.md) (principios 10, 11 y 12).

## Problem & why
Tras aplicar la 029 en la base real, la verificación mostró que `authenticated` puede insertar directamente en `compras_repuestos`. Causa: Supabase da por defecto todos los permisos a `authenticated` en cada tabla nueva (incluidos TRUNCATE, REFERENCES y TRIGGER); la 026 solo quitó esos permisos por defecto a `anon`. Afecta a `agencias`, `pagos_proveedores` (027) y `mecanicos`, `compras_repuestos`, `averia_repuestos` (029). La base local de prueba no simulaba esos permisos, por eso el test de la 029 pasó en local.

## Cost of not building it
Un usuario con sesión podría escribir compras o usos de repuestos sin sus funciones atómicas (sin stock, gasto ni caja coherentes), y las tablas nuevas tienen permisos que la 026 quitó a todas las demás.

## The cheapest alternative
Dejarlo: la web no usa esas operaciones. No basta: contradice la constitución (principio 10) y la especificación de la Fase 3.

## Goals
- Las 5 tablas con los permisos que pretendían sus migraciones.
- Ninguna tabla con TRUNCATE, REFERENCES ni TRIGGER para `authenticated`.
- Las tablas futuras nacen solo con SELECT, INSERT, UPDATE y DELETE para `authenticated`.
- La base local simula los permisos por defecto de Supabase, para que un fallo así se vea antes.

## Non-goals / out of scope
- Control por rol dentro de las funciones (riesgo aceptado, Fase 6/7).
- Cambiar datos.

## Users & context
Nadie nota el cambio en la web. Lo verifica el dueño con SQL y advisors.

## What the user can do
Lo mismo que antes en todas las pantallas.
Quién: usuarios con sesión.

## What result they get
Mismas pantallas; la base rechaza escrituras directas a compras y usos de repuestos.

## What it must respect
- AGENTS.md Regla 2 y constitución 9-12: migración nueva, `BEGIN … COMMIT`, test SQL y reversión probados en local, aplicar en la base real solo tras fusionar.
- Solo permisos; ningún dato cambia.

## How it proves it
- `supabase/tests/030_permisos_tablas_nuevas.test.sql` falla sin la 030 y pasa con ella; `probar_migraciones.sh` verde con "PASA reversión 030".
- Con la nueva simulación de permisos por defecto, el test de la 029 reproduce el fallo de la base real ("compras solo por su función") y pasa con la 030.
- `npm test`, `npm run test:browser`, build en verde. En la base real: consulta de permisos exactos y advisors.

## Behaviour
- Main path: como en Goals.
- Edge cases: Postgres 17 (base real) tiene además MAINTAIN: también se quita. La tabla `usuarios` conserva sus permisos por columna (020).

## Acceptance criteria
- Given la 030 aplicada, Then ninguna tabla de public da a authenticated TRUNCATE, REFERENCES ni TRIGGER.
- Given la 030, Then agencias, pagos_proveedores y mecanicos dan a authenticated exactamente SELECT, INSERT, UPDATE y DELETE; compras_repuestos y averia_repuestos solo SELECT.
- Given una tabla creada después, Then authenticated tiene exactamente SELECT, INSERT, UPDATE y DELETE y anon nada.
- Given la reversión, Then el esquema vuelve exactamente al de antes de la 030.

## Points to clarify
- **suposición tomada** — `pagos_proveedores` conserva INSERT/UPDATE/DELETE para authenticated, como la 027 lo concedió explícitamente. *Riesgo:* escritura directa de pagos sin su función; se revisa en la Fase 7 junto con el control por rol.

## Approval
Aprobada por el dueño del proyecto el 2026-11-26: «si continua» (respuesta a la propuesta de la 030 con sus 4 puntos).
