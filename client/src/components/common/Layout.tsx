import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, LogOut, Upload, Zap } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

export function Logo() {
  return (
    <Link to="/" className="group flex items-center gap-2" aria-label="ResumeCraft home">
      <span className="relative inline-flex h-10 w-10 items-center justify-center">
        <span className="burst absolute inset-0 bg-black" />
        <span className="burst absolute inset-[3px] bg-gold transition-transform group-hover:rotate-12" />
        <Zap className="relative h-5 w-5 fill-hero text-black" />
      </span>
      <span className="title-action text-2xl">
        Resume<span className="text-gradient-hero">Craft</span>
      </span>
    </Link>
  )
}

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 font-label text-base font-semibold transition-colors ${
      isActive ? 'bg-gold text-black' : 'text-slate-300 hover:text-white'
    }`

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b-[3px] border-black bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
          <Logo />
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
            <NavLink to="/dashboard" className={navCls}>
              <LayoutDashboard className="h-4 w-4" /> <span className="hidden sm:inline">Dashboard</span>
            </NavLink>
            <NavLink to="/import" className={navCls}>
              <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Upload</span>
            </NavLink>
            <span className="mx-1 hidden h-6 w-px bg-line md:block" />
            <span className="hidden max-w-40 truncate text-sm text-muted md:block" title={user?.email}>
              {user?.name}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await logout()
                navigate('/login')
              }}
            >
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Logout</span>
            </button>
          </nav>
        </div>
        <div className="h-1 bg-gradient-to-r from-hero via-gold to-bolt" />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}
