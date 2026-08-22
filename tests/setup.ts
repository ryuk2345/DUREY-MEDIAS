import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Supress Next.js router warnings in test environment
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}))

// Supress sonner toasts in test environment (don't render portals)
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))
