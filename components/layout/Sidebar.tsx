'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MODULOS_POR_ROL, ROLES_LABELS, cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Shirt, LayoutDashboard, Cog, Layers, Scissors, Wind,
  Package, Warehouse, ShoppingCart, Truck, Wrench,
  BarChart3, LogOut, ChevronRight, Cpu, Users, Menu, X,
  ClipboardList, Database, RotateCcw, Palette
} from 'lucide-react'
import StockNotification from './StockNotification'

const MODULO_CONFIG: Record<string, { label: string; icon: React.ReactNode; href: string; color: string }> = {
  admin:        { label: 'Dashboard',    icon: <LayoutDashboard className="w-5 h-5" />, href: '/dashboard/admin',         color: 'text-violet-400' },
  usuarios:     { label: 'Personal',     icon: <Users className="w-5 h-5" />,           href: '/dashboard/usuarios',      color: 'text-indigo-400' },
  catalogo:     { label: 'Catálogo',     icon: <Cog className="w-5 h-5" />,             href: '/dashboard/catalogo',      color: 'text-slate-400' },
  maquinas:     { label: 'Máquinas',     icon: <Cpu className="w-5 h-5" />,             href: '/dashboard/maquinas',      color: 'text-sky-400' },
  disenos:      { label: 'Diseños',      icon: <Palette className="w-5 h-5" />,         href: '/dashboard/disenos',       color: 'text-fuchsia-400' },
  produccion:   { label: 'Tejido',       icon: <Layers className="w-5 h-5" />,          href: '/dashboard/produccion',    color: 'text-violet-400' },
  remallado:    { label: 'Remallado',    icon: <Scissors className="w-5 h-5" />,        href: '/dashboard/remallado',     color: 'text-orange-400' },
  volteado:     { label: 'Volteado',     icon: <RotateCcw className="w-5 h-5" />,       href: '/dashboard/volteado',      color: 'text-indigo-300' },
  planchado:    { label: 'Planchado',    icon: <Wind className="w-5 h-5" />,            href: '/dashboard/planchado',     color: 'text-red-400' },
  preparado:    { label: 'Preparado',    icon: <Package className="w-5 h-5" />,         href: '/dashboard/preparado',     color: 'text-emerald-400' },
  almacen:      { label: 'Almacén',      icon: <Warehouse className="w-5 h-5" />,       href: '/dashboard/almacen',       color: 'text-cyan-400' },
  ventas:       { label: 'Ventas',       icon: <ShoppingCart className="w-5 h-5" />,    href: '/dashboard/ventas',        color: 'text-pink-400' },
  despacho:     { label: 'Despacho',     icon: <Truck className="w-5 h-5" />,           href: '/dashboard/despacho',      color: 'text-blue-400' },
  mantenimiento:{ label: 'Mantenimiento',icon: <Wrench className="w-5 h-5" />,         href: '/dashboard/mantenimiento', color: 'text-amber-400' },
  materia_prima:{ label: 'Materia Prima',icon: <Database className="w-5 h-5" />,         href: '/dashboard/materia-prima', color: 'text-emerald-300' },
  reportes:     { label: 'Reportes',     icon: <BarChart3 className="w-5 h-5" />,       href: '/dashboard/reportes',      color: 'text-teal-400' },
}

interface SidebarProps {
  userRol: string
  userName: string
}

export default function Sidebar({ userRol, userName }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const modulos = MODULOS_POR_ROL[userRol] ?? []

  // Mobile drawer open/close state
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close drawer on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    document.cookie = 'durey_mock_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;'
    document.cookie = 'durey_demo_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;'
    document.cookie = 'durey_demo_name=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;'
    document.cookie = 'durey_user_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;'
    document.cookie = 'durey_user_logged=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;'
    toast.success('Sesión cerrada correctamente')
    window.location.href = '/login'
  }

  const sidebarContent = (collapsed = false) => (
    <>
      {/* Logo */}
      <div className={cn(
        'flex items-center gap-3 border-b border-white/[0.06]',
        collapsed ? 'px-0 py-5 justify-center' : 'px-5 py-5'
      )}>
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex-shrink-0">
          <Shirt className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div>
            <p className="font-bold text-white text-lg leading-none">DUREY</p>
            <p className="text-slate-500 text-[10px] mt-0.5">Sistema de Gestión</p>
          </div>
        )}
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto py-4 space-y-1 px-2">
        {modulos.map((modulo) => {
          const config = MODULO_CONFIG[modulo]
          if (!config) return null
          const isActive = pathname.startsWith(config.href)
          return (
            <Link
              key={modulo}
              href={config.href}
              title={collapsed ? config.label : undefined}
              className={cn(
                'sidebar-item relative group',
                collapsed ? 'justify-center px-0 py-3' : '',
                isActive && 'active'
              )}
            >
              <span className={cn('flex-shrink-0', isActive ? 'text-blue-400' : config.color)}>
                {config.icon}
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{config.label}</span>
                  {isActive && <ChevronRight className="w-3 h-3 text-blue-400 opacity-60" />}
                </>
              )}
              {/* Tooltip for collapsed mode */}
              {collapsed && (
                <span className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-white text-xs font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                  {config.label}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Usuario y logout */}
      <div className={cn('py-4 border-t border-white/[0.06] space-y-1', collapsed ? 'px-2' : 'px-2')}>
        {!collapsed && (
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-white truncate">{userName}</p>
              <p className="text-[10px] text-slate-500 truncate">{ROLES_LABELS[userRol]}</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="flex justify-center py-2 mb-1">
            <div
              title={userName}
              className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white cursor-default"
            >
              {userName.charAt(0).toUpperCase()}
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Cerrar sesión' : undefined}
          className={cn('sidebar-item w-full text-red-400 hover:bg-red-500/10 hover:text-red-300', collapsed && 'justify-center px-0 py-3')}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>Cerrar sesión</span>}
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* ── MOBILE TOPBAR (visible only on mobile) ────────────────────────────── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 border-b border-white/[0.06]"
        style={{ background: 'hsl(220, 20%, 7%)' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600">
            <Shirt className="w-4 h-4 text-white" />
          </div>
          <p className="font-bold text-white text-base leading-none">DUREY</p>
        </div>
        <div className="flex items-center gap-2">
          <StockNotification userRol={userRol} />
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-xl hover:bg-white/10 text-slate-300 transition-colors"
            aria-label="Abrir menú"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── MOBILE DRAWER OVERLAY ──────────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── MOBILE DRAWER ─────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          'lg:hidden fixed top-0 left-0 bottom-0 z-50 flex flex-col w-72 transition-transform duration-300 ease-in-out border-r border-white/[0.06]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ background: 'hsl(220, 20%, 7%)' }}
      >
        {/* Close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 p-2 rounded-xl hover:bg-white/10 text-slate-400 transition-colors"
          aria-label="Cerrar menú"
        >
          <X className="w-5 h-5" />
        </button>
        {sidebarContent(false)}
      </aside>

      {/* ── TABLET SIDEBAR (collapsed, icon-only, 64px) ───────────────────────── */}
      <aside
        className="hidden md:flex lg:hidden flex-col w-16 h-screen fixed left-0 top-0 z-30 border-r border-white/[0.06]"
        style={{ background: 'hsl(220, 20%, 7%)' }}
      >
        {sidebarContent(true)}
      </aside>

      {/* ── DESKTOP SIDEBAR (full, 240px) ─────────────────────────────────────── */}
      <aside
        className="hidden lg:flex flex-col w-60 h-screen fixed left-0 top-0 z-30 border-r border-white/[0.06]"
        style={{ background: 'hsl(220, 20%, 7%)' }}
      >
        {sidebarContent(false)}
      </aside>
    </>
  )
}
