const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const pdfPath = path.join(__dirname, '../MANUAL_USUARIO.pdf');
const imgDir = path.join(__dirname, '../public/images');

const doc = new PDFDocument({
  size: 'LETTER',
  margin: 40,
  bufferPages: true
});

const writeStream = fs.createWriteStream(pdfPath);
doc.pipe(writeStream);

// Colors
const colors = {
  primary: '#4f46e5',   // Indigo/Violet
  secondary: '#2563eb', // Royal Blue
  dark: '#0f172a',      // Slate 900
  body: '#334155',      // Slate 700
  muted: '#64748b',     // Slate 500
  lightBg: '#f8fafc',   // Slate 50
  infoBg: '#eff6ff',    // Blue 50
  infoBorder: '#3b82f6',
  successBg: '#f0fdf4', // Green 50
  successBorder: '#22c55e',
  tableHeader: '#f1f5f9'
};

// Helper: Header bar
function drawHeader(title) {
  doc.fillColor(colors.primary).fontSize(16).font('Helvetica-Bold').text(title);
  doc.moveDown(0.2);
  doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(40, doc.y).lineTo(572, doc.y).stroke();
  doc.moveDown(0.6);
}

// Helper: Subheader
function drawSubheader(title) {
  doc.moveDown(0.4);
  doc.fillColor(colors.secondary).fontSize(13).font('Helvetica-Bold').text(title);
  doc.moveDown(0.3);
}

// Helper: Sub-subheader
function drawH3(title) {
  doc.moveDown(0.3);
  doc.fillColor(colors.dark).fontSize(11).font('Helvetica-Bold').text(title);
  doc.moveDown(0.2);
}

// Helper: Paragraph
function drawParagraph(text) {
  doc.fillColor(colors.body).fontSize(10).font('Helvetica').text(text, { lineGap: 3 });
  doc.moveDown(0.4);
}

// Helper: Bullet point
function drawBullet(text) {
  doc.fillColor(colors.body).fontSize(10).font('Helvetica').text(`•  ${text}`, { indent: 10, lineGap: 2 });
  doc.moveDown(0.2);
}

// Helper: Numbered item
function drawNumbered(num, text) {
  doc.fillColor(colors.body).fontSize(10).font('Helvetica').text(`${num}.  ${text}`, { indent: 10, lineGap: 2 });
  doc.moveDown(0.2);
}

// Helper: Callout box
function drawCallout(title, text, type = 'info') {
  const startY = doc.y;
  const bg = type === 'success' ? colors.successBg : colors.infoBg;
  const border = type === 'success' ? colors.successBorder : colors.infoBorder;

  // Box dimensions
  const width = 532;
  const padding = 10;

  // Measure text height
  doc.font('Helvetica-Bold').fontSize(10);
  const titleHeight = title ? 14 : 0;
  doc.font('Helvetica').fontSize(9.5);
  const textHeight = doc.heightOfString(text, { width: width - (padding * 2) });
  const boxHeight = titleHeight + textHeight + (padding * 2);

  // Background rectangle
  doc.rect(40, startY, width, boxHeight).fill(bg);
  // Left border bar
  doc.rect(40, startY, 4, boxHeight).fill(border);

  // Text inside
  let currentY = startY + padding;
  if (title) {
    doc.fillColor(colors.dark).fontSize(10).font('Helvetica-Bold').text(title, 52, currentY);
    currentY += titleHeight;
  }
  doc.fillColor(colors.body).fontSize(9.5).font('Helvetica').text(text, 52, currentY, { width: width - (padding * 2) });

  doc.y = startY + boxHeight + 10;
}

// Helper: Embed Image safely
function drawEmbeddedImage(filename, caption) {
  const imgPath = path.join(imgDir, filename);
  if (fs.existsSync(imgPath)) {
    try {
      doc.moveDown(0.4);
      const startY = doc.y;
      // Draw centered image
      doc.image(imgPath, 76, startY, { fit: [460, 220], align: 'center' });
      doc.y = startY + 225;
      if (caption) {
        doc.fillColor(colors.muted).fontSize(8.5).font('Helvetica-Oblique').text(caption, { align: 'center' });
        doc.moveDown(0.5);
      }
    } catch (e) {
      console.error('Error rendering image ' + filename + ':', e);
    }
  }
}

// ==========================================
// PAGE 1: COVER PAGE
// ==========================================
doc.rect(40, 40, 532, 712).strokeColor('#e2e8f0').lineWidth(1).stroke();
doc.rect(40, 40, 532, 10).fill(colors.primary);

doc.moveDown(5);
doc.fillColor(colors.primary).fontSize(30).font('Helvetica-Bold').text('MANUAL DE USUARIO', { align: 'center' });
doc.moveDown(0.4);
doc.fillColor(colors.secondary).fontSize(16).font('Helvetica').text('Sistema de Control de Producción y Ventas DUREY', { align: 'center' });

doc.moveDown(1.5);
doc.strokeColor(colors.secondary).lineWidth(2).moveTo(200, doc.y).lineTo(412, doc.y).stroke();
doc.moveDown(2);

doc.fillColor(colors.body).fontSize(11).font('Helvetica').text('Guía explicativa paso a paso para la configuración de datos maestro, control de planta en tiempo real, gestión de almacén y ventas de la fábrica de medias.', { align: 'center', width: 440, indent: 46 });

doc.moveDown(7);
doc.fillColor(colors.dark).fontSize(11).font('Helvetica-Bold').text('FÁBRICA DE MEDIAS DUREY S.A.', { align: 'center' });
doc.moveDown(0.3);
doc.fillColor(colors.muted).fontSize(9.5).font('Helvetica').text('Documento Oficial para Usuario Final • Versión del Sistema 2.1', { align: 'center' });
doc.moveDown(0.2);
doc.fillColor(colors.muted).fontSize(9.5).font('Helvetica').text('Año 2026', { align: 'center' });

// ==========================================
// PAGE 2: INTRODUCCIÓN & FLUJO
// ==========================================
doc.addPage();
drawHeader('Introducción al Sistema DUREY');

drawParagraph('El Sistema de Control DUREY es una plataforma digital integral diseñada para supervisar y automatizar todo el ciclo de fabricación y comercialización de medias en la planta industrial. Conecta en tiempo real a tejedores, remalladoras, planchadores, empaquetadores, almaceneros y asesoras de ventas.');

drawSubheader('El Flujo de Trabajo en la Fábrica');
drawParagraph('El sistema sigue de forma automatizada la secuencia lógica de producción de la planta:');

drawNumbered('1', 'Tejido: Se planifican los turnos de las máquinas tejedoras. El tejedor registra la producción y las docenas avanzan automáticamente a Minidepósitos.');
drawNumbered('2', 'Remallado (Enlace): La operadora toma docenas de los minidepósitos, remalla la punta de las medias y registra el cierre de lote, enviando el producto a Stock Listo para Planchar.');
drawNumbered('3', 'Planchado: El planchador procesa el stock acumulado, descuenta prendas defectuosas y promueve la producción apta hacia el área de empaque.');
drawNumbered('4', 'Preparado (Empaque): Se agrupan las medias en docenas rotuladas con Códigos de Barras correlativos (PKG-XXXX), ingresándolas formalmente al Almacén de Producto Terminado.');
drawNumbered('5', 'Ventas y Despacho: La vendedora escanea o selecciona los paquetes del almacén, genera la venta al contado o crédito, registra cobros en caja y emite la Guía de Remisión para la entrega.');

drawCallout('Supervisión en Tiempo Real', 'Todos los movimientos de stock entre etapas se actualizan de forma instantánea. El Administrador y los Supervisores pueden consultar el estado de cada lote desde cualquier dispositivo móvil o computadora.', 'info');

// ==========================================
// PAGE 3: CAPÍTULO 1 - CONFIGURACIÓN INICIAL & LOGIN
// ==========================================
doc.addPage();
drawHeader('Capítulo 1: Primeros Pasos y Configuración Inicial');

drawParagraph('Antes de iniciar el registro diario de producción en planta, el Administrador General debe registrar los datos iniciales o "Tablas Maestras" del sistema.');

drawSubheader('1. Inicio de Sesión');
drawParagraph('Para ingresar al sistema, abra el navegador web e introduzca sus credenciales en la pantalla de bienvenida.');

// EMBEDDED LOGIN IMAGE
drawEmbeddedImage('login.png', 'Figura 1.1: Pantalla de inicio de sesión del Sistema DUREY');

drawSubheader('2. Registrar al Personal (Usuarios)');
drawParagraph('Navegue al módulo "Personal" en la barra lateral e ingrese a cada trabajador indicando su nombre, correo y Rol correspondiente:');

// DRAW TABLE FOR ROLES
const tableTop = doc.y + 5;
const tableHeaders = ['Rol', 'Función en el Sistema', 'Permisos'];
const colWidths = [100, 180, 252];

// Table Header
doc.rect(40, tableTop, 532, 20).fill(colors.tableHeader);
doc.fillColor(colors.dark).fontSize(9.5).font('Helvetica-Bold');
doc.text(tableHeaders[0], 48, tableTop + 5, { width: colWidths[0] });
doc.text(tableHeaders[1], 148, tableTop + 5, { width: colWidths[1] });
doc.text(tableHeaders[2], 328, tableTop + 5, { width: colWidths[2] });

// Table Rows
const rows = [
  ['Administrador', 'Gerencia General / Dueño', 'Acceso total a reportes, finanzas, personal y catálogo.'],
  ['Supervisor', 'Encargado de Planta', 'Crea turnos de tejido, asigna lotes y monitorea stock.'],
  ['Operador', 'Tejedor / Remalladora / Planchador', 'Registra la producción diaria desde su estación.'],
  ['Vendedora', 'Área Comercial', 'Registra ventas, clientes, cobros de caja y guías.'],
  ['Técnico', 'Soporte Mecánico', 'Atiende averías de máquinas y registra repuestos.']
];

let rowY = tableTop + 20;
doc.font('Helvetica').fontSize(8.5);

rows.forEach((row, i) => {
  const rowHeight = 22;
  if (i % 2 === 1) {
    doc.rect(40, rowY, 532, rowHeight).fill('#fafafa');
  }
  doc.rect(40, rowY, 532, rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

  doc.fillColor(colors.primary).font('Helvetica-Bold').text(row[0], 48, rowY + 6, { width: colWidths[0] });
  doc.fillColor(colors.body).font('Helvetica').text(row[1], 148, rowY + 6, { width: colWidths[1] });
  doc.fillColor(colors.body).font('Helvetica').text(row[2], 328, rowY + 6, { width: colWidths[2] });

  rowY += rowHeight;
});

doc.y = rowY + 15;

// ==========================================
// PAGE 4: MAQUINAS & CATALOGO
// ==========================================
doc.addPage();
drawHeader('Configuración de Máquinas y Catálogo');

drawSubheader('3. Registrar Máquinas');
drawParagraph('Para tener trazabilidad de los equipos en planta y controlar el mantenimiento:');
drawNumbered('1', 'Acceda al menú "Máquinas" en la barra lateral.');
drawNumbered('2', 'En la pestaña "Marcas", ingrese las marcas de su parque de máquinas (ej: Lonati, Sangiacomo).');
drawNumbered('3', 'Haga clic en "Agregar Máquina" y complete el código identificador (ej: TEJ-01, REM-01), el tipo de máquina y la marca.');
drawNumbered('4', 'Al crearse, la máquina cambiará automáticamente a estado ACTIVA y estará lista para ser asignada en turnos.');

drawSubheader('4. Configurar el Catálogo de Medias');
drawParagraph('El catálogo define los tipos de medias producidos en la fábrica y sus precios de venta por docena:');
drawNumbered('1', 'Acceda al menú "Catálogo" y presione "Agregar Media".');
drawNumbered('2', 'Complete los datos del modelo: Modelo (ej: Tobillera), Público (ej: Caballero), Diseño/Color (ej: Rayas Azules), Talla (ej: M o Única) y Precio de Venta por docena.');
drawNumbered('3', 'Al guardar, el sistema autogenerará un código SKU único para identificar el producto en almacén y ventas.');

drawCallout('Importante', 'El precio por docena configurado en el catálogo será el utilizado por defecto al momento de realizar ventas y calcular las proyecciones financieras.', 'info');

// ==========================================
// PAGE 5: CAPÍTULO 2 - PRODUCCIÓN & DASHBOARD
// ==========================================
doc.addPage();
drawHeader('Capítulo 2: El Ciclo Diario de Producción');

drawParagraph('Con la configuración inicial terminada, la fábrica opera el ciclo productivo diario. Los supervisores disponen del tablero de control de fábrica en tiempo real:');

// EMBEDDED DASHBOARD IMAGE
drawEmbeddedImage('dashboard.png', 'Figura 2.1: Tablero de Monitoreo de Producción en Planta (Durey Dashboard)');

drawSubheader('Etapa 1: Tejido (Producción Inicial)');
drawParagraph('1. Supervisor: Planifica los turnos asignando tejedores, máquinas tejedoras y horarios.');
drawParagraph('2. Tejedor: Inicia sesión en su terminal, presiona "Iniciar Carga de Lote" y al finalizar su turno registra las docenas tejidas reales.');
drawParagraph('3. Resultado: Las docenas se suman al inventario de Minidepósitos y la máquina se libera automáticamente.');

drawSubheader('Etapa 2: Remallado (Cierre de Lote Atómico)');
drawParagraph('1. Supervisor: Asigna un lote de remallado tomando docenas de los Minidepósitos.');
drawParagraph('2. Remalladora: Procesa las prendas y registra las docenas remalladas y las restantes.');

drawCallout('Garantía Transaccional en Remallado', 'El cierre de lote de remallado ejecuta una función atómica en la base de datos: en un solo paso actualiza el lote a completado, libera la máquina a disponible y transfiere las docenas directamente a Stock Listo para Planchar.', 'success');

// ==========================================
// PAGE 6: PLANCHADO & PREPARADO
// ==========================================
doc.addPage();
drawHeader('Etapas de Planchado y Empaque (Preparado)');

drawSubheader('Etapa 3: Planchado y Control de Calidad');
drawParagraph('En esta fase se le da forma final a la prenda y se realiza la inspección física:');
drawNumbered('1', 'El planchador ingresa al módulo "Planchado" y selecciona el modelo de media disponible en el stock acumulado.');
drawNumbered('2', 'Al finalizar el proceso, registra dos valores: Docenas Planchadas (aptas) y Docenas Defectuosas (prendas con fallas o manchadas).');
drawNumbered('3', 'El sistema descuenta el stock procesado y promueve únicamente las docenas aptas a la lista de "Listo para Empaque".');

drawSubheader('Etapa 4: Preparado (Empaque y Rotulado)');
drawParagraph('Consiste en el empacado final e ingreso formal al inventario valorizado:');
drawNumbered('1', 'El preparador ingresa al módulo "Preparado" y selecciona las docenas limpias de planchado.');
drawNumbered('2', 'Agrupa las prendas en paquetes de 1 docena (12 pares) y confirma el empaque en el sistema.');
drawNumbered('3', 'El sistema genera automáticamente un Código de Paquete correlativo (ej: PKG-0024) y su respectiva etiqueta con código de barras, ingresándolo como inventario disponible en el Almacén.');

// ==========================================
// PAGE 7: CAPÍTULO 3 - VENTAS & CAJA
// ==========================================
doc.addPage();
drawHeader('Capítulo 3: Ventas, Caja y Despacho');

drawParagraph('El departamento comercial (Vendedoras) gestiona la venta y despacho de los paquetes terminados en almacén:');

// EMBEDDED VENTAS IMAGE
drawEmbeddedImage('ventas.png', 'Figura 3.1: Pantalla de registro de Nueva Venta y escaneo de paquetes');

drawSubheader('1. Registro de Ventas');
drawNumbered('1', 'Ingrese al menú "Ventas" y seleccione "Nueva Venta".');
drawNumbered('2', 'Seleccione el cliente registrado o ingrese los datos de un cliente nuevo.');
drawNumbered('3', 'Escanee con la lectora de código de barras la etiqueta del paquete (PKG-XXXX) o selecciónelo manualmente del inventario.');
drawNumbered('4', 'Elija la condición de pago: Contado o Crédito Diferido (definiendo fecha de vencimiento y cuotas).');
drawNumbered('5', 'Presione "Confirmar Venta".');

drawSubheader('2. Caja y Cobros');
drawParagraph('Al iniciar el turno, la vendedora realiza la "Apertura de Caja" con el saldo inicial en efectivo. Para cobrar ventas al crédito, selecciona la venta, registra el monto cobrado y el método de pago (Efectivo, Yape, Plin o Transferencia).');

drawSubheader('3. Despacho');
drawParagraph('Desde el menú "Despacho", la vendedora emite la Guía de Remisión asignando el transportista y marca el estado como ENTREGADO cuando la mercadería sale físicamente de la fábrica.');

// ==========================================
// PAGE 8: CAPÍTULO 4 - INCIDENCIAS & MANTENIMIENTO
// ==========================================
doc.addPage();
drawHeader('Capítulo 4: Gestión de Incidencias y Mantenimiento');

drawParagraph('Si una máquina sufre una falla durante la operación en planta, el sistema ejecuta el protocolo de bloqueo y alerta:');

drawSubheader('1. Reporte de Averías');
drawNumbered('1', 'El operador o supervisor hace clic en "Reportar Avería" en la máquina afectada desde el menú de Máquinas o Mantenimiento.');
drawNumbered('2', 'Ingresa una descripción breve de la falla (ej: "Aguja rota en cilindro 2").');
drawNumbered('3', 'La máquina cambia de inmediato a estado MANTENIMIENTO y se bloquea en el sistema, impidiendo que sea asignada en nuevos turnos.');

drawSubheader('2. Atención del Técnico');
drawNumbered('1', 'El técnico entra a su panel de Mantenimiento y visualiza la lista de averías pendientes.');
drawNumbered('2', 'Al reparar la máquina, hace clic en "Registrar Reparación", detallando el trabajo realizado y los repuestos utilizados.');
drawNumbered('3', 'Al presionar "Completar Reparación", el sistema cambia el estado de la máquina nuevamente a ACTIVA, dejándola lista para ser usada en el siguiente turno de producción.');

drawCallout('Control de Repuestos', 'Todos los repuestos utilizados durante una reparación quedan registrados en el historial de mantenimiento de la máquina, permitiendo calcular los costos operativos por equipo.', 'info');

// ==========================================
// ADD FOOTERS & PAGE NUMBERS TO ALL PAGES
// ==========================================
const totalPages = doc.bufferedPageRange().count;

for (let i = 0; i < totalPages; i++) {
  doc.switchToPage(i);
  if (i > 0) { // Skip Cover
    // Header text
    doc.fillColor(colors.muted).fontSize(8).font('Helvetica').text('MANUAL DE USUARIO - SISTEMA DUREY', 40, 20, { width: 250, align: 'left' });
    doc.text('Fábrica de Medias Durey S.A.', 322, 20, { width: 250, align: 'right' });
    doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(40, 32).lineTo(572, 32).stroke();

    // Footer text
    doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(40, 750).lineTo(572, 750).stroke();
    doc.fillColor(colors.muted).fontSize(8).font('Helvetica').text(`Página ${i + 1} de ${totalPages}`, 40, 756, { align: 'center' });
  }
}

doc.end();

writeStream.on('finish', () => {
  console.log('PERFECT PDF generated successfully at ' + pdfPath);
});
