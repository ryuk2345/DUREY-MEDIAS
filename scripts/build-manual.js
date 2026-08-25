const fs = require('fs');
const path = require('path');

const mdPath = path.join(__dirname, '../MANUAL_USUARIO.md');
const htmlPath = path.join(__dirname, '../MANUAL_USUARIO.html');

let mdContent = fs.readFileSync(mdPath, 'utf8');

// Strip YAML frontmatter
mdContent = mdContent.replace(/^---[\s\S]*?---\n/, '');

// Helper to convert Markdown table to HTML table
function convertTables(text) {
  return text.replace(/\|(.+)\|[\r\n]\|[-| ]+\|[\r\n]((?:\|.+\|[\r\n]?)+)/g, (match, header, rows) => {
    const headers = header.split('|').map(h => h.trim()).filter(Boolean);
    const rowLines = rows.trim().split('\n');
    
    let html = '<table><thead><tr>';
    headers.forEach(h => { html += `<th>${h}</th>`; });
    html += '</tr></thead><tbody>';

    rowLines.forEach(line => {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length > 0) {
        html += '<tr>';
        cells.forEach(c => { html += `<td>${c}</td>`; });
        html += '</tr>';
      }
    });

    html += '</tbody></table>';
    return html;
  });
}

mdContent = convertTables(mdContent);

// Convert Markdown to HTML
let htmlBody = mdContent
  .replace(/^# (.*$)/gim, '<h1>$1</h1>')
  .replace(/^## (.*$)/gim, '<h2>$1</h2>')
  .replace(/^### (.*$)/gim, '<h3>$1</h3>')
  .replace(/!\[(.*?)\]\((.*?)\)/gim, '<img src="$2" alt="$1" />')
  .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
  .replace(/\*(.*?)\*/gim, '<em>$1</em>')
  .replace(/`([^`]+)`/gim, '<code>$1</code>')
  .replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
  .replace(/<div class="info-box">([\s\S]*?)<\/div>/gim, '<div class="info-box">$1</div>')
  .replace(/<div class="success-box">([\s\S]*?)<\/div>/gim, '<div class="success-box">$1</div>')
  .replace(/\n\n/gim, '</p><p>');

const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Manual de Usuario - Sistema DUREY</title>
  <style>
    @page {
      size: letter;
      margin: 15mm;
    }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: #1e293b;
      line-height: 1.6;
      max-width: 960px;
      margin: 0 auto;
      padding: 30px 20px;
      background-color: #f8fafc;
    }
    .container {
      background: white;
      padding: 50px;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.06);
    }
    h1 { color: #4f46e5; font-size: 24pt; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-top: 40px; }
    h2 { color: #2563eb; font-size: 16pt; margin-top: 30px; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; }
    h3 { color: #0f172a; font-size: 12pt; margin-top: 20px; font-weight: bold; }
    img { max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 6px 18px rgba(0,0,0,0.12); margin: 25px 0; display: block; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 10pt; }
    th, td { border: 1px solid #cbd5e1; padding: 10px 14px; text-align: left; }
    th { background-color: #f1f5f9; font-weight: bold; color: #334155; }
    .info-box { background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; border-radius: 8px; margin: 20px 0; font-size: 10pt; }
    .success-box { background-color: #f0fdf4; border-left: 4px solid #22c55e; padding: 15px; border-radius: 8px; margin: 20px 0; font-size: 10pt; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 8pt; font-weight: bold; text-transform: uppercase; }
    .badge-admin { background-color: #f3e8ff; color: #7e22ce; }
    .badge-super { background-color: #e0e7ff; color: #4338ca; }
    .badge-oper { background-color: #ffedd5; color: #c2410c; }
    .badge-vend { background-color: #fce7f3; color: #be185d; }
    .badge-tecn { background-color: #fef3c7; color: #b45309; }
    .print-btn {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4f46e5;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 30px;
      font-weight: bold;
      font-size: 14px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
      z-index: 1000;
    }
    @media print {
      body { background: white; padding: 0; }
      .container { box-shadow: none; padding: 0; }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
  <div class="container">
    ${htmlBody}
  </div>
</body>
</html>`;

fs.writeFileSync(htmlPath, fullHtml);
console.log('HTML Manual built successfully');
