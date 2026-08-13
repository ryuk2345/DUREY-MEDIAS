// Adaptador de Base de Datos Mock para el Sistema DUREY
// Emula el cliente de Supabase (.from().select().insert().update().eq().single())
// Guardando el estado en durey-app/mock_db.json (Servidor) y localStorage (Cliente)

const SEMILLAS = {
  usuarios: [
    { id: '1', nombre: 'Admin General', email: 'admin@durey.com', rol: 'admin', activo: true, estado: 'disponible' },
    { id: '2', nombre: 'Supervisor Durey', email: 'supervisor@durey.com', rol: 'supervisor', activo: true, estado: 'disponible' },
    { id: '3', nombre: 'Carlos Tejedor', email: 'tejedor@durey.com', rol: 'tejedor', activo: true, estado: 'disponible' },
    { id: '4', nombre: 'Ana Remalladora', email: 'remalladora@durey.com', rol: 'remalladora', activo: true, estado: 'disponible' },
    { id: '4b', nombre: 'Eva Remalladora', email: 'eva@durey.com', rol: 'remalladora', activo: true, estado: 'disponible' },
    { id: '5', nombre: 'Mario Planchador', email: 'planchador@durey.com', rol: 'planchador', activo: true, estado: 'disponible' },
    { id: '5b', nombre: 'Carlos Planchador', email: 'carlos_planch@durey.com', rol: 'planchador', activo: true, estado: 'disponible' },
    { id: '6', nombre: 'Lucia Preparadora', email: 'preparador@durey.com', rol: 'preparador', activo: true, estado: 'disponible' },
    { id: '6b', nombre: 'Carlos Preparador', email: 'carlos_prep@durey.com', rol: 'preparador', activo: true, estado: 'disponible' },
    { id: '7', nombre: 'Juan Almacenero', email: 'almacenero@durey.com', rol: 'almacenero', activo: true, estado: 'disponible' },
    { id: '8', nombre: 'Sofia Vendedora', email: 'vendedora@durey.com', rol: 'vendedora', activo: true, estado: 'disponible' },
    { id: '8b', nombre: 'Elena Vendedora', email: 'elena_vend@durey.com', rol: 'vendedora', activo: true, estado: 'disponible' },
    { id: '9', nombre: 'Pedro Técnico (Planta)', email: 'tecnico@durey.com', rol: 'tecnico', activo: true, estado: 'disponible', especialidad: 'Mantenimiento General de Planta', telefono: '+51 912 345 678', tipo: 'interno' },
    { id: '10', nombre: 'Carlos Mendoza', email: 'carlos_mendoza@siemens.com', rol: 'tecnico', activo: true, estado: 'disponible', especialidad: 'Especialista Motores Siemens', telefono: '+54 11 4930-XXXX', tipo: 'externo' },
    { id: '11', nombre: 'Jorge Ramírez', email: 'jramirez@automation.com', rol: 'tecnico', activo: true, estado: 'en_reparacion', especialidad: 'Sensores y Sistemas Neumáticos', telefono: '+51 955 443 322', tipo: 'externo' }
  ],
  marcas_maquinas: [
    { id: 'm1', nombre: 'Angies' },
    { id: 'm2', nombre: 'Chinas Azules' },
    { id: 'm3', nombre: 'Chinas Verdes' },
    { id: 'm4', nombre: 'Rosso Speed' },
    { id: 'm5', nombre: 'Jacquard BK' }
  ],
  maquinas: [
    { id: 'maq1', codigo: 'TX-401', tipo: 'tejedora', marca_id: 'm1', anio: 2024, caracteristicas: 'Tejido Circular Fino', estado: 'activa', eficiencia: 98, detalle_estado: 'EFICIENCIA: 98%', marca: { nombre: 'Angies' } },
    { id: 'maq2', codigo: 'RD-105', tipo: 'remalladora', marca_id: 'm4', anio: 2024, caracteristicas: 'Remallado Automático', estado: 'malograda', eficiencia: 0, detalle_estado: 'ROTURA DE AGUJA', marca: { nombre: 'Rosso Speed' } },
    { id: 'maq3', codigo: 'BK-220', tipo: 'tejedora', marca_id: 'm5', anio: 2023, caracteristicas: 'Tejido Jacquard', estado: 'mantenimiento', eficiencia: 75, detalle_estado: 'PREVENTIVO EN CURSO', marca: { nombre: 'Jacquard BK' } },
    { id: 'maq4', codigo: 'TX-402', tipo: 'tejedora', marca_id: 'm2', anio: 2024, caracteristicas: 'Tejido Deportivo', estado: 'standby', eficiencia: 0, detalle_estado: 'SIN HILO (SET UP)', marca: { nombre: 'Chinas Azules' } },
    { id: 'maq5', codigo: 'R-01', tipo: 'remalladora', marca_id: 'm3', anio: 2024, caracteristicas: 'Remallado rápido', estado: 'activa', eficiencia: 92, detalle_estado: 'OPERATIVA', marca: { nombre: 'Chinas Verdes' } }
  ],
  ubicaciones: [
    { id: 'u1', nombre: 'Salón A', tipo: 'salon', activo: true },
    { id: 'u2', nombre: 'Salón B', tipo: 'salon', activo: true },
    { id: 'u3', nombre: 'Almacén General', tipo: 'almacen_general', activo: true }
  ],
  catalogo_medias: [
    { id: 'c1', sku: 'SKU-TOB-NIN-DIS-10', codigo: 'tobillera-niño-con_diseño-10-13', modelo: 'Tobillera', publico: 'Niño', diseno_color: 'con diseño', talla: '10-13', costo_produccion_docena: 12.50, estado: 'activo' },
    { id: 'c2', sku: 'SKU-TOB-HOM-NEG-UNI', codigo: 'tobillera-hombre-negro-única', modelo: 'Tobillera', publico: 'Hombre', diseno_color: 'negro', talla: 'única', costo_produccion_docena: 15.00, estado: 'activo' },
    { id: 'c3', sku: 'SKU-TOB-DAM-DIS-UNI', codigo: 'tobillera-dama-diseño-única', modelo: 'Tobillera', publico: 'Dama', diseno_color: 'diseño', talla: 'única', costo_produccion_docena: 14.50, estado: 'activo' },
    { id: 'c4', sku: 'SKU-TOB-NIN-DIS-05', codigo: 'tobillera-niño-con_diseño-5', modelo: 'Tobillera', publico: 'Niño', diseno_color: 'con diseño', talla: '5', costo_produccion_docena: 11.00, estado: 'activo' }
  ],
  turnos_produccion: [],
  reportes_produccion: [],
  turno_maquinas: [],
  // Minidepósitos con stock de prueba: 2 listos para remallar (≥75), 2 acumulando
  minidepositos: [
    { id: 'mini1', catalogo_media_id: 'c1', horario: 'dia', total_docenas: 75 },
    { id: 'mini2', catalogo_media_id: 'c2', horario: 'noche', total_docenas: 50 },
    { id: 'mini3', catalogo_media_id: 'c3', horario: 'dia', total_docenas: 30 },
    { id: 'mini4', catalogo_media_id: 'c4', horario: 'dia', total_docenas: 75 },
  ],
  lotes_remallado: [],
  reportes_remallado: [],
  // Cronograma semana 32 (semana actual). Todos los días de lunes a viernes para 2 planchadores
  cronograma_planchado: [
    { id: 'cr1', semana: 32, anio: 2026, planchador_id: '5b', dia_semana: 'lunes', criterio: 'talla', valor_criterio: '10-13' },
    { id: 'cr2', semana: 32, anio: 2026, planchador_id: '5b', dia_semana: 'martes', criterio: 'publico', valor_criterio: 'Hombre' },
    { id: 'cr3', semana: 32, anio: 2026, planchador_id: '5', dia_semana: 'lunes', criterio: 'publico', valor_criterio: 'Dama' },
    { id: 'cr4', semana: 32, anio: 2026, planchador_id: '5', dia_semana: 'martes', criterio: 'talla', valor_criterio: '5' },
    { id: 'cr5', semana: 32, anio: 2026, planchador_id: '5b', dia_semana: 'miercoles', criterio: 'publico', valor_criterio: 'Niño' },
    { id: 'cr6', semana: 32, anio: 2026, planchador_id: '5', dia_semana: 'miercoles', criterio: 'publico', valor_criterio: 'Hombre' },
    { id: 'cr7', semana: 32, anio: 2026, planchador_id: '5b', dia_semana: 'jueves', criterio: 'talla', valor_criterio: 'única' },
    { id: 'cr8', semana: 32, anio: 2026, planchador_id: '5', dia_semana: 'jueves', criterio: 'publico', valor_criterio: 'Niño' },
    { id: 'cr9', semana: 32, anio: 2026, planchador_id: '5b', dia_semana: 'viernes', criterio: 'publico', valor_criterio: 'Dama' },
    { id: 'cr10', semana: 32, anio: 2026, planchador_id: '5', dia_semana: 'viernes', criterio: 'talla', valor_criterio: '10-13' },
    { id: 'cr11', semana: 32, anio: 2026, planchador_id: '5b', dia_semana: 'sabado', criterio: 'talla', valor_criterio: '5' },
    { id: 'cr12', semana: 32, anio: 2026, planchador_id: '5', dia_semana: 'sabado', criterio: 'publico', valor_criterio: 'Dama' },
  ],
  reportes_planchado: [],
  // Stock listo para planchar con docenas variadas de los 4 tipos del catálogo
  stock_listo_planchar: [
    { id: 'slp1', catalogo_media_id: 'c1', docenas: 50 },
    { id: 'slp2', catalogo_media_id: 'c2', docenas: 30 },
    { id: 'slp3', catalogo_media_id: 'c3', docenas: 40 },
    { id: 'slp4', catalogo_media_id: 'c4', docenas: 15 },
  ],
  paquetes: [
    {
      id: 'p1',
      codigo_paquete: 'B-1001',
      docenas: 15,
      total_pares: 180,
      ubicacion_id: 'u1',
      estado: 'almacenado',
      preparador_id: '6',
      catalogo_media_id: 'c3',
      detalles_contenido: [
        { sku: 'SKU-TOB-DAM-DIS-UNI', codigo: 'tobillera-dama-diseño-única', docenas: 15, pares: 180 }
      ]
    },
    {
      id: 'p2',
      codigo_paquete: 'B-1002',
      docenas: 20,
      total_pares: 240,
      ubicacion_id: 'u2',
      estado: 'almacenado',
      preparador_id: '6b',
      catalogo_media_id: 'c1',
      detalles_contenido: [
        { sku: 'SKU-TOB-NIN-DIS-10', codigo: 'tobillera-niño-con_diseño-10-13', docenas: 20, pares: 240 }
      ]
    },
    {
      id: 'p3',
      codigo_paquete: 'B-1003',
      docenas: 30,
      total_pares: 360,
      ubicacion_id: 'u3',
      estado: 'almacenado',
      preparador_id: '6',
      catalogo_media_id: 'c2',
      detalles_contenido: [
        { sku: 'SKU-TOB-HOM-NEG-UNI', codigo: 'tobillera-hombre-negro-única', docenas: 30, pares: 360 }
      ]
    }
  ],
  clientes: [
    { id: 'cl1', nombre: 'Comercial La Gamarra S.A.C.', numero_documento: '20601234567', tipo_documento: 'ruc', telefono: '987654321', direccion: 'Jr. Gamarra 840, Galería Rey, Stand 102, La Victoria' },
    { id: 'cl2', nombre: 'Juan Carlos Pérez Mendoza', numero_documento: '45678912', tipo_documento: 'dni', telefono: '912345678', direccion: 'Av. Abancay 450, Cercado de Lima' }
  ],
  ventas: [],
  items_venta: [],
  cuotas: [],
  cobros: [],
  cajas_diarias: [],
  averias_maquinas: [
    { id: 'av1', maquina_id: 'maq2', descripcion_operador: 'RD-105: SOBRECALENTAMIENTO MOTOR PRINCIPAL — Se detectó aumento de temperatura superior a 85°C. Paro de emergencia automático activado.', tipo_averia: 'MECÁNICA', estado: 'pendiente', fecha_reporte: '2026-08-11 14:20:00', asignado_a: 'Carlos Mendoza', nivel: 'CRÍTICO' },
    { id: 'av2', maquina_id: 'maq4', descripcion_operador: 'TX-402: CAMBIO DE CORREA DENTADA — Mantenimiento preventivo programado completado con éxito. Pruebas de tensión superadas.', tipo_averia: 'MECÁNICA', estado: 'resuelto', fecha_reporte: '2026-08-10 09:15:00', asignado_a: 'Pedro Técnico (Planta)', nivel: 'RESUELTO' },
    { id: 'av3', maquina_id: 'maq3', descripcion_operador: 'BK-220: CALIBRACIÓN DE SENSORES — Ajuste de fotoceldas de empaque por desalineación en cajas de 12 unidades.', tipo_averia: 'ELECTRÓNICA', estado: 'resuelto', fecha_reporte: '2026-08-08 16:40:00', asignado_a: 'Jorge Ramírez', nivel: 'RESUELTO' }
  ],
  reparaciones: [],
  guias_remision: [],
  movimientos_stock: []
};

// Singleton en el servidor para almacenar en memoria durante ejecución
let globalDb: any = null;

export async function getMockDb() {
  const isServer = typeof window === 'undefined';

  if (isServer) {
    if (globalDb) return globalDb;

    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(process.cwd(), 'mock_db.json');

    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        globalDb = JSON.parse(fileContent);
      } catch (e) {
        console.error('Error al leer mock_db.json, usando semillas...', e);
        globalDb = { ...SEMILLAS };
      }
    } else {
      globalDb = { ...SEMILLAS };
      fs.writeFileSync(filePath, JSON.stringify(globalDb, null, 2));
    }
    return globalDb;
  } else {
    // Cliente (Browser)
    let localContent = localStorage.getItem('durey_mock_db');
    if (!localContent) {
      // Si no hay local, llamamos al API para obtener el JSON del servidor
      try {
        const res = await fetch('/api/mock-db');
        const serverDb = await res.json();
        localStorage.setItem('durey_mock_db', JSON.stringify(serverDb));
        return serverDb;
      } catch (e) {
        localStorage.setItem('durey_mock_db', JSON.stringify(SEMILLAS));
        return { ...SEMILLAS };
      }
    }
    return JSON.parse(localContent);
  }
}

export async function saveMockDb(db: any) {
  const isServer = typeof window === 'undefined';

  if (isServer) {
    globalDb = db;
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(process.cwd(), 'mock_db.json');
    fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
  } else {
    localStorage.setItem('durey_mock_db', JSON.stringify(db));
    // Sincronizar de vuelta al servidor de forma asíncrona
    try {
      await fetch('/api/mock-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(db),
      });
    } catch (e) {
      console.error('Error al sincronizar mock_db con el servidor', e);
    }
  }
}

// Emulador de consultas Fluent de Supabase
class MockQueryBuilder {
  private tableName: string;
  private isServer: boolean;

  constructor(tableName: string) {
    this.tableName = tableName;
    this.isServer = typeof window === 'undefined';
  }

  async getTableData(): Promise<any[]> {
    const db = await getMockDb();
    return db[this.tableName] || [];
  }

  async saveTableData(data: any[]) {
    const db = await getMockDb();
    db[this.tableName] = data;
    await saveMockDb(db);
  }

  select(fields?: string) {
    const self = this;
    let filters: ((item: any) => boolean)[] = [];
    let limitCount: number | null = null;
    let orderConfig: { column: string; ascending: boolean } | null = null;

    const queryObj = {
      eq(column: string, value: any) {
        filters.push(item => {
          if (item[column] && typeof item[column] === 'object' && !Array.isArray(item[column])) {
            return item[column].id === value || item[column].nombre === value || item[column].codigo === value;
          }
          return item[column] === value;
        });
        return queryObj;
      },
      in(column: string, values: any[]) {
        filters.push(item => values.includes(item[column]));
        return queryObj;
      },
      gt(column: string, value: any) {
        filters.push(item => item[column] > value);
        return queryObj;
      },
      lt(column: string, value: any) {
        filters.push(item => item[column] < value);
        return queryObj;
      },
      gte(column: string, value: any) {
        filters.push(item => item[column] >= value);
        return queryObj;
      },
      lte(column: string, value: any) {
        filters.push(item => item[column] <= value);
        return queryObj;
      },
      order(column: string, config?: { ascending: boolean }) {
        orderConfig = { column, ascending: config?.ascending !== false };
        return queryObj;
      },
      limit(count: number) {
        limitCount = count;
        return queryObj;
      },
      // Terminadores
      async single() {
        const data = await self.getTableData();
        let result = data;
        for (const filter of filters) {
          result = result.filter(filter);
        }
        return { data: result[0] || null, error: null };
      },
      then(onfulfilled?: (value: any) => any) {
        return this.execute().then(onfulfilled);
      },
      async execute() {
        const data = await self.getTableData();
        let result = [...data];

        // Aplicar filtros
        for (const filter of filters) {
          result = result.filter(filter);
        }

        // Aplicar orden
        if (orderConfig) {
          const { column, ascending } = orderConfig;
          result.sort((a, b) => {
            if (a[column] === b[column]) return 0;
            if (a[column] == null) return 1;
            if (b[column] == null) return -1;
            const factor = ascending ? 1 : -1;
            return a[column] > b[column] ? factor : -factor;
          });
        }

        // Aplicar límite
        if (limitCount !== null) {
          result = result.slice(0, limitCount);
        }

        // Mock resolver relaciones (Join simulation)
        // Agrega marcas a máquinas, usuarios a reportes, etc.
        const db = await getMockDb();
        if (self.tableName === 'maquinas') {
          result = result.map(m => ({
            ...m,
            marca: db.marcas_maquinas.find((br: any) => br.id === m.marca_id) || { nombre: 'Angies' }
          }));
        } else if (self.tableName === 'paquetes') {
          result = result.map(p => ({
            ...p,
            preparador: db.usuarios.find((u: any) => u.id === p.preparador_id) || null,
            catalogo_media: db.catalogo_medias.find((c: any) => c.id === p.catalogo_media_id) || { codigo: 'c1' },
            ubicacion: db.ubicaciones.find((u: any) => u.id === p.ubicacion_id) || null
          }));
        } else if (self.tableName === 'ventas') {
          result = result.map(v => ({
            ...v,
            cliente: db.clientes.find((c: any) => c.id === v.cliente_id) || { nombre: 'Cliente General', numero_documento: '12345678' },
            asesora: db.usuarios.find((u: any) => u.id === v.asesora_id) || { nombre: 'Sofia Vendedora' },
            items_venta: db.items_venta.filter((i: any) => i.venta_id === v.id).map((i: any) => ({
              ...i,
              catalogo_media: db.catalogo_medias.find((c: any) => c.id === i.catalogo_media_id) || { codigo: 'c1', modelo: 'Tobillera', publico: 'Niño' }
            }))
          }));
        } else if (self.tableName === 'lotes_remallado') {
          result = result.map(l => ({
            ...l,
            catalogo_media: db.catalogo_medias.find((c: any) => c.id === l.catalogo_media_id) || { codigo: 'c1' },
            remalladora: db.usuarios.find((u: any) => u.id === l.remalladora_id) || { nombre: 'Ana Remalladora' },
            maquina_remalladora: db.maquinas.find((m: any) => m.id === l.maquina_remalladora_id) || { codigo: 'R-01' }
          }));
        } else if (self.tableName === 'averias_maquinas') {
          result = result.map(a => ({
            ...a,
            maquina: db.maquinas.find((m: any) => m.id === a.maquina_id) || { codigo: 'A-01', tipo: 'tejedora' },
            reportado_por: db.usuarios.find((u: any) => u.id === a.reportado_por_id) || { nombre: 'Carlos Tejedor' },
            reparaciones: db.reparaciones.filter((r: any) => r.averia_id === a.id)
          }));
        } else if (self.tableName === 'cuotas') {
          result = result.map(q => {
            const v = db.ventas.find((v: any) => v.id === q.venta_id) || { codigo_venta: 'V-1001', cliente_id: '1', asesora_id: '8' };
            const c = db.clientes.find((c: any) => c.id === v.cliente_id) || { nombre: 'Cliente General' };
            const a = db.usuarios.find((u: any) => u.id === v.asesora_id) || db.usuarios.find((u: any) => u.rol === 'vendedora') || { id: '8', nombre: 'Sofia Vendedora' };
            return {
              ...q,
              venta: {
                id: v.id,
                codigo_venta: v.codigo_venta,
                total_soles: v.total_soles,
                cliente: c,
                asesora: { id: a.id || '8', nombre: a.nombre || 'Sofia Vendedora' }
              }
            };
          });
        } else if (self.tableName === 'reportes_produccion') {
          result = result.map(r => {
            const t = db.turnos_produccion.find((t: any) => t.id === r.turno_id) || { tejedor_id: '3' };
            const tej = db.usuarios.find((u: any) => u.id === t.tejedor_id) || { nombre: 'Carlos Tejedor' };
            return {
              ...r,
              maquina: db.maquinas.find((m: any) => m.id === r.maquina_id) || { codigo: 'A-01' },
              catalogo_media: db.catalogo_medias.find((c: any) => c.id === r.catalogo_media_id) || { codigo: 'c1' },
              turno: {
                ...t,
                tejedor: tej
              }
            };
          });
        } else if (self.tableName === 'turnos_produccion') {
          result = result.map(t => ({
            ...t,
            tejedor: db.usuarios.find((u: any) => u.id === t.tejedor_id) || { nombre: 'Tejedor Desconocido' },
            turno_maquinas: db.turno_maquinas.filter((tm: any) => tm.turno_id === t.id).map((tm: any) => ({
              ...tm,
              maquina: db.maquinas.find((m: any) => m.id === tm.maquina_id) || { codigo: 'A-01' },
              catalogo_media: db.catalogo_medias.find((c: any) => c.id === tm.catalogo_media_id) || { codigo: 'c1' }
            }))
          }));
        } else if (self.tableName === 'reportes_remallado') {
          result = result.map(r => {
            const l = db.lotes_remallado.find((l: any) => l.id === r.lote_id) || { catalogo_media_id: 'c1' };
            const c = db.catalogo_medias.find((c: any) => c.id === l.catalogo_media_id) || { codigo: 'c1' };
            return {
              ...r,
              lote: {
                catalogo_media: c
              }
            };
          });
        } else if (self.tableName === 'reportes_planchado') {
          result = result.map(r => ({
            ...r,
            planchador: db.usuarios.find((u: any) => u.id === r.planchador_id) || { nombre: 'Mario Planchador' },
            catalogo_media: db.catalogo_medias.find((c: any) => c.id === r.catalogo_media_id) || { codigo: 'c1' }
          }));
        } else if (self.tableName === 'cronograma_planchado') {
          result = result.map(cr => ({
            ...cr,
            planchador: db.usuarios.find((u: any) => u.id === cr.planchador_id) || { nombre: 'Mario Planchador' }
          }));
        } else if (self.tableName === 'stock_listo_planchar') {
          result = result.map(s => ({
            ...s,
            catalogo_media: db.catalogo_medias.find((c: any) => c.id === s.catalogo_media_id) || { id: 'c1', codigo: 'c1', talla: 'única', publico: 'Niño' }
          }));
        } else if (self.tableName === 'minidepositos') {
          result = result.map(m => ({
            ...m,
            catalogo_media: db.catalogo_medias.find((c: any) => c.id === m.catalogo_media_id) || { id: 'c1', codigo: 'tobillera-niño-con_diseño-10-13' }
          }));
        }

        return { data: result, error: null };
      }
    };

    return queryObj;
  }

  insert(data: any) {
    const self = this;
    const insertObj = {
      select() {
        return {
          async single() {
            const currentData = await self.getTableData();
            const items = Array.isArray(data) ? data : [data];
            const processedItems = items.map(item => ({
              id: item.id || Math.random().toString(36).substr(2, 9),
              created_at: new Date().toISOString(),
              fecha: item.fecha || new Date().toISOString().split('T')[0],
              ...item
            }));

            await self.saveTableData([...currentData, ...processedItems]);
            return { data: processedItems[0] || null, error: null };
          },
          then(onfulfilled?: (value: any) => any) {
            return this.single().then(onfulfilled);
          }
        };
      },
      then(onfulfilled?: (value: any) => any) {
        return this.execute().then(onfulfilled);
      },
      async execute() {
        const currentData = await self.getTableData();
        const items = Array.isArray(data) ? data : [data];
        const processedItems = items.map(item => ({
          id: item.id || Math.random().toString(36).substr(2, 9),
          created_at: new Date().toISOString(),
          fecha: item.fecha || new Date().toISOString().split('T')[0],
          ...item
        }));

        await self.saveTableData([...currentData, ...processedItems]);
        return { data: processedItems, error: null };
      }
    };

    return insertObj;
  }

  update(data: any) {
    const self = this;
    let filters: ((item: any) => boolean)[] = [];

    const updateObj = {
      eq(column: string, value: any) {
        filters.push(item => item[column] === value);
        return updateObj;
      },
      in(column: string, values: any[]) {
        filters.push(item => values.includes(item[column]));
        return updateObj;
      },
      select() {
        return {
          async single() {
            const currentData = await self.getTableData();
            let updatedItem: any = null;

            const updatedData = currentData.map(item => {
              const matches = filters.every(f => f(item));
              if (matches) {
                updatedItem = { ...item, ...data, updated_at: new Date().toISOString() };
                return updatedItem;
              }
              return item;
            });

            await self.saveTableData(updatedData);
            return { data: updatedItem, error: null };
          },
          then(onfulfilled?: (value: any) => any) {
            return this.single().then(onfulfilled);
          }
        };
      },
      then(onfulfilled?: (value: any) => any) {
        return this.execute().then(onfulfilled);
      },
      async execute() {
        const currentData = await self.getTableData();
        let updatedItems: any[] = [];

        const updatedData = currentData.map(item => {
          const matches = filters.every(f => f(item));
          if (matches) {
            const updated = { ...item, ...data, updated_at: new Date().toISOString() };
            updatedItems.push(updated);
            return updated;
          }
          return item;
        });

        await self.saveTableData(updatedData);
        return { data: updatedItems, error: null };
      }
    };

    return updateObj;
  }

  delete() {
    const self = this;
    let filters: ((item: any) => boolean)[] = [];

    const deleteObj = {
      eq(column: string, value: any) {
        filters.push(item => item[column] === value);
        return deleteObj;
      },
      in(column: string, values: any[]) {
        filters.push(item => values.includes(item[column]));
        return deleteObj;
      },
      then(onfulfilled?: (value: any) => any) {
        return this.execute().then(onfulfilled);
      },
      async execute() {
        const currentData = await self.getTableData();
        const remainingData = currentData.filter(item => !filters.every(f => f(item)));
        await self.saveTableData(remainingData);
        return { data: null, error: null };
      }
    };

    return deleteObj;
  }
}

export function createMockClient() {
  return {
    from(tableName: string) {
      return new MockQueryBuilder(tableName);
    },
    auth: {
      async getUser() {
        // En cliente, leemos las cookies demo de document.cookie
        const getCookie = (name: string) => {
          if (typeof document === 'undefined') return null;
          const value = `; ${document.cookie}`;
          const parts = value.split(`; ${name}=`);
          if (parts.length === 2) return parts.pop()?.split(';').shift();
          return null;
        };

        const demoRole = getCookie('durey_demo_role');
        if (demoRole) {
          return { data: { user: { id: 'demo-uuid', email: `${demoRole}@durey.com` } }, error: null };
        }
        return { data: { user: null }, error: new Error('Sin sesión') };
      },
      async signInWithPassword({ email }: any) {
        return { data: { user: { id: 'demo-uuid', email } }, error: null };
      },
      async signOut() {
        return { error: null };
      }
    }
  };
}
