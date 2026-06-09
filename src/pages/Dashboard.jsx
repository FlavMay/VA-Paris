import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../App'
import { calcMetrics, calcScore, fmt, ETAT_LABELS } from '../lib/finance'

const scC = s => s >= 8 ? '#15803d' : s >= 6 ? '#b45309' : s >= 4 ? '#c2410c' : '#b91c1c'
const scB = s => s >= 8 ? '#f0fdf4' : s >= 6 ? '#fffbeb' : s >= 4 ? '#fff7ed' : '#fef2f2'

export default function Dashboard() {
  const { settings } = useApp()
  const nav = useNavigate()
  const [biens, setBiens] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('date')

  useEffect(() => {
    supabase.from('properties').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setBiens(data || []); setLoading(false) })
  }, [])

  const sorted = [...biens].sort((a, b) => {
    if (sortBy === 'score') {
      const mA = calcMetrics(a, settings), mB = calcMetrics(b, settings)
      return calcScore(b, mB, settings) - calcScore(a, mA, settings)
    }
    if (sortBy === 'lirr') {
      const mA = calcMetrics(a, settings), mB = calcMetrics(b, settings)
      return (mB?.lirr || 0) - (mA?.lirr || 0)
    }
    return new Date(b.created_at) - new Date(a.created_at)
  })

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}><span className="spinner" /></div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Mes biens analysés</h1>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }}>{biens.length} bien{biens.length > 1 ? 's' : ''} · LIRR cible {settings.lirrCible}% · Budget {fmt.euro(settings.budgetMax)}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: 'auto', padding: '6px 10px' }}>
            <option value="date">Trier : Date</option>
            <option value="score">Trier : Score</option>
            <option value="lirr">Trier : LIRR</option>
          </select>
          <button className="btn-primary" onClick={() => nav('/analyser')}>+ Analyser</button>
        </div>
      </div>

      {!biens.length && (
        <div style={{ textAlign: 'center', padding: '60px 24px', background: 'white', borderRadius: 12, border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏠</div>
          <h2 style={{ fontWeight: 600, marginBottom: 8 }}>Aucun bien analysé</h2>
          <p style={{ color: '#6b7280', marginBottom: 20, fontSize: 14 }}>Importez d'abord les comparables DVF, puis analysez votre première annonce.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn-ghost" onClick={() => nav('/comparables')}>📊 Importer DVF</button>
            <button className="btn-primary" onClick={() => nav('/analyser')}>+ Analyser une annonce</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {sorted.map(bien => <BienCard key={bien.id} bien={bien} settings={settings} onClick={() => nav('/bien/' + bien.id)} />)}
      </div>
    </div>
  )
}

function BienCard({ bien, settings, onClick }) {
  const m = calcMetrics(bien, settings)
  const s = calcScore(bien, m, settings)
  const cs = bien.comp_stats
  const pm2A = bien.pm2_ask
  const disc = cs && pm2A ? Math.round((1 - pm2A / cs.median) * 100) : null
  const match = m?.lirr >= settings.lirrCible && m?.totalInvesti <= settings.budgetMax

  return (
    <div className="card" onClick={onClick} style={{ padding: 16, cursor: 'pointer', transition: 'transform .1s, box-shadow .1s' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.12)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 9, background: scB(s), color: scC(s), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>{s}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bien.titre || 'Annonce'}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{bien.arrondissement || '—'} · {bien.surface || '?'}m² · {ETAT_LABELS[bien.etat] || '—'}</div>
          <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <span className={'pill ' + (match ? 'pill-green' : 'pill-amber')}>{match ? '✓ Match LIRR' : '≈ Partiel'}</span>
            {cs && disc != null && <span className={'pill ' + (disc > 5 ? 'pill-blue' : disc > 0 ? 'pill-amber' : 'pill-red')}>{disc > 0 ? `−${disc}% vs marché` : `+${Math.abs(disc)}% vs marché`}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 20, fontFamily: 'monospace', color: m?.lirr >= settings.lirrCible ? '#15803d' : m?.lirr ? '#b45309' : '#b91c1c', lineHeight: 1 }}>{fmt.pct(m?.lirr)}</div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>LIRR</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
        {[[fmt.euro(bien.prix), 'Prix FAI'], [m?.cashflowAnnuel ? fmt.euro(m.cashflowAnnuel / 12, 0) + '/mo' : '—', 'CF net'], [fmt.pct(m?.rendementBrut), 'Rend. brut']].map(([v, l]) => (
          <div key={l} style={{ background: '#f9fafb', borderRadius: 6, padding: '7px 9px' }}>
            <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 500 }}>{v}</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 8, textAlign: 'right' }}>{new Date(bien.created_at).toLocaleDateString('fr-FR')}</div>
    </div>
  )
}
