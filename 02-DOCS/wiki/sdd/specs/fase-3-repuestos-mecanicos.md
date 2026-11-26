---
type: spec
title: Spec — Fase 3, repuestos y mecánicos
description: Compras de repuestos al contado con su gasto, buscador de repuestos, mecánicos como registro (no usuarios) y repuestos usados en cada falla descontados del stock.
tags: [sdd, spec, fase-3]
timestamp: 2026-11-25T23:50:00Z
topic: sdd
slug: fase-3-repuestos-mecanicos
branch: fase-3/repuestos-mecanicos
status: approved
---

# Spec — Fase 3, repuestos y mecánicos

> Slug: `fase-3-repuestos-mecanicos` · Status: approved · Created: 2026-11-25
> Inherits: [constitución v1.0.0](../constitution.md) y AGENTS.md. Plan: [plan-fases](../../plan-fases.md).

## Problem & why
- Los repuestos no tienen buscador y no hay cómo registrar una compra: el stock solo se ajusta a mano y la compra no deja rastro ni gasto.
- Los mecánicos que reparan las máquinas son personas de afuera o de planta que no usan la app, pero hoy el sistema solo conoce "técnicos" como usuarios con login.
- Cuando se rompe una máquina (por ejemplo, una aguja), el repuesto usado no se descuenta del stock: el costo se escribe a mano en la reparación.

## Cost of not building it
El stock de repuestos se desvía de la realidad, las compras no aparecen como gasto y no se sabe qué repuesto usó cada reparación ni quién la hizo.

## The cheapest alternative
Seguir ajustando el stock a mano y escribir el costo en cada reparación. No basta: no guarda el historial, se descuadra con facilidad y no cumple la regla de operaciones atómicas (constitución, principio 6).

## Goals
- Buscar y filtrar repuestos.
- Registrar compras de repuestos al contado: suben el stock, fijan el costo unitario y quedan como gasto.
- Registrar mecánicos (nombre, apellido y teléfono) sin crearles usuario.
- Asignar cada falla a un mecánico y descontar del stock los repuestos que usa.

## Non-goals / out of scope
- Compras a crédito o con cuotas (todo es al contado).
- Mantenimiento preventivo e historia clínica de máquinas (Fase 4).
- Cambiar cómo Egresos y Balance cuentan los gastos (Fase 7).

## Users & context
Administrador y supervisor (compras, repuestos, mecánicos) y quien atiende las fallas en Mantenimiento.

## What the user can do
- En la pestaña Repuestos (Materia Prima): buscar por nombre y filtrar "con stock" / "agotados".
- Pulsar "Registrar compra": elegir el repuesto, el proveedor (opcional), la cantidad, el precio unitario pagado, la fecha (no futura) y el método de pago.
- En Máquinas, pestaña Mecánicos: añadir, editar y dar de baja mecánicos (nombre, apellido, teléfono).
- Al reportar o atender una falla: asignarla a un mecánico de la lista.
- Mientras la falla está "en reparación": añadir los repuestos usados (repuesto y cantidad), uno o varios.
- Al cerrar la falla: el costo de repuestos es la suma de lo usado; se escribe el diagnóstico y la mano de obra.
Quién: usuarios con sesión y acceso al módulo (MODULOS_POR_ROL). Nadie sin sesión.

## What result they get
- Compra: el stock del repuesto sube en la cantidad comprada, su costo unitario pasa a ser el precio de esta compra (último precio pagado) y se crea un egreso de categoría "repuestos" por el total.
- Uso en una falla: el stock baja en la cantidad usada y queda registrado en esa falla con el costo unitario del momento. Usar un repuesto ya no crea egreso (el gasto se contó al comprar).
- Sin stock suficiente: «Solo hay N unidades de X; no se pueden usar M», y no se descuenta nada.
- Reporte de Mantenimiento (Fase 2): la columna del técnico pasa a ser el mecánico.

## What it must respect
- Constitución v1.0.0: migración nueva (029) con checklist de AGENTS.md Regla 2, RLS y política `durey_usuarios_con_sesion` en tablas nuevas, nada para `anon`, `search_path` fijo, test SQL y reversión probados en local (principios 9-12).
- Compra y uso de repuestos son funciones atómicas en la base (principio 6).
- El rol `tecnico` desaparece del sistema (decisión del dueño): no se puede crear un usuario con ese rol; sale de `MODULOS_POR_ROL`, `ROLES_LABELS`, login y pantallas. Hoy no hay ningún usuario con ese rol en la base real.
- Los 20 egresos "repuestos" ya registrados (por consumo) se conservan: son historial.
- Los cambios en `app/dashboard/materia-prima/`, `lib/utils/index.ts` (roles) y login son rutas sensibles: nivel 2 (principio 16).

## How it proves it
- Test SQL de la 029 (compra, uso con y sin stock, asignación a mecánico, permisos, rol `tecnico` rechazado) y reversión, en `supabase/tests/local/probar_migraciones.sh`.
- `npm test`: reglas en `lib/domain` (último precio, costo de reparación, filtro de repuestos).
- Playwright: registrar una compra, crear un mecánico, usar un repuesto en una falla y cerrarla.
- `npm run build`, `tsc` y ESLint. Después de fusionar: 029 aplicada y verificada en la base real.

## Behaviour
- Main path: como en "What the user can do".
- Edge cases: cantidad 0 o negativa → rechazada; precio negativo → rechazado (0 permitido para una donación o garantía); fecha futura → rechazada; usar un repuesto en una falla que no está "en reparación" → rechazado; quitar un repuesto usado por error → devuelve el stock (el gasto de la compra no cambia); dar de baja un mecánico con fallas abiertas → permitido, la falla conserva su nombre.
- El ajuste manual de stock (entrada/salida) se mantiene para correcciones de inventario y ya no crea egreso.

## Acceptance criteria
- Given un repuesto con stock 5 y costo 10, When se compra 3 a 12 cada uno, Then stock 8, costo unitario 12 y un egreso "repuestos" de 36.
- Given una falla en reparación y un repuesto con stock 2, When se usan 3, Then se rechaza con el mensaje y el stock sigue en 2.
- Given una falla en reparación, When se usan 2 unidades a costo 12, Then stock baja en 2, no se crea egreso y al cerrar la falla el costo de repuestos es 24.
- Given un mecánico nuevo "Juan Pérez 987654321", Then aparece para asignar fallas y no aparece en Usuarios.
- Given la 029 aplicada, When se intenta crear un usuario con rol `tecnico`, Then se rechaza.
- Given un usuario sin sesión, Then no ve ni toca compras, mecánicos ni usos de repuestos.

## Points to clarify
- **decidido (dueño, 2026-11-25)** — Compra pagada en efectivo: ¿resta de la caja abierta del día, como los pagos a proveedores (migración 027)? Si sí, se usa la misma regla de caja (la de quien paga, si no la general, si no la más antigua) y sin caja abierta la compra se registra igual. Respuesta del dueño: «si es efectivo de la venta del día, sí». Por eso, en una compra en efectivo el formulario pregunta «Pagado con efectivo de la caja del día» (marcada por defecto); marcada resta de la caja, desmarcada solo queda como gasto.
- **decidido (dueño, 2026-11-25)** — El proveedor de la compra es opcional (a veces se compra en una ferretería sin registrar). *Riesgo:* bajo.
- **decidido (dueño, 2026-11-25)** — El ajuste manual de stock se mantiene, sin egreso, para corregir inventario. *Base:* el gasto ahora se cuenta al comprar. *Riesgo:* si se quiere quitar el ajuste manual, se quita el botón.
- **decidido (dueño, 2026-11-25)** — Las fallas antiguas guardan el técnico como texto (`asignado_a`); se conservan como texto y las nuevas apuntan al mecánico. *Riesgo:* bajo (en la base real hay 1 falla y 0 reparaciones).

## Approval
Decisiones del dueño (2026-11-25): «todo es al contado»; gasto al comprar (opción A: usar el repuesto ya no crea egreso); costo = último precio pagado; quitar el rol técnico; mecánico = nombre, apellido y número. Supuestos confirmados por el dueño (2026-11-25): proveedor opcional; ajuste manual sin egreso; fallas antiguas como texto; precio 0 permitido; quitar un repuesto usado devuelve su stock. Efectivo de la caja del día: resta de la caja (casilla en el formulario). Especificación aprobada el 2026-11-25.
