---
type: spec
title: Spec — Fase 4, mantenimiento preventivo e historia clínica de máquinas
description: Planes de mantenimiento preventivo por máquina cada N días, registro atómico de cada mantenimiento (máquina en mantenimiento, mecánico, repuestos, mano de obra) e historia clínica por máquina imprimible en PDF y Excel.
tags: [sdd, spec, fase-4]
timestamp: 2026-11-26T15:30:00Z
topic: sdd
slug: fase-4-mantenimiento-preventivo
branch: fase-4/mantenimiento-preventivo
status: draft
---

# Spec — Fase 4, mantenimiento preventivo e historia clínica de máquinas

> Slug: `fase-4-mantenimiento-preventivo` · Status: draft (pendiente de aprobación) · Created: 2026-11-26
> Inherits: [constitución v1.0.0](../constitution.md) y AGENTS.md. Plan: [plan-fases](../../plan-fases.md).

## Problem & why
- No hay mantenimiento preventivo: las máquinas solo se atienden cuando fallan.
- No hay un lugar donde ver todo lo que le pasó a una máquina: producción, fallas, reparaciones, repuestos y mantenimientos están repartidos en pantallas distintas.

## Cost of not building it
Más fallas evitables y paradas largas; sin historia no se sabe qué máquina cuesta más ni cuándo conviene cambiarla.

## The cheapest alternative
Llevar un cuaderno de mantenimientos y cruzar a mano las pantallas. No basta: no avisa cuando toca, no descuenta repuestos y no se puede imprimir una historia completa.

## Goals
- Planes de mantenimiento preventivo por máquina, cada N días.
- Aviso en pantalla de lo vencido y lo próximo.
- Registrar cada mantenimiento: la máquina pasa a "mantenimiento" mientras dura; mecánico, repuestos del stock y mano de obra; al terminar vuelve a operativa y el plan calcula su próxima fecha.
- Historia clínica por máquina, por día o por semana, imprimible en PDF y descargable en Excel.

## Non-goals / out of scope
- Programar por docenas producidas o por horas (decisión: solo por días).
- Planes por tipo o marca de máquina (decisión: por máquina).
- Notificaciones por correo (Fase 7).
- Corregir el modelo de producción por máquina y turno (Fase 5): la historia usa lo que hoy se registra.

## Users & context
Administrador y supervisor (planes, mantenimientos), quien atiende Mantenimiento, y quien consulta la historia de una máquina.

## What the user can do
- En Mantenimiento, pestaña Preventivo:
  - Crear un plan para una máquina: tarea (por ejemplo "Lubricar cilindro"), cada cuántos días y desde qué fecha empieza a contar. Editar y desactivar planes.
  - Ver todos los planes con su próxima fecha y estado: al día, próximo (en 3 días o menos) o vencido.
  - Iniciar un mantenimiento de un plan eligiendo el mecánico: la máquina pasa a "mantenimiento".
  - Mientras dura: añadir y quitar repuestos usados (se descuentan del stock).
  - Terminarlo con una nota y la mano de obra: la máquina vuelve a operativa y el plan cuenta los días desde esa fecha.
- En Máquinas y Mantenimiento: cada máquina muestra si tiene un preventivo vencido o próximo.
- Desde cualquier máquina: abrir su historia clínica, elegir el período y "por día" o "por semana", e imprimirla en PDF o descargarla en Excel.
Quién: usuarios con sesión y acceso al módulo (MODULOS_POR_ROL). Nadie sin sesión.

## What result they get
- Historia clínica: una línea de tiempo con producción (docenas por día y turno, o por semana), fallas (descripción, quién reportó), reparaciones (mecánico, diagnóstico, costo), repuestos usados (en fallas y en preventivos) y mantenimientos preventivos (tarea, mecánico, mano de obra), con totales del período.
- Gasto: la mano de obra del preventivo cuenta como gasto de mantenimiento; los repuestos no (ya se contaron al comprarlos, regla de la Fase 3).

## What it must respect
- Constitución v1.0.0: migración 031 con checklist de AGENTS.md Regla 2; RLS y política `durey_usuarios_con_sesion`; permisos exactos para `authenticated` comprobados tabla por tabla (lección de la 030); nada para `anon`; `search_path` fijo; test SQL y reversión en local.
- Operaciones atómicas en la base (iniciar, usar/quitar repuesto, terminar).
- Transiciones de máquina de `lib/domain/machines.ts`: se entra a mantenimiento desde activa, standby o inactiva; no desde ocupada (con turno activo) ni malograda (eso es una falla).
- La historia se arma en un solo lugar (una vista SQL con permisos de quien consulta).
- Toca rutas sensibles (Mantenimiento y gasto en finanzas): nivel 2.

## How it proves it
- Test SQL de la 031 y reversión con `probar_migraciones.sh`; permisos exactos verificados.
- `npm test`: reglas de estado del plan (al día / próximo / vencido), próxima fecha, agrupación por semana, gasto de mantenimiento.
- Playwright: crear un plan, ver el aviso de vencido, iniciar y terminar un mantenimiento con un repuesto, abrir la historia y descargar PDF y Excel.
- Build, `tsc`, ESLint. Después de fusionar: 031 aplicada y verificada en la base real.

## Behaviour
- Main path: como en "What the user can do".
- Edge cases: máquina ocupada o malograda → no se inicia el preventivo, con el motivo; un plan con un mantenimiento en curso no se puede iniciar otra vez; una máquina con una falla abierta no inicia preventivo; un plan desactivado no avisa; frecuencia 0 o negativa → rechazada; la historia de un período sin datos dice "Sin registros".
- Error paths: mensajes de la base en pantalla, sin datos a medias.

## Acceptance criteria
- Given un plan cada 15 días que empezó hace 20 días y nunca se hizo, Then aparece "vencido" en Mantenimiento y en la máquina.
- Given un plan con próxima fecha en 2 días, Then aparece "próximo".
- Given una máquina activa, When se inicia su preventivo con un mecánico, Then la máquina queda en "mantenimiento"; When se termina con mano de obra 40, Then vuelve a "activa", el plan cuenta 15 días desde hoy y el gasto de mantenimiento suma 40.
- Given un preventivo en curso, When se usan 2 repuestos, Then el stock baja 2 y no se crea egreso.
- Given una máquina ocupada, When se intenta iniciar su preventivo, Then se rechaza y la máquina sigue ocupada.
- Given una máquina con producción, una falla reparada y un preventivo, When se abre su historia del mes por día, Then aparecen los tres tipos de evento con sus totales; por semana, la producción sale sumada por semana; y se descarga en PDF y en Excel.
- Given un usuario sin sesión, Then no ve ni toca planes, mantenimientos ni historia.

## Points to clarify
- **suposición tomada** — "Próximo" = vence en 3 días o menos. *Riesgo:* si se quiere otro margen, es una constante.
- **suposición tomada** — Al terminar, la máquina vuelve a "activa" (aunque antes estuviera en standby o inactiva). *Riesgo:* si debe volver a su estado anterior, se guarda ese estado al iniciar.
- **suposición tomada** — La próxima fecha cuenta desde el día en que se terminó el mantenimiento, no desde la fecha programada. *Riesgo:* si se quiere un calendario fijo, cambia el cálculo.
- **suposición tomada** — La historia incluye la producción de remallado para las máquinas remalladoras.
- **suposición tomada** — Antes de la Fase 4 se corrigen los detalles anotados de la Fase 3 y la 030 (redondeo del mock, tests faltantes).

## Approval
Decisiones del dueño (2026-11-26): «1-A (cada N días), 2-por máquina, 3-pasa a estado de mantenimiento, 4-las dos (día y semana), 5-sí imprimir en PDF o Excel». Pendiente: aprobación de esta especificación y de los supuestos.
