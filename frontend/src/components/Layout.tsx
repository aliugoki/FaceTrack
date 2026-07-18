import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { RoleChip } from './ui'
import { api } from '../lib/api'
import ChangePassword from './ChangePassword'

const NAV = [
  { to: '/', label: 'Overview', icon: '▦', end: true },
  { to: '/board', label: 'Live Attendance', icon: '◉' },
  { to: '/live', label: 'Live Wall', icon: '▶' },
  { to: '/attendance', label: 'Attendance', icon: '≣' },
  { to: '/employees', label: 'Employees', icon: '☻' },
  { to: '/cameras', label: 'Cameras', icon: '▣' },
  { to: '/recordings', label: 'Recordings', icon: '⏺', perm: 'manage_cameras' },
  { to: '/nvr', label: 'NVR Footage', icon: '⧉', perm: 'manage_tenants' },
  { to: '/pipeline', label: 'Pipeline', icon: '⛓', perm: 'manage_tenants' },
  { to: '/reports', label: 'Reports', icon: '▤' },
  { to: '/erp', label: 'ERP Sync', icon: '⇄' },
  { to: '/users', label: 'Users', icon: '⚷', perm: 'manage_users' },
  { to: '/settings', label: 'Settings', icon: '⚙', perm: 'manage_settings' },
  { to: '/audit', label: 'Audit Log', icon: '⎙', perm: 'view_audit' },
  { to: '/companies', label: 'Companies', icon: '🏢', perm: 'manage_tenants' },
  { to: '/tenants', label: 'Tenants', icon: '⬢', perm: 'view_tenants' },
]

export default function Layout() {
  const { me, logout, can } = useAuth()
  const { theme, setTheme, THEMES } = useTheme()
  const nav = useNavigate()
  const [clock, setClock] = useState('')
  const [health, setHealth] = useState<any>(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem('ft_sidebar') === '1')
  const toggleSidebar = () => setCollapsed((v) => { const n = !v; localStorage.setItem('ft_sidebar', n ? '1' : '0'); return n })

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString([], { hour12: false })), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const load = () => api('/api/pipeline-health').then(setHealth).catch(() => setHealth(null))
    load(); const t = setInterval(load, 15000); return () => clearInterval(t)
  }, [])

  const onLogout = async () => { await logout(); nav('/login') }
  const hOk = health?.available && health?.healthy

  return (
    <div className="flex min-h-screen">
      <aside className={`${collapsed ? 'w-[68px]' : 'w-60'} bg-surface border-r border-line flex flex-col p-3.5 sticky top-0 h-screen transition-[width] duration-200`}>
        <div className={`flex items-center pb-5 pt-1 ${collapsed ? 'flex-col gap-2' : 'gap-3 px-2'}`}>
          <div className="w-10 h-10 rounded-xl grid place-items-center text-xl text-white shrink-0"
            style={{ background: 'linear-gradient(135deg,rgb(var(--brand)),rgb(var(--violet)))' }}>◎</div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="font-bold tracking-wide">FaceTrack</div>
              <div className="text-[11px] text-muted">Command Center</div>
            </div>
          )}
          <button onClick={toggleSidebar} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-7 h-7 grid place-items-center rounded-lg text-muted hover:text-txt hover:bg-surface2 shrink-0">
            {collapsed ? '»' : '«'}
          </button>
        </div>
        <nav className="flex-1 flex flex-col gap-1">
          {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined}
              className={({ isActive }) => `flex items-center py-2.5 rounded-lg font-medium transition ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} ${isActive ? 'bg-brand/15 text-txt shadow-[inset_3px_0_0_rgb(var(--brand))]' : 'text-muted hover:bg-surface2 hover:text-txt'}`}>
              <span className="w-4 text-center opacity-80">{n.icon}</span>{!collapsed && n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line pt-3 flex flex-col gap-3">
          <div className={`flex items-center gap-2 text-xs text-muted ${collapsed ? 'justify-center' : ''}`}
            title={`Pipeline: ${hOk ? 'healthy' : health?.available ? 'degraded' : 'n/a'}`}>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${hOk ? 'bg-ok' : health?.available ? 'bg-bad' : 'bg-line'}`} />
            {!collapsed && <>Pipeline: {hOk ? 'healthy' : health?.available ? 'degraded' : 'n/a'}</>}
          </div>
          <button onClick={onLogout} title="Sign out"
            className={`text-muted text-sm hover:text-bad ${collapsed ? 'text-center' : 'text-left'}`}>⇲{!collapsed && ' Sign out'}</button>
        </div>
      </aside>

      <main className="flex-1 p-6 min-w-0">
        <header className="flex justify-between items-end mb-6">
          <div>
            <h1 className="text-2xl font-bold" id="pageTitle">{me?.company_name}</h1>
            <p className="text-xs text-muted mt-0.5">{me?.company_name} · <RoleChip role={me?.role || 'viewer'} /></p>
          </div>
          <div className="flex items-center gap-4">
            <select value={theme} onChange={(e) => setTheme(e.target.value)} className="input text-xs rounded-full capitalize">
              {THEMES.map((t: string) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="btn text-xs" title="Change password" onClick={() => setPwOpen(true)}>🔑</button>
            <span className="tabular-nums text-muted font-semibold">{clock}</span>
          </div>
        </header>
        <Outlet />
      </main>
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
    </div>
  )
}
