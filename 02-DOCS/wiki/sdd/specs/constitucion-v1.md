---
type: spec
title: Spec — Constitución v1.0.0 y rutas sensibles siempre nivel 2
description: Ratificar la constitución del proyecto, escribir REVIEW.md y versionar la política de riesgo para que login/permisos y caja/cobros/pagos siempre pasen por el panel de 3 revisores.
tags: [sdd, spec, constitution, harness]
timestamp: 2026-11-25T23:00:00Z
topic: sdd
slug: constitucion-v1
branch: docs/constitucion
status: approved
---

# Spec — Constitución v1.0.0 y rutas sensibles siempre nivel 2

> Slug: `constitucion-v1` · Status: approved · Created: 2026-11-25
> Inherits: AGENTS.md. Paso previo obligatorio a la Fase 3 (ASDD).

## Problem & why
Las fases 3 a 6 cambian el modelo de datos y van por ASDD, que exige una constitución ratificada. Hasta hoy era un borrador vacío. Además, los cambios en login, permisos, caja, cobros y pagos no tenían un nivel de revisión fijo, y la configuración local de `rsc` (`.rsc/`) no se versiona: una regla puesta ahí se perdería en otro equipo.

## Cost of not building it
Sin constitución, cada fase ASDD no tiene contra qué comprobarse. Sin la política versionada, un cambio en el login o en la caja podría entrar con un solo revisor en otro clon.

## The cheapest alternative
Dejar las reglas solo en AGENTS.md y recordar a mano qué archivos son sensibles. No basta: no se comprueba automáticamente y depende de la memoria.

## Goals
- Constitución v1.0.0 ratificada, con reglas numeradas y comprobables.
- `REVIEW.md` con los fallos típicos de DUREY y la lista de rutas sensibles.
- Las rutas sensibles suben solas a nivel 2 en `rsc risk`, en cualquier clon.

## Non-goals / out of scope
- No cambia código de la app ni la base de datos.
- No cambia AGENTS.md ni CLAUDE.md.

## Users & context
El dueño (aprueba) y los agentes que trabajan en el repositorio (cumplen y revisan).

## What the user can do
Leer en un solo sitio las reglas de la casa; saber de antemano qué cambios necesitan especificación y panel de 3 revisores.

## What result they get
Un cambio en `lib/auth/`, `proxy.ts`, `app/api/auth/`, `app/api/usuarios*`, `app/api/diagnostico/`, `app/(auth)/`, las líneas de roles de `lib/utils/index.ts`, `lib/domain/finance.ts`, `app/dashboard/{ventas,egresos,balance}/` o las líneas de pagos/cuotas/caja de `app/dashboard/materia-prima/` da nivel 2 en `rsc risk`. Cualquier otro cambio de la app conserva su nivel.

## What it must respect
- La política va en `.rsc-risk.json` (versionado; `rsc risk` la lee desde `main`), no en `.rsc/` (estado local ignorado por git).
- Patrones de `rsc`: ≤200 caracteres, sin lookarounds ni grupos repetidos.
- Decisiones anotadas en `02-DOCS/wiki/harness/decisions.md`.

## How it proves it
`rsc risk --policy-preview` sobre cada ruta sensible da nivel 2 (clase auth o money) y sobre una ruta normal da nivel 1; en una copia aislada, cambiar la lista de un rol en `MODULOS_POR_ROL` da nivel 2 y otro cambio en `lib/utils/index.ts` da nivel 1; añadir una línea de pagos en materia prima da nivel 2 y otra línea da nivel 1.

## Behaviour
- Main path: como en "What result they get".
- Edge cases: la política nueva solo se activa al llegar a `main` (comportamiento de `rsc`); `middleware.ts` incluido por si se crea.

## Acceptance criteria
- Given la constitución, Then tiene versión v1.0.0, fecha de ratificación y registro de cambios con la aprobación del dueño.
- Given un cambio en cualquier ruta sensible listada, When se corre `rsc risk`, Then sale nivel 2.
- Given un cambio fuera de esas rutas (p. ej. `app/dashboard/produccion/page.tsx`), Then no sube por esta política.
- Given `REVIEW.md` y `.rsc-risk.json`, Then listan las mismas rutas sensibles.

## Points to clarify
- **suposición tomada** — `app/dashboard/ventas/` completo es sensible (ventas, cuotas, cobros y caja del día en la misma pantalla). *Riesgo:* cambios menores de ventas pasan por panel completo.

## Approval
Aprobada por el dueño del proyecto el 2026-11-25: «Ratificada, 1B, 2 sí. Sobre el punto 2: .rsc/ está en .gitignore … Busca la forma de que quede en git … y dime cuál usaste. Además, deja la lista de rutas sensibles (login y permisos, caja, cobros, pagos) escrita también en REVIEW.md. Luego haz el PR, fusiónalo y tráeme el plan de la Fase 3.»
