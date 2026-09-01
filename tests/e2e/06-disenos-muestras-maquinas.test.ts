/**
 * E2E Test 06: Módulo de Diseñadores, Fichas de Muestras y Asignación Multimarca a Máquinas
 *
 * Flujo correcto del negocio (fuente de verdad):
 *   1. Diseñador sube foto del diseño (límite 5MB, JPG/PNG/WEBP), color de muestra y orden de muestra.
 *   2. Registro transaccional atómico vía RPC (`registrar_diseno_con_asignaciones`).
 *   3. Relación Muchos-a-Muchos (Máquina + Marca + Diseño):
 *      - Una máquina puede tener múltiples diseños activos simultáneamente de diferentes marcas.
 *      - Un diseño puede estar asignado a varias máquinas.
 *   4. Integridad referencial con ON DELETE RESTRICT:
 *      - Se bloquea la eliminación de un diseño si está asignado activamente a máquinas.
 *   5. Ciclo de vida de validación de muestra (en_muestra -> aprobada -> en_produccion -> archivada).
 */

import { describe, it, expect, beforeEach } from 'vitest'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']

interface MockMarca {
  id: string
  nombre: string
}

interface MockMaquina {
  id: string
  codigo: string
  marca_id: string
}

interface MockDiseno {
  id: string
  codigo: string
  nombre: string
  foto_url: string | null
  color_muestra: string
  marca_id: string
  disenador_id?: string
  orden_muestra: string
  cantidad_muestra: number
  estado: 'en_muestra' | 'aprobada' | 'rechazada' | 'en_produccion' | 'archivada'
  observaciones?: string
  created_at: string
}

interface MockDisenoMaquina {
  id: string
  diseno_id: string
  maquina_id: string
  activo: boolean
  fecha_asignacion: string
}

function crearServicioDisenos(initialState?: {
  marcas?: MockMarca[]
  maquinas?: MockMaquina[]
}) {
  const db = {
    marcas: initialState?.marcas || [
      { id: 'marca-angies', nombre: 'Angies' },
      { id: 'marca-sport', nombre: 'Sport' },
      { id: 'marca-durey', nombre: 'Durey' },
    ],
    maquinas: initialState?.maquinas || [
      { id: 'maq-m01', codigo: 'M01', marca_id: 'marca-angies' },
      { id: 'maq-m02', codigo: 'M02', marca_id: 'marca-angies' },
      { id: 'maq-m03', codigo: 'M03', marca_id: 'marca-sport' },
      { id: 'maq-m04', codigo: 'M04', marca_id: 'marca-durey' },
    ],
    disenos: [] as MockDiseno[],
    disenos_maquinas: [] as MockDisenoMaquina[],
  }

  return {
    db,

    // 1. Validar subida de archivo
    validarArchivoFoto(file: { size: number; mimeType: string }): { ok: boolean; error?: string } {
      if (!ALLOWED_MIME_TYPES.includes(file.mimeType)) {
        return { ok: false, error: 'Formato inválido. Solo se admiten fotos JPG, PNG o WEBP' }
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return { ok: false, error: 'La imagen supera el límite de 5MB' }
      }
      return { ok: true }
    },

    // 2. RPC: registrar_diseno_con_asignaciones (Transaccional)
    registrarDisenoConAsignaciones(params: {
      codigo: string
      nombre: string
      foto_url: string | null
      color_muestra: string
      marca_id: string
      disenador_id?: string
      orden_muestra: string
      cantidad_muestra?: number
      observaciones?: string
      maquina_ids?: string[]
    }): { ok: boolean; error?: string; diseno_id?: string } {
      const { codigo, nombre, color_muestra, marca_id, orden_muestra } = params

      if (!codigo || !nombre || !color_muestra || !orden_muestra) {
        return { ok: false, error: 'Campos requeridos incompletos' }
      }

      // Validar unicidad de código
      if (db.disenos.some(d => d.codigo.toLowerCase() === codigo.trim().toLowerCase())) {
        return { ok: false, error: `Ya existe un diseño con código ${codigo}` }
      }

      // Validar que las máquinas existan si se especificaron
      if (params.maquina_ids) {
        for (const mId of params.maquina_ids) {
          if (!db.maquinas.some(m => m.id === mId)) {
            return { ok: false, error: `Máquina ${mId} no existe (Rollback transaccional)` }
          }
        }
      }

      const disenoId = `dis-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
      const diseno: MockDiseno = {
        id: disenoId,
        codigo: params.codigo.trim(),
        nombre: params.nombre.trim(),
        foto_url: params.foto_url,
        color_muestra: params.color_muestra.trim(),
        marca_id: params.marca_id,
        disenador_id: params.disenador_id,
        orden_muestra: params.orden_muestra.trim(),
        cantidad_muestra: params.cantidad_muestra || 1,
        estado: 'en_muestra',
        observaciones: params.observaciones,
        created_at: new Date().toISOString(),
      }

      db.disenos.push(diseno)

      // Asignar máquinas atómicamente
      if (params.maquina_ids && params.maquina_ids.length > 0) {
        for (const mId of params.maquina_ids) {
          db.disenos_maquinas.push({
            id: `dm-${Date.now()}-${mId}`,
            diseno_id: disenoId,
            maquina_id: mId,
            activo: true,
            fecha_asignacion: new Date().toISOString(),
          })
        }
      }

      return { ok: true, diseno_id: disenoId }
    },

    // 3. RPC: asignar_diseno_a_maquinas
    asignarDisenoAMaquinas(disenoId: string, maquinaIds: string[]): { ok: boolean; error?: string } {
      const diseno = db.disenos.find(d => d.id === disenoId)
      if (!diseno) return { ok: false, error: 'Diseño no encontrado' }

      // Desactivar las que no estén en la lista
      db.disenos_maquinas.forEach(dm => {
        if (dm.diseno_id === disenoId && !maquinaIds.includes(dm.maquina_id)) {
          dm.activo = false
        }
      })

      // Activar / insertar las seleccionadas
      maquinaIds.forEach(mId => {
        const existente = db.disenos_maquinas.find(
          dm => dm.diseno_id === disenoId && dm.maquina_id === mId
        )
        if (existente) {
          existente.activo = true
        } else {
          db.disenos_maquinas.push({
            id: `dm-${Date.now()}-${mId}`,
            diseno_id: disenoId,
            maquina_id: mId,
            activo: true,
            fecha_asignacion: new Date().toISOString(),
          })
        }
      })

      return { ok: true }
    },

    // 4. RPC: actualizar_estado_muestra_diseno
    actualizarEstadoMuestra(
      disenoId: string,
      nuevoEstado: MockDiseno['estado'],
      observaciones?: string
    ): { ok: boolean; error?: string } {
      const diseno = db.disenos.find(d => d.id === disenoId)
      if (!diseno) return { ok: false, error: 'Diseño no encontrado' }

      diseno.estado = nuevoEstado
      if (observaciones) diseno.observaciones = observaciones
      return { ok: true }
    },

    // 5. Eliminar diseño con regla ON DELETE RESTRICT
    eliminarDiseno(disenoId: string): { ok: boolean; error?: string } {
      const asignacionesActivas = db.disenos_maquinas.filter(
        dm => dm.diseno_id === disenoId && dm.activo
      )

      if (asignacionesActivas.length > 0) {
        return {
          ok: false,
          error: 'RESTRICT: No se puede eliminar el diseño porque está asignado activamente a máquinas',
        }
      }

      const idx = db.disenos.findIndex(d => d.id === disenoId)
      if (idx === -1) return { ok: false, error: 'No encontrado' }

      db.disenos.splice(idx, 1)
      // Limpiar asignaciones inactivas históricas
      db.disenos_maquinas = db.disenos_maquinas.filter(dm => dm.diseno_id !== disenoId)
      return { ok: true }
    },

    // 6. Eliminar máquina del inventario
    eliminarMaquina(maquinaId: string): { ok: boolean; error?: string } {
      const idx = db.maquinas.findIndex(m => m.id === maquinaId)
      if (idx === -1) return { ok: false, error: 'Máquina no encontrada' }

      db.maquinas.splice(idx, 1)
      // Desvincular asignaciones
      db.disenos_maquinas = db.disenos_maquinas.filter(dm => dm.maquina_id !== maquinaId)
      return { ok: true }
    },

    // Obtener diseños activos de una máquina
    obtenerDisenosDeMaquina(maquinaId: string): Array<{ diseno: MockDiseno; marca: MockMarca }> {
      const activas = db.disenos_maquinas.filter(dm => dm.maquina_id === maquinaId && dm.activo)
      return activas.map(a => {
        const diseno = db.disenos.find(d => d.id === a.diseno_id)!
        const marca = db.marcas.find(m => m.id === diseno.marca_id)!
        return { diseno, marca }
      })
    },
  }
}

// ── TEST SUITE ─────────────────────────────────────────────────────────────

describe('E2E: Módulo de Diseñadores, Muestras y Asignación Multimarca', () => {
  let servicio: ReturnType<typeof crearServicioDisenos>

  beforeEach(() => {
    servicio = crearServicioDisenos()
  })

  describe('1. Validación de Fotos y Fichas Técnicas de Muestra', () => {
    it('valida formatos permitidos y rechaza archivos mayores a 5MB', () => {
      // Archivo válido JPG de 2MB
      const valido = servicio.validarArchivoFoto({ size: 2 * 1024 * 1024, mimeType: 'image/jpeg' })
      expect(valido.ok).toBe(true)

      // Archivo inválido (PDF)
      const pdf = servicio.validarArchivoFoto({ size: 1024 * 1024, mimeType: 'application/pdf' })
      expect(pdf.ok).toBe(false)
      expect(pdf.error).toContain('Formato inválido')

      // Archivo pesado (6MB)
      const pesado = servicio.validarArchivoFoto({ size: 6 * 1024 * 1024, mimeType: 'image/png' })
      expect(pesado.ok).toBe(false)
      expect(pesado.error).toContain('supera el límite de 5MB')
    })

    it('registra un diseño con foto, color de muestra y orden de muestra', () => {
      const res = servicio.registrarDisenoConAsignaciones({
        codigo: 'DIS-001',
        nombre: 'Media Deportiva Canillera',
        foto_url: 'https://supabase.co/storage/disenos/dis-001.jpg',
        color_muestra: 'Azul Marino / Rayas Blancas',
        marca_id: 'marca-angies',
        orden_muestra: 'MUE-501',
        cantidad_muestra: 4,
        observaciones: 'Tensión ajustada en talón',
      })

      expect(res.ok).toBe(true)
      expect(servicio.db.disenos).toHaveLength(1)
      expect(servicio.db.disenos[0].estado).toBe('en_muestra')
    })

    it('bloquea códigos de diseño duplicados', () => {
      servicio.registrarDisenoConAsignaciones({
        codigo: 'DIS-100',
        nombre: 'Diseño Base',
        foto_url: null,
        color_muestra: 'Negro',
        marca_id: 'marca-sport',
        orden_muestra: 'MUE-01',
      })

      const dup = servicio.registrarDisenoConAsignaciones({
        codigo: 'DIS-100',
        nombre: 'Diseño Duplicado',
        foto_url: null,
        color_muestra: 'Blanco',
        marca_id: 'marca-sport',
        orden_muestra: 'MUE-02',
      })

      expect(dup.ok).toBe(false)
      expect(dup.error).toContain('Ya existe un diseño')
    })
  })

  describe('2. Asignación N-a-N Multimarca a Máquinas (Regla Core)', () => {
    it('permite que una misma máquina tenga múltiples diseños de distintas marcas simultáneamente', () => {
      // 1. Crear Diseño A (Marca Angies)
      const { diseno_id: disenoA } = servicio.registrarDisenoConAsignaciones({
        codigo: 'DIS-ANG-01',
        nombre: 'Media Tobillera Angies',
        foto_url: null,
        color_muestra: 'Rosado',
        marca_id: 'marca-angies',
        orden_muestra: 'MUE-101',
        maquina_ids: ['maq-m03'], // Asignada a M03
      })

      // 2. Crear Diseño B (Marca Sport)
      const { diseno_id: disenoB } = servicio.registrarDisenoConAsignaciones({
        codigo: 'DIS-SPT-01',
        nombre: 'Media Compresión Sport',
        foto_url: null,
        color_muestra: 'Verde Neón',
        marca_id: 'marca-sport',
        orden_muestra: 'MUE-102',
        maquina_ids: ['maq-m03'], // También asignada a M03
      })

      expect(disenoA).toBeDefined()
      expect(disenoB).toBeDefined()

      // Consultar la máquina M03
      const disenosEnM03 = servicio.obtenerDisenosDeMaquina('maq-m03')
      expect(disenosEnM03).toHaveLength(2)

      const marcasEnM03 = disenosEnM03.map(d => d.marca.nombre)
      expect(marcasEnM03).toContain('Angies')
      expect(marcasEnM03).toContain('Sport')
    })

    it('permite reasignar y desasignar máquinas limpiamente', () => {
      const { diseno_id } = servicio.registrarDisenoConAsignaciones({
        codigo: 'DIS-MULTI',
        nombre: 'Diseño General',
        foto_url: null,
        color_muestra: 'Gris',
        marca_id: 'marca-durey',
        orden_muestra: 'MUE-303',
        maquina_ids: ['maq-m01', 'maq-m02'],
      })

      expect(servicio.obtenerDisenosDeMaquina('maq-m01')).toHaveLength(1)
      expect(servicio.obtenerDisenosDeMaquina('maq-m02')).toHaveLength(1)

      // Reasignar solo a M04 (desasigna M01 y M02)
      servicio.asignarDisenoAMaquinas(diseno_id!, ['maq-m04'])

      expect(servicio.obtenerDisenosDeMaquina('maq-m01')).toHaveLength(0)
      expect(servicio.obtenerDisenosDeMaquina('maq-m02')).toHaveLength(0)
      expect(servicio.obtenerDisenosDeMaquina('maq-m04')).toHaveLength(1)
    })
  })

  describe('3. Protección ON DELETE RESTRICT al Eliminar', () => {
    it('bloquea la eliminación si el diseño está activo en una máquina', () => {
      const { diseno_id } = servicio.registrarDisenoConAsignaciones({
        codigo: 'DIS-PROTEGER',
        nombre: 'Diseño En Producción Muestra',
        foto_url: null,
        color_muestra: 'Negro',
        marca_id: 'marca-angies',
        orden_muestra: 'MUE-999',
        maquina_ids: ['maq-m01'],
      })

      // Intento de borrado directo -> Debe fallar por RESTRICT
      const resDel = servicio.eliminarDiseno(diseno_id!)
      expect(resDel.ok).toBe(false)
      expect(resDel.error).toContain('RESTRICT')
      expect(servicio.db.disenos).toHaveLength(1)
    })

    it('permite eliminar el diseño únicamente tras desasignarlo de las máquinas', () => {
      const { diseno_id } = servicio.registrarDisenoConAsignaciones({
        codigo: 'DIS-BORRABLE',
        nombre: 'Diseño Temporal',
        foto_url: null,
        color_muestra: 'Blanco',
        marca_id: 'marca-durey',
        orden_muestra: 'MUE-000',
        maquina_ids: ['maq-m02'],
      })

      // 1. Desasignar de todas las máquinas
      servicio.asignarDisenoAMaquinas(diseno_id!, [])

      // 2. Ahora el borrado procede de forma segura
      const resDel = servicio.eliminarDiseno(diseno_id!)
      expect(resDel.ok).toBe(true)
      expect(servicio.db.disenos).toHaveLength(0)
    })
  })

  describe('4. Flujo de Validación de Estados de Muestra', () => {
    it('actualiza el estado de la muestra de en_muestra -> aprobada -> en_produccion', () => {
      const { diseno_id } = servicio.registrarDisenoConAsignaciones({
        codigo: 'DIS-CICLO',
        nombre: 'Media Escolar',
        foto_url: null,
        color_muestra: 'Azul Noche',
        marca_id: 'marca-durey',
        orden_muestra: 'MUE-ESC-01',
      })

      const d = servicio.db.disenos.find(x => x.id === diseno_id)!
      expect(d.estado).toBe('en_muestra')

      // Supervisor aprueba la muestra técnica
      servicio.actualizarEstadoMuestra(diseno_id!, 'aprobada', 'Muestra aprobada por control de calidad')
      expect(d.estado).toBe('aprobada')
      expect(d.observaciones).toContain('Muestra aprobada')

      // Pasa a producción en planta
      servicio.actualizarEstadoMuestra(diseno_id!, 'en_produccion')
      expect(d.estado).toBe('en_produccion')
    })
  })

  describe('5. Gestión y Eliminación de Máquinas de Planta', () => {
    it('permite eliminar una máquina del inventario y desvincula asignaciones huérfanas', () => {
      // 1. Crear diseño y asignarlo a M01
      const { diseno_id } = servicio.registrarDisenoConAsignaciones({
        codigo: 'DIS-MAQ-DEL',
        nombre: 'Media Prueba Máquina',
        foto_url: null,
        color_muestra: 'Negro',
        marca_id: 'marca-durey',
        orden_muestra: 'MUE-DEL-01',
        maquina_ids: ['maq-m01'],
      })

      expect(servicio.db.maquinas.some(m => m.id === 'maq-m01')).toBe(true)
      expect(servicio.db.disenos_maquinas.some(dm => dm.maquina_id === 'maq-m01')).toBe(true)

      // 2. Eliminar máquina M01
      const resDel = servicio.eliminarMaquina('maq-m01')
      expect(resDel.ok).toBe(true)
      expect(servicio.db.maquinas.some(m => m.id === 'maq-m01')).toBe(false)

      // 3. Verificar que las asignaciones se desvincularon
      expect(servicio.db.disenos_maquinas.some(dm => dm.maquina_id === 'maq-m01')).toBe(false)

      // 4. Ahora el diseño se puede eliminar sin restricción
      const resDelDis = servicio.eliminarDiseno(diseno_id!)
      expect(resDelDis.ok).toBe(true)
    })
  })
})
