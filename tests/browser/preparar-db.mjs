// Copia los datos de prueba a mock_db.e2e.json antes de levantar la app.
// La usa playwright.config.ts (webServer); así cada corrida empieza igual.
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

copyFileSync(
  fileURLToPath(new URL('./datos-prueba.json', import.meta.url)),
  fileURLToPath(new URL('../../mock_db.e2e.json', import.meta.url))
)
