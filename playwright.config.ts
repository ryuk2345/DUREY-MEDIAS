import { defineConfig } from '@playwright/test'
import { SECRETO_JWT_PRUEBAS } from './tests/browser/sesion'

const PUERTO = 3123

/**
 * Tests de navegador: levantan la app en modo mock (sin Supabase real) con una
 * base aparte (mock_db.e2e.json) sembrada desde tests/browser/datos-prueba.json.
 * Primera vez en una máquina nueva: npx playwright install chromium
 */
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    viewport: { width: 1400, height: 1000 },
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: `node tests/browser/preparar-db.mjs && npx next dev -p ${PUERTO}`,
    url: `http://localhost:${PUERTO}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // Una URL que no es de Supabase activa el modo mock aunque exista un .env.local
      NEXT_PUBLIC_SUPABASE_URL: 'http://mock.local',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_JWT_SECRET: SECRETO_JWT_PRUEBAS,
      DUREY_MOCK_DB_E2E: '1',
    },
  },
})
