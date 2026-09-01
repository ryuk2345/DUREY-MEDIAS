/**
 * E2E Test 05: Materia Prima en 3 Apartados (Bolsas, Conos, Cajas) y Alertas de Stock Bajo
 *
 * Flujo correcto del negocio (fuente de verdad):
 *   1. Registro y clasificación de materias primas por `tipo_empaque` ('bolsa', 'cono', 'caja').
 *   2. Unicidad compuesta por (material + color + tipo_empaque) permitiendo el mismo hilo en empaques distintos.
 *   3. Evaluación de umbrales específicos de stock crítico:
 *      - 📦 Cajas: Crítico si stock <= 4
 *      - 🛍️ Bolsas: Crítico si stock <= 4
 *      - 🧵 Conos: Crítico si stock <= 10
 *   4. Sistema de Notificaciones de Campana con identificación de empaque y control de cruce de umbral.
 *   5. Flujo de Reabastecimiento ("Pedir") -> Registro de compra -> Aprobación QC -> Aumento de stock.
 */

import { describe, it, expect, beforeEach } from 'vitest'

type TipoEmpaque = 'bolsa' | 'cono' | 'caja'

interface MockMateriaPrima {
  id: string
  material: string
  color: string
  stock_kg: number
  tipo_empaque: TipoEmpaque
  created_at: string
}

interface MockProveedor {
  id: string
  nombre: string
  ruc: string
}

interface MockCompra {
  id: string
  proveedor_id: string
  materia_prima_id: string
  cantidad_kg: number
  costo_total: number
  estado: 'pendiente' | 'recibida' | 'devuelta'
  condicion_pago: 'contado' | 'pago_diferido'
  cuotas_num?: number
}

function crearServicioMateriaPrima() {
  const db = {
    materia_prima: [] as MockMateriaPrima[],
    proveedores: [] as MockProveedor[],
    compras: [] as MockCompra[],
    notified_set: new Set<string>(),
  }

  return {
    db,

    // 1. Registrar Insumo con validación de clave única (material, color, tipo_empaque)
    registrarInsumo(params: {
      material: string
      color: string
      stock_kg: number
      tipo_empaque: TipoEmpaque
    }): { ok: boolean; error?: string; item?: MockMateriaPrima } {
      const { material, color, stock_kg, tipo_empaque } = params
      if (!material.trim() || !color.trim()) {
        return { ok: false, error: 'Material y color son obligatorios' }
      }

      // Validar regla de unicidad compuesta
      const existe = db.materia_prima.some(
        (m) =>
          m.material.toLowerCase() === material.trim().toLowerCase() &&
          m.color.toLowerCase() === color.trim().toLowerCase() &&
          m.tipo_empaque === tipo_empaque
      )

      if (existe) {
        return {
          ok: false,
          error: `Ya existe un registro de ${material} ${color} en presentación de ${tipo_empaque}`,
        }
      }

      const item: MockMateriaPrima = {
        id: `mp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        material: material.trim(),
        color: color.trim(),
        stock_kg: Math.max(0, stock_kg),
        tipo_empaque,
        created_at: new Date().toISOString(),
      }

      db.materia_prima.push(item)
      return { ok: true, item }
    },

    // 2. Obtener insumos filtrados por empaque
    obtenerPorEmpaque(empaque: TipoEmpaque): MockMateriaPrima[] {
      return db.materia_prima.filter((m) => m.tipo_empaque === empaque)
    },

    // 3. Evaluar si un insumo está en stock crítico según su umbral de empaque
    esStockCritico(item: MockMateriaPrima): {
      esCritico: boolean
      umbral: number
      unidad: string
      etiqueta: string
    } {
      const stock = item.stock_kg
      if (item.tipo_empaque === 'caja') {
        return {
          esCritico: stock <= 4,
          umbral: 4,
          unidad: 'cajas',
          etiqueta: '📦 Caja',
        }
      }
      if (item.tipo_empaque === 'bolsa') {
        return {
          esCritico: stock <= 4,
          umbral: 4,
          unidad: 'bolsas',
          etiqueta: '🛍️ Bolsa',
        }
      }
      // Por defecto 'cono'
      return {
        esCritico: stock <= 10,
        umbral: 10,
        unidad: 'conos',
        etiqueta: '🧵 Cono',
      }
    },

    // 4. Evaluar notificaciones de la campana con control de cruce de umbral downward
    evaluarNotificaciones(): {
      totalAlertas: number
      alertasActivas: Array<{ item: MockMateriaPrima; mensaje: string }>
      toastsDisparados: string[]
    } {
      const alertasActivas: Array<{ item: MockMateriaPrima; mensaje: string }> = []
      const toastsDisparados: string[] = []

      db.materia_prima.forEach((m) => {
        const evaluacion = this.esStockCritico(m)
        if (evaluacion.esCritico) {
          const mensaje = `${evaluacion.etiqueta} de ${m.material} (${m.color}): quedan ${m.stock_kg} ${evaluacion.unidad} (límite ≤ ${evaluacion.umbral})`
          alertasActivas.push({ item: m, mensaje })

          // Si cruza el umbral por primera vez
          if (!db.notified_set.has(m.id)) {
            db.notified_set.add(m.id)
            toastsDisparados.push(mensaje)
          }
        } else {
          // Si fue reabastecido
          if (db.notified_set.has(m.id)) {
            db.notified_set.delete(m.id)
          }
        }
      })

      return {
        totalAlertas: alertasActivas.length,
        alertasActivas,
        toastsDisparados,
      }
    },

    // 5. Registrar Compra y Preselección ("Pedir")
    registrarCompra(params: {
      proveedor_id: string
      materia_prima_id: string
      cantidad_kg: number
      costo_total: number
      condicion_pago: 'contado' | 'pago_diferido'
      cuotas_num?: number
    }): { ok: boolean; error?: string; compra?: MockCompra } {
      const { proveedor_id, materia_prima_id, cantidad_kg, costo_total, condicion_pago, cuotas_num } = params
      const insumo = db.materia_prima.find((m) => m.id === materia_prima_id)
      if (!insumo) return { ok: false, error: 'Insumo no encontrado' }
      if (cantidad_kg <= 0) return { ok: false, error: 'La cantidad debe ser mayor a 0' }

      const compra: MockCompra = {
        id: `comp-${Date.now()}`,
        proveedor_id,
        materia_prima_id,
        cantidad_kg,
        costo_total,
        estado: 'pendiente',
        condicion_pago,
        cuotas_num,
      }

      db.compras.push(compra)
      return { ok: true, compra }
    },

    // 6. Inspección de Calidad (QC) y aumento de stock
    procesarQC(compraId: string, aprobado: boolean): { ok: boolean; stockFinal?: number } {
      const compra = db.compras.find((c) => c.id === compraId)
      if (!compra) return { ok: false }

      if (aprobado) {
        compra.estado = 'recibida'
        const insumo = db.materia_prima.find((m) => m.id === compra.materia_prima_id)
        if (insumo) {
          insumo.stock_kg += compra.cantidad_kg
          return { ok: true, stockFinal: insumo.stock_kg }
        }
      } else {
        compra.estado = 'devuelta'
      }
      return { ok: true }
    },

    // 7. Eliminar Insumo
    eliminarInsumo(id: string): { ok: boolean } {
      const idx = db.materia_prima.findIndex((m) => m.id === id)
      if (idx !== -1) {
        db.materia_prima.splice(idx, 1)
        db.notified_set.delete(id)
        return { ok: true }
      }
      return { ok: false }
    },
  }
}

// ── TEST SUITE ─────────────────────────────────────────────────────────────

describe('E2E: Módulo de Materia Prima en 3 Apartados y Alertas de Stock Bajo', () => {
  let servicio: ReturnType<typeof crearServicioMateriaPrima>

  beforeEach(() => {
    servicio = crearServicioMateriaPrima()
  })

  describe('1. Clasificación por Apartados y Clave Única', () => {
    it('permite registrar materias primas en Bolsas, Conos y Cajas', () => {
      const resBolsa = servicio.registrarInsumo({
        material: 'Lycra 40/1',
        color: 'Blanco',
        stock_kg: 8,
        tipo_empaque: 'bolsa',
      })
      const resCono = servicio.registrarInsumo({
        material: 'Algodón Tangüis',
        color: 'Negro',
        stock_kg: 25,
        tipo_empaque: 'cono',
      })
      const resCaja = servicio.registrarInsumo({
        material: 'Poliéster Texturizado',
        color: 'Azul',
        stock_kg: 12,
        tipo_empaque: 'caja',
      })

      expect(resBolsa.ok).toBe(true)
      expect(resCono.ok).toBe(true)
      expect(resCaja.ok).toBe(true)

      expect(servicio.obtenerPorEmpaque('bolsa')).toHaveLength(1)
      expect(servicio.obtenerPorEmpaque('cono')).toHaveLength(1)
      expect(servicio.obtenerPorEmpaque('caja')).toHaveLength(1)
    })

    it('permite el mismo material y color en diferentes empaques (Bolsa y Cono)', () => {
      const r1 = servicio.registrarInsumo({
        material: 'Algodón 20/1',
        color: 'Blanco',
        stock_kg: 10,
        tipo_empaque: 'cono',
      })
      const r2 = servicio.registrarInsumo({
        material: 'Algodón 20/1',
        color: 'Blanco',
        stock_kg: 5,
        tipo_empaque: 'bolsa',
      })

      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
      expect(servicio.db.materia_prima).toHaveLength(2)
    })

    it('bloquea duplicados exactos del mismo material, color y tipo de empaque', () => {
      servicio.registrarInsumo({
        material: 'Algodón 20/1',
        color: 'Blanco',
        stock_kg: 10,
        tipo_empaque: 'cono',
      })
      const dup = servicio.registrarInsumo({
        material: 'Algodón 20/1',
        color: 'Blanco',
        stock_kg: 15,
        tipo_empaque: 'cono',
      })

      expect(dup.ok).toBe(false)
      expect(dup.error).toContain('Ya existe un registro')
    })
  })

  describe('2. Umbrales de Stock Bajo Diferenciados por Empaque', () => {
    it('evalúa correctamente el umbral de Cajas (<= 4)', () => {
      const { item: cajaCritica } = servicio.registrarInsumo({
        material: 'Hilo A',
        color: 'Rojo',
        stock_kg: 4,
        tipo_empaque: 'caja',
      })
      const { item: cajaNormal } = servicio.registrarInsumo({
        material: 'Hilo B',
        color: 'Rojo',
        stock_kg: 5,
        tipo_empaque: 'caja',
      })

      expect(servicio.esStockCritico(cajaCritica!).esCritico).toBe(true)
      expect(servicio.esStockCritico(cajaNormal!).esCritico).toBe(false)
    })

    it('evalúa correctamente el umbral de Bolsas (<= 4)', () => {
      const { item: bolsaCritica } = servicio.registrarInsumo({
        material: 'Hilo C',
        color: 'Azul',
        stock_kg: 3,
        tipo_empaque: 'bolsa',
      })
      const { item: bolsaNormal } = servicio.registrarInsumo({
        material: 'Hilo D',
        color: 'Azul',
        stock_kg: 6,
        tipo_empaque: 'bolsa',
      })

      expect(servicio.esStockCritico(bolsaCritica!).esCritico).toBe(true)
      expect(servicio.esStockCritico(bolsaNormal!).esCritico).toBe(false)
    })

    it('evalúa correctamente el umbral de Conos (<= 10)', () => {
      const { item: conoCritico } = servicio.registrarInsumo({
        material: 'Hilo E',
        color: 'Verde',
        stock_kg: 10,
        tipo_empaque: 'cono',
      })
      const { item: conoNormal } = servicio.registrarInsumo({
        material: 'Hilo F',
        color: 'Verde',
        stock_kg: 11,
        tipo_empaque: 'cono',
      })

      expect(servicio.esStockCritico(conoCritico!).esCritico).toBe(true)
      expect(servicio.esStockCritico(conoNormal!).esCritico).toBe(false)
    })
  })

  describe('3. Notificaciones y Control de Cruce de Umbral (Downward)', () => {
    it('dispara toast la primera vez que cruza hacia abajo y no repite si sigue bajo', () => {
      const { item } = servicio.registrarInsumo({
        material: 'Algodón Pima',
        color: 'Negro',
        stock_kg: 8,
        tipo_empaque: 'cono', // Umbral <= 10 -> Alerta!
      })

      // Primera evaluación: dispara notificación
      const eval1 = servicio.evaluarNotificaciones()
      expect(eval1.totalAlertas).toBe(1)
      expect(eval1.toastsDisparados).toHaveLength(1)
      expect(eval1.toastsDisparados[0]).toContain('🧵 Cono de Algodón Pima (Negro)')

      // Segunda evaluación (sin cambios en stock): mantiene contador pero no re-dispara toast
      const eval2 = servicio.evaluarNotificaciones()
      expect(eval2.totalAlertas).toBe(1)
      expect(eval2.toastsDisparados).toHaveLength(0)
    })

    it('vuelve a disparar toast si el insumo fue reabastecido y luego vuelve a bajar', () => {
      const { item } = servicio.registrarInsumo({
        material: 'Lana Merino',
        color: 'Gris',
        stock_kg: 2,
        tipo_empaque: 'caja', // Umbral <= 4 -> Crítico
      })

      // 1. Alerta inicial
      const eval1 = servicio.evaluarNotificaciones()
      expect(eval1.toastsDisparados).toHaveLength(1)

      // 2. Reabastecimiento a 10 cajas
      item!.stock_kg = 10
      const eval2 = servicio.evaluarNotificaciones()
      expect(eval2.totalAlertas).toBe(0)
      expect(servicio.db.notified_set.has(item!.id)).toBe(false)

      // 3. Consumo que vuelve a bajar a 3 cajas (cruce de nuevo)
      item!.stock_kg = 3
      const eval3 = servicio.evaluarNotificaciones()
      expect(eval3.totalAlertas).toBe(1)
      expect(eval3.toastsDisparados).toHaveLength(1)
      expect(eval3.toastsDisparados[0]).toContain('📦 Caja de Lana Merino (Gris)')
    })
  })

  describe('4. Flujo de Reabastecimiento ("Pedir"), Compra y Control de Calidad', () => {
    it('ejecuta el ciclo completo: Pedir -> Compra pendiente -> Inspección QC -> Aumento de stock', () => {
      const { item: hilo } = servicio.registrarInsumo({
        material: 'Algodón 30/1',
        color: 'Blanco',
        stock_kg: 2,
        tipo_empaque: 'bolsa', // Crítico
      })

      expect(servicio.evaluarNotificaciones().totalAlertas).toBe(1)

      // Supervisor hace clic en "+ Pedir" y registra compra de 20 bolsas
      const resCompra = servicio.registrarCompra({
        proveedor_id: 'prov-01',
        materia_prima_id: hilo!.id,
        cantidad_kg: 20,
        costo_total: 450.0,
        condicion_pago: 'contado',
      })
      expect(resCompra.ok).toBe(true)
      expect(resCompra.compra?.estado).toBe('pendiente')

      // Stock sigue en 2 hasta que se apruebe el QC
      expect(hilo!.stock_kg).toBe(2)

      // Se realiza la inspección QC y se aprueba
      const resQC = servicio.procesarQC(resCompra.compra!.id, true)
      expect(resQC.ok).toBe(true)
      expect(resQC.stockFinal).toBe(22)

      // Ya no está en stock crítico
      expect(servicio.evaluarNotificaciones().totalAlertas).toBe(0)
    })

    it('permite eliminar una materia prima y limpia sus alertas activas', () => {
      const { item } = servicio.registrarInsumo({
        material: 'Hilo Descontinuado',
        color: 'Amarillo',
        stock_kg: 1,
        tipo_empaque: 'cono',
      })

      expect(servicio.evaluarNotificaciones().totalAlertas).toBe(1)

      const resDel = servicio.eliminarInsumo(item!.id)
      expect(resDel.ok).toBe(true)
      expect(servicio.db.materia_prima).toHaveLength(0)
      expect(servicio.evaluarNotificaciones().totalAlertas).toBe(0)
    })
  })
})
