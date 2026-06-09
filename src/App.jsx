import { useState, useEffect, createContext, useContext } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { DEFAULT_SETTINGS } from './lib/finance'
import Header from './components/Header'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Analyser from './pages/Analyser'
import BienDetail from './pages/BienDetail'
import Comparables from './pages/Comparables'
import Settings from './pages/Settings'

export const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) return
    supabase.from('user_settings').select('settings').eq('user_id', user.id).single()
      .then(({ data }) => { if (data?.settings) setSettings(s => ({ ...s, ...data.settings })) })
  }, [user])

  const saveSettings = async (newSettings) => {
    setSettings(newSettings)
    await supabase.from('user_settings').upsert({ user_id: user.id, settings: newSettings })
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, color: '#6b7280' }}>
      <span className="spinner" /> Chargement…
    </div>
  )

  if (!user) return <Login onLogin={setUser} />

  return (
    <AppContext.Provider value={{ user, settings, saveSettings }}>
      <Header user={user} />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/analyser" element={<Analyser />} />
          <Route path="/bien/:id" element={<BienDetail />} />
          <Route path="/comparables" element={<Comparables />} />
          <Route path="/parametres" element={<Settings />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </AppContext.Provider>
  )
}
