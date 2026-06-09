import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../App'
import { calcMetrics, calcScore, calcCapitalRestant, fmt, ETAT_LABELS } from '../lib/finance'
import { buildHistogram } from '../lib/comps'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const scC = s => s >= 8 ? '#15803d' : s >= 6 ? '#b45309' : s >= 4 ? '#c2410c' : '#b91c1c'
const scB = s => s >= 8 ? '#f0fdf4' : s >= 6 ? '#fffbeb' : s >= 4 ? '#fff7ed' : '#fef2f2'

export default function BienDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { settings } = useApp()
  const [bien, setBien] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('properties').select('*').eq('id', id).single()
      .then(({ data }) => { setBien(data); setLoading(false) })
  }, [id])

  const deleteBien = async () => {
    if (!confirm('Supprimer ce bien ?')) return
    await supabase.from('properties').delete().eq('id', id)
    nav('/dashboard')
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><span className="spinner" /></div>
  if (!bien) return <div>Bien introuvable. <button className="btn-ghost" onClick={() => nav('/dashboard')}>Retour</button></div>

  const m = calcMetrics(bien, settings)
  const sc = m ? calcScore(bien, m, settings) : 0
  const cs = bien.comp_stats
  const pm2A = bien.pm2_ask
  const hist = cs ? buildHistogram(cs.pm2s, pm2A) : []
  const disc = cs && pm2A ? Math.round((1 - pm2A / cs.median) * 100) : null
  const arvQ3 = cs && bien.surface ? cs.q3 * bien.surface : null
  const spread = arvQ3 && m ? arvQ3 - m.totalInvesti : null
  const roc = spread && m ? spread / m.totalInvesti * 100 : null
  const pct = Math.min(100, Math.max(0, (m?.lirr || 0) / 20 * 100))
  const barC = m?.lirr >= settings.lirrCible ? '#15803d' : m?.lirr >= 8 ? '#b45309' : '#b91c1c'

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button className="btn-ghost btn-sm" onClick={() => nav('/dashboard')}>← Retour</button>
        <h1 style={{ flex: 1, fontSize: 18, fontWeight: 700 }}>{bien.titre || 'Annonce'}</h1>
        <div style={{ width: 38, height: 38, borderRadius: 9, background: scB(sc), color: scC(sc), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>{sc}</div>
        <button className="btn-danger btn-sm" onClick={deleteBien}>Supprimer</button>
      </div>

      {/* LIRR bar */}
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>LIRR levérisé · {settings.horizon} ans · {settings.creditPct}% crédit @ {settings.tauxCredit}%</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 26, color: barC }}>{fmt.pct(m?.lirr)}</span>
        </div>
        <div style={{ height: 10, background: '#e5e7eb', borderRadius: 5, overflow: 'hidden', marginBottom: 4 }}>
          <div style={{ width: pct + '%', height: '100%', background: barC, borderRadius: 5, transition: 'width .5s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af' }}>
          <span>0%</span><span style={{ color: '#b45309' }}>{settings.lirrCible}% cible</span><span>20%+</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
          {[['Rendement brut', fmt.pct(m?.rendementBrut)], ['Rendement net', fmt.pct(m?.rendementNet)], ['Cash-on-cash', fmt.signPct(m?.cashOnCash), m?.cashOnCash > 0 ? '#15803d' : '#b91c1c']].map(([l, v, c]) => (
            <div key={l} style={{ background: '#f9fafb', borderRadius: 7, padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{l}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 500, fontSize: 13, color: c || '#111827' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* DVF Analysis */}
      {cs && (
        <div className="card" style={{ padding: 18, marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📊 Analyse DVF · {cs.n} comparables</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14 }}>
            {[[fmt.pm2(cs.q1), 'Q1', '#6b7280'], [fmt.pm2(cs.median), 'Médiane', '#b45309'], [fmt.pm2(cs.q3), 'Q3', '#15803d'], [fmt.pm2(cs.avg), 'Moyenne', '#6b7280'], [pm2A ? fmt.pm2(pm2A) : '—', 'Ce bien', pm2A < cs.median ? '#1e40af' : '#b91c1c']].map(([v, l, c]) => (
              <div key={l} style={{ background: '#f9fafb', borderRadius: 7, padding: '9px 10px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: c }}>{v}</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
          {hist.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Distribution prix/m² · 🔵 marché · 🔴 ce bien</p>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={hist} barSize={20} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={v => [v + ' ventes']} contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="cnt" radius={[2, 2, 0, 0]}>
                    {hist.map((e, i) => <Cell key={i} fill={e.isTarget ? '#ef4444' : '#3b82f6'} fillOpacity={.75} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div style={{ background: '#eff6ff', borderRadius: 7, padding: '11px 14px', border: '1px solid #bfdbfe' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#1e40af', marginBottom: 8 }}>🎯 Synthèse Value-Add</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[['Décote vs médiane', disc != null ? (disc > 0 ? `−${disc}% ✓ sous-coté` : `+${Math.abs(disc)}% ✗ sur-coté`) : '—'],
                ['ARV médian', fmt.euro(cs.median * bien.surface)],
                ['ARV Q3 (optimiste)', fmt.euro(arvQ3)],
                ['Coût total revient', fmt.euro(m?.totalInvesti)],
                ['Spread (ARV Q3 − coût)', spread != null ? (spread > 0 ? '+' : '') + fmt.euro(spread) : '—'],
                ['Return on cost (Q3)', fmt.signPct(roc)]].map(([k, v]) => (
                <div key={k}><div style={{ fontSize: 10, color: '#1e40af', opacity: .7, marginBottom: 1 }}>{k}</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: v.includes('✓') || (v.includes('+') && !v.includes('ARV')) ? '#15803d' : v.includes('✗') ? '#b91c1c' : '#111827' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!cs && <div className="alert alert-warn" style={{ marginBottom: 14 }}>⚠ Aucune analyse DVF pour ce bien — l'analyse a peut-être été effectuée avant l'import des comparables.</div>}

      {/* Finance blocks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {[['Acquisition', [['Prix FAI', fmt.euro(bien.prix)], ['Frais notaire (8%)', fmt.euro(m?.fraisNotaire)], ['Travaux', fmt.euro(m?.travaux)], ['Total investi', fmt.euro(m?.totalInvesti), m?.totalInvesti <= settings.budgetMax ? '#15803d' : '#b91c1c']]],
          ['Financement', [['Apport ' + settings.creditPct + '%', fmt.euro(m?.apport)], ['Crédit', fmt.euro(m?.credit)], ['Mensualité', fmt.euro(m?.mensualite, 0) + '/mois'], ['Taux & durée', settings.tauxCredit + '% · ' + settings.dureeCredit + ' ans']]],
          ['Cash flows annuels', [['Loyer brut', fmt.euro(bien.loyer_mensuel * 12)], ['Vacance + charges', '−' + fmt.euro((bien.loyer_mensuel * settings.vacanceMois) + (m?.charges || 0), 0)], ['Service dette', '−' + fmt.euro(m?.mensualite * 12, 0)], ['CF net/an', fmt.euro(m?.cashflowAnnuel, 0), m?.cashflowAnnuel >= 0 ? '#15803d' : '#b91c1c']]],
          ['Sortie ' + settings.horizon + ' ans', [['Prix revente estimé', fmt.euro(m?.revente)], ['Capital restant', '−' + fmt.euro(m?.capitalRestant, 0)], ['Frais vente ' + settings.fraisVente + '%', '−' + fmt.euro(m?.revente * settings.fraisVente / 100, 0)], ['Produit net revente', fmt.euro(m?.produitNetRevente), '#15803d']]]
        ].map(([title, rows]) => (
          <div className="card" key={title} style={{ padding: '13px 15px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginBottom: 8 }}>{title}</div>
            {rows.map(([k, v, c]) => (
              <div key={k} className="divider-row">
                <span className="dk">{k}</span>
                <span className="dv mono" style={{ color: c || '#111827' }}>{v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {bien.url && <div style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>🔗 <a href={bien.url} target="_blank" rel="noopener" style={{ color: '#6b7280' }}>{bien.url}</a></div>}
      {bien.notes && <div style={{ padding: '10px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 13, color: '#374151', marginBottom: 12 }}>{bien.notes}</div>}
    </div>
  )
}
