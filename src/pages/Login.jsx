import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('login') // login | signup

  const handle = async e => {
    e.preventDefault()
    setLoading(true); setError('')
    const fn = mode === 'login'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password })
    const { data, error } = await fn
    setLoading(false)
    if (error) setError(error.message)
    else if (data.user) onLogin(data.user)
    else setError('Vérifiez votre email pour confirmer votre compte.')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
      <div className="card" style={{ width: 380, padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#1e40af', color: 'white', fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>VA</div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Value-Add Paris</h1>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>Outil d'analyse immobilière value-add</p>
        </div>
        {error && <div className="alert alert-info" style={{ marginBottom: 16 }}>{error}</div>}
        <form onSubmit={handle}>
          <div className="form-group">
            <label className="label">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vous@exemple.com" required />
          </div>
          <div className="form-group">
            <label className="label">Mot de passe</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%', padding: '10px', marginTop: 4 }} disabled={loading}>
            {loading ? <><span className="spinner" style={{ marginRight: 8 }} />{mode === 'login' ? 'Connexion…' : 'Création…'}</> : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#6b7280' }}>
          {mode === 'login' ? 'Pas encore de compte ?' : 'Déjà un compte ?'}
          {' '}<button onClick={() => setMode(m => m === 'login' ? 'signup' : 'login')} style={{ background: 'none', border: 'none', color: '#1e40af', cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>
            {mode === 'login' ? 'Créer un compte' : 'Se connecter'}
          </button>
        </p>
      </div>
    </div>
  )
}
