export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 relative overflow-hidden">
      {/* Fondo con gradientes decorativos */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-600 rounded-full opacity-[0.06] blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-violet-600 rounded-full opacity-[0.06] blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-900 rounded-full opacity-[0.04] blur-3xl" />
      </div>
      {children}
    </div>
  )
}
