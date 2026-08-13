import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'DUREY — Sistema de Gestión',
  description: 'Sistema de gestión de producción, almacén, ventas y finanzas para fábrica y tienda de medias DUREY.',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="font-sans antialiased bg-slate-950 text-white min-h-screen">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
