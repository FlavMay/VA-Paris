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
  const [editLoyer, setEditLoyer] = useState(false)
  const [loyerVal, setLoyerVal] = useState('')
  const [estimating, setEstimating] = useState(false)

  useEffect(() => {
    supabase.from('properties').select('*').eq('id', id).single()
      .then(({ data }) => {
        setBien(data)
        setLoyerVal(data?.loyer_mensuel || '')
        setLoading(false)
      })
  }, [id])

  const deleteBien = async () => {
    if (!confirm('Supprimer ce bien ?')) return
    await supabase.from('properties').delete().eq('id', id)
    nav('/dashboard')
  }

  const saveLoyer = async () => {
    const val = parseFloat(loyerVal) || null
    await supabase.from('properties').update({ loyer_mensuel: val }).eq('id', id)
    setBien(b => ({ ...b, loyer_mensuel: val }))
    setEditLoyer(false)
  }

  async function estimateLoyer() {
    if (!bien) return
    setEstimating(true)
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `Estime le loyer mensuel nu (hors charges) pour cet appartement parisien.

Bien: ${bien.surface || '?'}m2, ${bien.pieces || '?'} pieces, ${bien.arrondissement || bien.code_postal || 'Paris'} arr., etat: ${ETAT_LABELS[bien.etat] || bien.etat || 'inconnu'}
Adresse: ${bien.adresse || bien.rue || 'Paris'}

Reponds UNIQUEMENT avec un JSON: {"loyer": 1800, "fourchette": "1700-1900", "explication": "1 phrase"}`
          }]
        })
      })
      const data = await resp.json()
      const txt = data.content?.find(c => c.type === 'text')?.text || '{}'
      const p = JSON.parse(txt.replace(/```[a-z]*|```/g, '').trim())
      if (p.loyer) {
        setLoyerVal(p.loyer)
        setEditLoyer(true)
        alert(`Estimation: ${p.loyer} EUR/mois (fourchette ${p.fourchette})\n${p.explication}`)
      }
    } catch (e) {
      alert('Erreur estimation loyer')
    }
    setEstimating(false)
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
  const loyer = bien.loyer_mensuel

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button className="btn-ghost btn-sm" onClick={() => nav('/dashboard')}>← Retour</button>
        <h1 style={{ flex: 1, fontSize: 18, fontWeight: 700 }}>{bien.titre || 'Annonce'}</h1>
        <div style={{ width: 38, height: 38, borderRadius: 9, background: scB(sc), color: scC(sc), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>{sc}</div>
        <button className="btn-danger btn-sm" onClick={deleteBien}>Supprimer</button>
      </div>

      {/* Loyer manquant — bandeau */}
      {!loyer && (
        <div className="card" style={{ padding: 16, marginBottom: 14, background: '#fffbeb', border: '1px solid #fcd34d' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#b45309', marginBottom: 10 }}>
            Loyer mensuel non renseigne — les metriques financieres ne peuvent pas etre calculees.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="number"
              value={loyerVal}
              onChange={e => setLoyerVal(e.target.value)}
              placeholder="Ex: 1800"
              style={{ width: 140, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
            />
            <button className="btn-primary btn-sm" onClick={saveLoyer} disabled={!loyerVal}>
              Enregistrer le loyer
            </button>
            <button className="btn-ghost btn-sm" onClick={estimateLoyer} disabled={estimating}>
              {estimating ? 'Estimation...' : 'Estimer avec l IA'}
            </button>
          </div>
        </div>
      )}

      {/* Loyer present — affichage avec bouton modifier */}
      {loyer && (
        <div className="card" style={{ padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            Loyer mensuel cible : <strong style={{ color: '#111827' }}>{loyer.toLocaleString('fr-FR')} EUR/mois</strong>
          </span>
          {editLoyer ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="number" value={loyerVal} onChange={e => setLoyerVal(e.target.value)}
                style={{ width: 120, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
              <button className="btn-primary btn-sm" onClick={saveLoyer}>OK</button>
              <button className="btn-ghost btn-sm" onClick={() => setEditLoyer(false)}>Annuler</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost btn-sm" onClick={() => setEditLoyer(true)}>Modifier</button>
              <button className="btn-ghost btn-sm" onClick={estimateLoyer} disabled={estimating}>
                {estimating ? '...' : 'Re-estimer IA'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* LIRR bar */}
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>LIRR levérisé · {settings.horizon} ans · {settings.creditPct}% crédit @ {settings.tauxCredit}%</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 26, color: loyer ? barC : '#9ca3af' }}>{fmt.pct(m?.lirr)}</span>
        </div>
        <div style={{ height: 10, background: '#e5e7eb', borderRadius: 5, overflow: 'hidden', marginBottom: 4 }}>
          <div style={{ width: pct + '%', height: '100%', background: barC, borderRadius: 5, transition: 'width .5s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af' }}>
          <span>0%</span><span style={{ color: '#b45309' }}>{settings.lirrCible}% cible</span><span>20%+</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
          {[
            ['Rendement brut', fmt.pct(m?.rendementBrut)],
            ['Rendement net', fmt.pct(m?.rendementNet)],
            ['Cash-on-cash', fmt.signPct(m?.cashOnCash), m?.cashOnCash > 0 ? '#15803d' : '#b91c1c']
          ].map(([l, v, c]) => (
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
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Analyse DVF · {cs.n} comparables</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14 }}>
            {[
              [fmt.pm2(cs.q1), 'Q1', '#6b7280'],
              [fmt.pm2(cs.median), 'Mediane', '#b45309'],
              [fmt.pm2(cs.q3), 'Q3', '#15803d'],
              [fmt.pm2(cs.avg), 'Moyenne', '#6b7280'],
              [pm2A ? fmt.pm2(pm2A) : '-', 'Ce bien', pm2A < cs.median ? '#1e40af' : '#b91c1c']
            ].map(([v, l, c]) => (
              <div key={l} style={{ background: '#f9fafb', borderRadius: 7, padding: '9px 10px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: c }}>{v}</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>

          {hist.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Distribution prix/m2</p>
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

          {/* Carte des comparables */}
          {cs.comps && cs.comps.length > 0 && (
            <details style={{ marginBottom: 14 }}>
              <summary style={{ fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: '6px 0', color: '#374151' }}>
                Voir les {cs.comps.length} comparables utilises
              </summary>
              <div style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                    <tr>
                      {['Date', 'Rue', 'Surf.', 'Prix/m2', 'Prix total'].map(h => (
                        <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cs.comps.map((c, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f9fafb' }}>
                        <td style={{ padding: '6px 10px', color: '#6b7280' }}>{c.date_mutation}</td>
                        <td style={{ padding: '6px 10px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.numero ? c.numero + ' ' : ''}{c.rue}</td>
                        <td style={{ padding: '6px 10px' }}>{c.surface}m2</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{fmt.pm2(c.prix_m2)}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{fmt.euro(c.prix)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div style={{ background: '#eff6ff', borderRadius: 7, padding: '11px 14px', border: '1px solid #bfdbfe' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#1e40af', marginBottom: 8 }}>Synthese Value-Add</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                ['Decote vs mediane', disc != null ? (disc > 0 ? `-${disc}% sous-cote` : `+${Math.abs(disc)}% sur-cote`) : '-'],
                ['ARV median', fmt.euro(cs.median * bien.surface)],
                ['ARV Q3 (optimiste)', fmt.euro(arvQ3)],
                ['Cout total revient', fmt.euro(m?.totalInvesti)],
                ['Spread (ARV Q3 - cout)', spread != null ? (spread > 0 ? '+' : '') + fmt.euro(spread) : '-'],
                ['Return on cost (Q3)', fmt.signPct(roc)]
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: '#1e40af', opacity: .7, marginBottom: 1 }}>{k}</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: '#111827' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!cs && <div className="alert alert-warn" style={{ marginBottom: 14 }}>Aucune analyse DVF pour ce bien.</div>}

      {/* Finance blocks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {[
          ['ACQUISITION', [
            ['Prix FAI', fmt.euro(bien.prix)],
            ['Frais notaire (8%)', fmt.euro(m?.fraisNotaire)],
            ['Travaux', fmt.euro(m?.travaux)],
            ['Total investi', fmt.euro(m?.totalInvesti), m?.totalInvesti <= settings.budgetMax ? '#15803d' : '#b91c1c']
          ]],
          ['FINANCEMENT', [
            ['Apport ' + settings.creditPct + '%', fmt.euro(m?.apport)],
            ['Credit', fmt.euro(m?.credit)],
            ['Mensualite', fmt.euro(m?.mensualite, 0) + '/mois'],
            ['Taux & duree', settings.tauxCredit + '% · ' + settings.dureeCredit + ' ans']
          ]],
          ['CASH FLOWS ANNUELS', [
            ['Loyer brut', fmt.euro(loyer ? loyer * 12 : null)],
            ['Vacance + charges', loyer ? '-' + fmt.euro((loyer * settings.vacanceMois) + (m?.charges || 0), 0) : '-'],
            ['Service dette', m ? '-' + fmt.euro(m.mensualite * 12, 0) : '-'],
            ['CF net/an', fmt.euro(m?.cashflowAnnuel, 0), m?.cashflowAnnuel >= 0 ? '#15803d' : '#b91c1c']
          ]],
          ['SORTIE ' + settings.horizon + ' ANS', [
            ['Prix revente estime', fmt.euro(m?.revente)],
            ['Capital restant', m ? '-' + fmt.euro(m.capitalRestant, 0) : '-'],
            ['Frais vente ' + settings.fraisVente + '%', m ? '-' + fmt.euro(m.revente * settings.fraisVente / 100, 0) : '-'],
            ['Produit net revente', fmt.euro(m?.produitNetRevente), '#15803d']
          ]]
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

      {bien.url && (
        <div style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>
          <a href={bien.url} target="_blank" rel="noopener" style={{ color: '#6b7280' }}>{bien.url}</a>
        </div>
      )}
      {bien.notes && (
        <div style={{ padding: '10px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 13, color: '#374151', marginBottom: 12 }}>
          {bien.notes}
        </div>
      )}
    </div>
  )
}
