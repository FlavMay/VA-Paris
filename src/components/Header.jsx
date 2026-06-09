import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const NAV = [
  { to: '/dashboard',    label: '🏠 Biens'         },
  { to: '/analyser',     label: '+ Analyser'        },
  { to: '/comparables',  label: '📊 Comparables'   },
  { to: '/parametres',   label: '⚙ Paramètres'     },
]

export default function Header({ user }) {
  const loc = useLocation()
  const nav = useNavigate()
  const logout = async () => { await supabase.auth.signOut(); nav('/') }

  return (
    <header style={{ background: 'white', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 100 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', marginRight: 16 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: '#1e40af', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>VA</div>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Value-Add Paris</span>
        </div>
        <nav style={{ display: 'flex', flex: 1 }}>
          {NAV.map(({ to, label }) => (
            <Link key={to} to={to} style={{
              padding: '12px 14px', fontSize: 13, fontWeight: 500,
              color: loc.pathname === to ? '#1e40af' : '#6b7280',
              borderBottom: loc.pathname === to ? '2px solid #1e40af' : '2px solid transparent',
              display: 'block', whiteSpace: 'nowrap'
            }}>{label}</Link>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{user?.email}</span>
          <button onClick={logout} className="btn-ghost btn-sm">Déconnexion</button>
        </div>
      </div>
    </header>
  )
}
