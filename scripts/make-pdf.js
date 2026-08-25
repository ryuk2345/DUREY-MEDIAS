const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const mdPath = path.join(__dirname, '../MANUAL_USUARIO.md');
const pdfPath = path.join(__dirname, '../MANUAL_USUARIO.pdf');

const content = fs.readFileSync(mdPath, 'utf8');

// Filter frontmatter
const cleanMd = content.replace(/^---[\s\S]*?---\n/, '');

const doc = new PDFDocument({
  size: 'LETTER',
  margin: 50,
  bufferPages: true
});

const writeStream = fs.createWriteStream(pdfPath);
doc.pipe(writeStream);

// Styles
const colors = {
  primary: '#4f46e5',
  secondary: '#2563eb',
  text: '#1e293b',
  muted: '#64748b',
  bgInfo: '#eff6ff',
  borderInfo: '#3b82f6'
};

// Cover / Title Page
doc.moveDown(4);
doc.fillColor(colors.primary).fontSize(28).font('Helvetica-Bold').text('MANUAL DE USUARIO', { align: 'center' });
doc.moveDown(0.5);
doc.fillColor(colors.secondary).fontSize(16).font('Helvetica').text('Sistema de Control de Producción y Ventas DUREY', { align: 'center' });
doc.moveDown(2);
doc.fillColor(colors.text).fontSize(11).font('Helvetica').text('Un manual sencillo y didáctico para configurar y operar tu fábrica de medias de manera digital.', { align: 'center' });
doc.moveDown(6);

doc.fillColor(colors.muted).fontSize(10).text('Fábrica de Medias Durey S.A.', { align: 'center' });
doc.text('Versión del Sistema: 2.1 • Documento de Usuario Final', { align: 'center' });
doc.text('Año 2026', { align: 'center' });

doc.addPage();

// Parse lines
const lines = cleanMd.split('\n');

lines.forEach(line => {
  const trimmed = line.trim();
  if (!trimmed) {
    doc.moveDown(0.4);
    return;
  }

  // Heading 1
  if (trimmed.startsWith('# ')) {
    const title = trimmed.replace('# ', '');
    doc.moveDown(1);
    doc.fillColor(colors.primary).fontSize(18).font('Helvetica-Bold').text(title);
    doc.moveDown(0.3);
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.5);
  } 
  // Heading 2
  else if (trimmed.startsWith('## ')) {
    const title = trimmed.replace('## ', '');
    doc.moveDown(0.8);
    doc.fillColor(colors.secondary).fontSize(14).font('Helvetica-Bold').text(title);
    doc.moveDown(0.4);
  }
  // Heading 3
  else if (trimmed.startsWith('### ')) {
    const title = trimmed.replace('### ', '');
    doc.moveDown(0.6);
    doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text(title);
    doc.moveDown(0.3);
  }
  // Bullet points
  else if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
    const bulletText = trimmed.replace(/^[*|-]\s+/, '').replace(/\*\*(.*?)\*\*/g, '$1');
    doc.fillColor(colors.text).fontSize(10).font('Helvetica').text(`• ${bulletText}`, { indent: 15 });
  }
  // Numbered list
  else if (/^\d+\.\s+/.test(trimmed)) {
    const numText = trimmed.replace(/\*\*(.*?)\*\*/g, '$1');
    doc.fillColor(colors.text).fontSize(10).font('Helvetica').text(numText, { indent: 15 });
  }
  // Regular text
  else if (!trimmed.startsWith('|') && !trimmed.startsWith('<div')) {
    const plainText = trimmed.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    doc.fillColor(colors.text).fontSize(10).font('Helvetica').text(plainText);
  }
});

// Add headers & footers to all pages
const pages = doc.bufferedPageRange();
for (let i = 0; i < pages.count; i++) {
  doc.switchToPage(i);
  if (i > 0) { // Skip title page
    // Header
    doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text('MANUAL DE USUARIO - SISTEMA DUREY', 50, 25, { width: 250, align: 'left' });
    doc.text('Fábrica de Medias Durey', 312, 25, { width: 250, align: 'right' });
    doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(50, 38).lineTo(562, 38).stroke();
    
    // Footer
    doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(50, 750).lineTo(562, 750).stroke();
    doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text(`Página ${i + 1} de ${pages.count}`, 50, 755, { align: 'center' });
  }
}

doc.end();

writeStream.on('finish', () => {
  console.log('PDF created successfully at ' + pdfPath);
});
