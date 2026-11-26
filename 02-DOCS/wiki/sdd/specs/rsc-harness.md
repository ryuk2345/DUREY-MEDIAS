---
type: spec
title: Spec — Versionar el harness de rsc
description: WHAT and WHY para subir la configuración de rsc al repositorio, separada del código de la aplicación.
tags: [sdd, spec, harness]
timestamp: 2026-11-25T20:30:00Z
topic: sdd
slug: rsc-harness
branch: chore/rsc-harness
status: approved
---

# Spec — Versionar el harness de rsc

> Slug: `rsc-harness` · Status: approved · Created: 2026-11-25
> Inherits: [constitution](../constitution.md) (borrador; se ratifica antes de la Fase 3)

## Problem & why
La configuración de rsc (guards, hooks, decisiones aceptadas) existe solo en la máquina del
dueño del proyecto. Quien clona el repositorio, o un compañero, trabaja sin esas protecciones
ni esas decisiones, y el comportamiento del asistente cambia según quién lo ejecuta.

## Cost of not building it
Cada clon nuevo arranca sin guards (rama principal, mensajes de commit, comandos peligrosos) y
sin el plan aceptado. Los errores que esos guards evitan vuelven a ser posibles fuera de esta
máquina. El coste es bajo pero continuo.

## The cheapest alternative
Pedir a cada persona que instale rsc a mano con la misma versión. No basta: depende de que
cada uno lo recuerde y repita las mismas decisiones, y nada lo comprueba.

## Goals
- Un clon nuevo del repositorio recibe la misma configuración de rsc que esta máquina.
- El cambio llega en un PR propio, separado de cualquier cambio de código de la aplicación.

## Non-goals / out of scope
- Ningún cambio de código de la aplicación, del modelo de datos ni de los tests.
- Ratificar la constitución (se hace antes de la Fase 3).
- Cambiar decisiones de rsc ya aceptadas o activar/desactivar guards.

## Users & context
El dueño del proyecto y los compañeros que clonan el repositorio y trabajan con un asistente.

## What the user can do
Quien clona el repositorio obtiene la configuración de rsc del proyecto sin instalar ni decidir
nada a mano. Solo el dueño del repositorio fusiona el PR.

## What result they get
Tras fusionar, el repositorio contiene el manifiesto de rsc, la configuración de hooks del
asistente, su script de arranque, las reglas de ignorado del estado local de rsc y los
documentos de rsc (decisiones, plan de instalación, borrador de constitución). Referencia
aprobada por el dueño: el contenido de los commits 58998b2 y bfbf1e7.

## What it must respect
- Ningún secreto ni dato personal en los archivos subidos.
- El estado local de rsc (sellos, registros, enlaces de skills) sigue fuera del repositorio.
- Los documentos coinciden con la rama `rsc/knowledge` (versión local, plan 9f8df631).

## How it proves it
- `npx @ericrisco/rsc doctor` devuelve `"healthy": true`.
- El diff del PR contra `main` solo contiene los 8 archivos de rsc listados en la descripción
  del PR, sin código de la aplicación.
- Revisión manual de secretos en los archivos de configuración, registrada en la descripción del PR.

## Behaviour
- Main path: el PR se fusiona y `main` contiene la configuración de rsc.
- Edge cases: la sincronización de conocimiento puede añadir commits de documentos a la rama;
  solo se aceptan si son documentos de rsc.
- Error paths: si aparece código de la aplicación en el diff, el PR no se crea.

## Acceptance criteria
- Given el PR abierto, When se mira su diff contra main, Then solo aparecen archivos de rsc.
- Given main con el PR fusionado, When se ejecuta `rsc doctor`, Then devuelve `"healthy": true`.

## Points to clarify
- **suposición tomada** — Los 4 documentos de `02-DOCS/` y `01-TOOLS/.gitignore` cuentan como
  "archivos de rsc". *Base:* el dueño pidió incluir el commit bfbf1e7 en el mismo PR. *Riesgo:*
  ninguno; son documentación.

## Approval
Aprobada por el dueño del proyecto el 2026-11-25: «Incluye el commit de documentos bfbf1e7 en
ese mismo PR y crea el PR hacia main.»
