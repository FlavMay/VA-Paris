import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../App'
import { calcMetrics, calcScore, calcCapitalRestant, fmt, ETAT_LABELS, calcLIRR_LMNP, DEFAULT_LMNP } from '../lib/finance'
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
  const [estimating, setEstimating] = useState(false)
  const [saved, setSaved] = useState(false)
  const [selectedComps, setSelectedComps] = useState(null)
  const [lmnp, setLmnp] = useState(DEFAULT_LMNP)
  const updLmnp = patch => setLmnp(prev => ({ ...prev, ...patch }))

  const [hyp, setHyp] = useState({
    loyer_mensuel: null, travaux_manuel: null, prix_fai: null,
    premiumRevente: 0, creditPct: null, tauxCredit: null,
    dureeCredit: null, appreciation: null, vacanceMois: null, chargesPct: null,
    prixReventeAujourdhui: null,
  })
  const updHyp = patch => setHyp(prev => ({ ...prev, ...patch }))

  useEffect(() => {
    supabase.from('properties').select('*').eq('id', id).single()
      .then(({ data }) => {
        setBien(data)
        if (data) {
          setHyp({
            loyer_mensuel: data.loyer_mensuel || null,
            travaux_manuel: data.travaux_manuel || null,
            prix_fai: null, premiumRevente: data.premiumRevente || 0,
            creditPct: null, tauxCredit: null, dureeCredit: null,
            appreciation: null, vacanceMois: null, chargesPct: null,
            prixReventeAujourdhui: null,
          })
          if (data.comp_stats?.comps) {
            setSelectedComps(data.comp_stats.comps.map((_, i) => i))
          }
        }
        setLoading(false)
      })
  }, [id])

  const deleteBien = async () => {
    if (!confirm('Supprimer ce bien ?')) return
    await supabase.from('properties').delete().eq('id', id)
    nav('/dashboard')
  }

  const saveHyp = async () => {
    await supabase.from('properties').update({
      loyer_mensuel: hyp.loyer_mensuel,
      travaux_manuel: hyp.travaux_manuel,
      premiumRevente: hyp.premiumRevente,
    }).eq('id', id)
    setBien(b => ({ ...b, loyer_mensuel: hyp.loyer_mensuel, travaux_manuel: hyp.travaux_manuel, premiumRevente: hyp.premiumRevente }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function estimateLoyer() {
    if (!bien) return
    setEstimating(true)
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 200,
          messages: [{ role: 'user', content: `Estime le loyer mensuel nu (hors charges) pour: ${bien.surface || '?'}m2, ${bien.pieces || '?'} pieces, ${bien.arrondissement || 'Paris'} arr., etat: ${bien.etat || 'bon'}, adresse: ${bien.adresse || bien.rue || 'Paris'}. UNIQUEMENT JSON: {"loyer":1800,"fourchette":"1700-1900","explication":"1 phrase"}` }]
        })
      })
      const data = await resp.json()
      const txt = data.content?.find(c => c.type === 'text')?.text || '{}'
      const p = JSON.parse(txt.replace(/```[a-z]*|```/g, '').trim())
      if (p.loyer) {
        updHyp({ loyer_mensuel: p.loyer })
        alert(`Estimation: ${p.loyer} EUR/mois (${p.fourchette})\n${p.explication}`)
      }
    } catch(e) { alert('Erreur estimation') }
    setEstimating(false)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><span className="spinner" /></div>
  if (!bien) return <div>Bien introuvable. <button className="btn-ghost" onClick={() => nav('/dashboard')}>Retour</button></div>

  const effSettings = {
    ...settings,
    ...(hyp.creditPct    != null ? { creditPct: hyp.creditPct }       : {}),
    ...(hyp.tauxCredit   != null ? { tauxCredit: hyp.tauxCredit }     : {}),
    ...(hyp.dureeCredit  != null ? { dureeCredit: hyp.dureeCredit }   : {}),
    ...(hyp.appreciation != null ? { appreciation: hyp.appreciation } : {}),
    ...(hyp.vacanceMois  != null ? { vacanceMois: hyp.vacanceMois }   : {}),
    ...(hyp.chargesPct   != null ? { chargesPct: hyp.chargesPct }     : {}),
  }

  const prixEff = hyp.prix_fai || bien.prix
  const allComps = bien.comp_stats?.comps || []
  const activeCompIndices = selectedComps || allComps.map((_, i) => i)
  const activeComps = allComps.filter((_, i) => activeCompIndices.includes(i))

  const pm2sActive = activeComps.map(c => c.prix_m2).filter(Boolean).sort((a, b) => a - b)
  const activeStats = pm2sActive.length ? (() => {
    const n = pm2sActive.length
    const q = r => pm2sActive[Math.min(n - 1, Math.floor(n * r))]
    return { n, q1: q(0.25), median: q(0.50), q3: q(0.75), avg: Math.round(pm2sActive.reduce((a, b) => a + b, 0) / n), pm2s: pm2sActive }
  })() : bien.comp_stats

  const cs = activeStats || bien.comp_stats
  const pm2A = prixEff && bien.surface ? Math.round(prixEff / bien.surface) : bien.pm2_ask

  const prixRevEstAujourdhui = hyp.prixReventeAujourdhui
    || (cs?.q3 && bien.surface ? cs.q3 * bien.surface * (1 + (hyp.premiumRevente || 0) / 100) : null)
    || prixEff

  const revente = prixRevEstAujourdhui * (1 + effSettings.appreciation / 100) ** effSettings.horizon

  const bienEff = {
    ...bien,
    prix: prixEff,
    loyer_mensuel: hyp.loyer_mensuel,
    loyerMensuel: hyp.loyer_mensuel,
    travaux_manuel: hyp.travaux_manuel,
    travauxManuel: hyp.travaux_manuel,
    premiumRevente: hyp.premiumRevente || 0,
    comp_stats: cs,
    _reventeOverride: revente,
  }

  const m = calcMetrics(bienEff, effSettings)
  const sc = m ? calcScore(bienEff, m, effSettings) : 0
  const hist = cs ? buildHistogram(cs.pm2s, pm2A) : []
  const disc = cs && pm2A ? Math.round((1 - pm2A / cs.median) * 100) : null
  const arvQ3 = cs && bien.surface ? cs.q3 * bien.surface : null
  const spread = arvQ3 && m ? arvQ3 - m.totalInvesti : null
  const roc = spread && m ? spread / m.totalInvesti * 100 : null
  const pct = Math.min(100, Math.max(0, (m?.lirr || 0) / 20 * 100))
  const barC = m?.lirr >= effSettings.lirrCible ? '#15803d' : m?.lirr >= 8 ? '#b45309' : '#b91c1c'
  const loyer = hyp.loyer_mensuel

  // LMNP utilise sa propre duree de detention (lmnp.horizon)
  const reventeForLmnp = prixRevEstAujourdhui * (1 + effSettings.appreciation / 100) ** lmnp.horizon
  const bienEffLmnp = { ...bienEff, _reventeOverride: reventeForLmnp }
  const lmnpResult = calcLIRR_LMNP(
  { ...bienEff, _reventeOverride: null },
  effSettings,
  lmnp,
  prixRevEstAujourdhui
)

  const inp = (label, val, onChange, opts = {}) => (
    <div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>{label}</div>
      <input type="number" value={val ?? ''} onChange={e => onChange(+e.target.value || null)}
        step={opts.step || 1} placeholder={opts.placeholder || ''}
        style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
    </div>
  )

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button className="btn-ghost btn-sm" onClick={() => nav('/dashboard')}>Retour</button>
        <h1 style={{ flex: 1, fontSize: 18, fontWeight: 700 }}>{bien.titre || 'Annonce'}</h1>
        <div style={{ width: 38, height: 38, borderRadius: 9, background: scB(sc), color: scC(sc), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>{sc}</div>
        <button className="btn-danger btn-sm" onClick={deleteBien}>Supprimer</button>
      </div>

      {/* LIRR brut */}
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>LIRR brut · {effSettings.horizon} ans · LTV {effSettings.creditPct}% @ {effSettings.tauxCredit}%</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 26, color: loyer ? barC : '#9ca3af' }}>{fmt.pct(m?.lirr)}</span>
        </div>
        <div style={{ height: 10, background: '#e5e7eb', borderRadius: 5, overflow: 'hidden', marginBottom: 4 }}>
          <div style={{ width: pct + '%', height: '100%', background: barC, borderRadius: 5, transition: 'width .5s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af' }}>
          <span>0%</span><span style={{ color: '#b45309' }}>{effSettings.lirrCible}% cible</span><span>20%+</span>
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

      {/* Hypotheses */}
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Hypotheses — recalcul en temps reel</h2>
          <button className="btn-primary btn-sm" onClick={saveHyp}>{saved ? 'Sauvegarde !' : 'Sauvegarder'}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Loyer mensuel (EUR)</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input type="number" value={loyer || ''} onChange={e => updHyp({ loyer_mensuel: +e.target.value || null })}
                placeholder="Ex: 1800" style={{ flex: 1, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
              <button className="btn-ghost btn-sm" onClick={estimateLoyer} disabled={estimating} style={{ fontSize: 11 }}>
                {estimating ? '...' : 'IA'}
              </button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>
              Prix FAI (EUR){prixEff && bien.surface ? ' · ' + Math.round(prixEff / bien.surface).toLocaleString('fr-FR') + ' EUR/m2' : ''}
            </div>
            <input type="number" value={hyp.prix_fai || bien.prix || ''} onChange={e => updHyp({ prix_fai: +e.target.value || null })}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </div>
          {inp('Travaux (EUR) — vide = auto', hyp.travaux_manuel, v => updHyp({ travaux_manuel: v }), { placeholder: 'Calcul auto' })}
          {inp('LTV (%)', hyp.creditPct ?? effSettings.creditPct, v => updHyp({ creditPct: v }))}
          {inp('Taux credit (%)', hyp.tauxCredit ?? effSettings.tauxCredit, v => updHyp({ tauxCredit: v }), { step: 0.1 })}
          {inp('Duree credit (ans)', hyp.dureeCredit ?? effSettings.dureeCredit, v => updHyp({ dureeCredit: v }))}
          {inp('Vacance locative (mois/an)', hyp.vacanceMois ?? effSettings.vacanceMois, v => updHyp({ vacanceMois: v }), { step: 0.5 })}
          {inp('Charges (% des loyers)', hyp.chargesPct ?? effSettings.chargesPct, v => updHyp({ chargesPct: v }))}
          {inp('Appreciation annuelle (%)', hyp.appreciation ?? effSettings.appreciation, v => updHyp({ appreciation: v }), { step: 0.1 })}
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Premium revente (%) — etage, vis-a-vis...</div>
            <input type="number" step="0.5" value={hyp.premiumRevente || 0} onChange={e => updHyp({ premiumRevente: +e.target.value || 0 })}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>
              Prix revente aujourd hui (EUR){hyp.prixReventeAujourdhui && bien.surface ? ' · ' + Math.round(hyp.prixReventeAujourdhui / bien.surface).toLocaleString('fr-FR') + ' EUR/m2' : ''}
            </div>
            <input type="number" value={hyp.prixReventeAujourdhui || ''}
              onChange={e => updHyp({ prixReventeAujourdhui: +e.target.value || null })}
              placeholder={prixRevEstAujourdhui ? Math.round(prixRevEstAujourdhui).toLocaleString('fr-FR') + ' (auto)' : 'Auto'}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
              Dans {effSettings.horizon} ans : {fmt.euro(revente)}{bien.surface ? ' · ' + Math.round(revente / bien.surface).toLocaleString('fr-FR') + ' EUR/m2' : ''}
            </div>
          </div>
        </div>
        <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
          Prix revente aujourd hui = valeur marche actuelle. L appreciation annuelle s applique ensuite sur cette base.
        </p>
      </div>

      {/* LMNP */}
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#374151', flex: 1 }}>
            LMNP Reel simplifie — LIRR net d impots
          </h2>
          <div style={{ background: lmnpResult?.lirrNet != null ? (lmnpResult.lirrNet >= effSettings.lirrCible ? '#f0fdf4' : '#fef2f2') : '#f9fafb', borderRadius: 8, padding: '6px 16px', textAlign: 'center', minWidth: 90 }}>
            <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 20, color: lmnpResult?.lirrNet != null ? (lmnpResult.lirrNet >= effSettings.lirrCible ? '#15803d' : '#b91c1c') : '#9ca3af' }}>
              {fmt.pct(lmnpResult?.lirrNet)}
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>LIRR net</div>
          </div>
          <div style={{ background: '#f9fafb', borderRadius: 8, padding: '6px 16px', textAlign: 'center', minWidth: 90 }}>
            <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 15, color: '#6b7280' }}>{fmt.pct(m?.lirr)}</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>LIRR brut</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>TMI (%)</div>
            <select value={lmnp.tmi} onChange={e => updLmnp({ tmi: +e.target.value })}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
              {[0, 11, 30, 41, 45].map(t => <option key={t} value={t}>{t}%</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Duree detention (ans)</div>
            <input type="number" value={lmnp.horizon} min={1} max={30}
              onChange={e => updLmnp({ horizon: +e.target.value || 10 })}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Mobilier (EUR)</div>
            <input type="number" value={lmnp.mobilier}
              onChange={e => updLmnp({ mobilier: +e.target.value || 0 })}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Taxe fonciere (EUR/an)</div>
            <input type="number" value={lmnp.taxeFonciere}
              onChange={e => updLmnp({ taxeFonciere: +e.target.value || 0 })}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Amort. bien (ans)</div>
            <input type="number" value={lmnp.dureeAmortBien}
              onChange={e => updLmnp({ dureeAmortBien: +e.target.value || 30 })}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Amort. travaux (ans)</div>
            <input type="number" value={lmnp.dureeAmortTrav}
              onChange={e => updLmnp({ dureeAmortTrav: +e.target.value || 10 })}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Frais gestion (%)</div>
            <input type="number" value={lmnp.fraisGestion}
              onChange={e => updLmnp({ fraisGestion: +e.target.value || 8 })}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Assurance (EUR/an)</div>
            <input type="number" value={lmnp.assurance}
              onChange={e => updLmnp({ assurance: +e.target.value || 0 })}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
          </div>
        </div>

        {lmnpResult && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
              {[
                ['Impots cumules', fmt.euro(lmnpResult.impotTotal), '#b91c1c'],
                ['Plus-value brute', fmt.euro(lmnpResult.pv.pvBrute), '#111827'],
                ['Impot PV', fmt.euro(lmnpResult.pv.impotPV), '#b91c1c'],
                ['Produit net revente', fmt.euro(lmnpResult.produitNet), '#15803d'],
              ].map(([l, v, c]) => (
                <div key={l} style={{ background: '#f9fafb', borderRadius: 7, padding: '9px 10px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: c }}>{v}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{ background: '#f0fdf4', borderRadius: 7, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#15803d' }}>
              Abattement IR : {lmnpResult.pv.abatIR}% · Abattement PS : {Math.round(lmnpResult.pv.abatPS || 0)}% apres {lmnp.horizon} ans de detention · Prix de revente dans {lmnp.horizon} ans : {fmt.euro(lmnpResult.prixVente)}
            </div>
            <details>
              <summary style={{ fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: '6px 0', color: '#374151' }}>
                Detail annuel LMNP ({lmnp.horizon} ans)
              </summary>
              <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                    <tr>
                      {['An', 'Loyers', 'Charges', 'Amort.', 'Res. BIC', 'Report', 'Impot', 'CF net', 'Impot cum.'].map(h => (
                        <th key={h} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500, color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lmnpResult.annees.map((a, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f9fafb' }}>
                        {[a.yr, a.lAn, a.chargesDeductibles, a.totalAmort, a.resultBIC, a.reportDeficit, a.impot, a.cfNet, a.impotCumul].map((v, j) => (
                          <td key={j} style={{
                            padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11,
                            color: j === 6 ? (v > 0 ? '#b91c1c' : '#15803d') : j === 7 ? (v >= 0 ? '#15803d' : '#b91c1c') : '#111827'
                          }}>
                            {j === 0 ? v : (v || 0).toLocaleString('fr-FR')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}

        {!lmnpResult && (
          <div style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: 16 }}>
            Renseignez le loyer mensuel pour activer l analyse LMNP
          </div>
        )}
      </div>

      {/* DVF */}
      {cs && (
        <div className="card" style={{ padding: 18, marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            Analyse DVF · {activeCompIndices.length}/{allComps.length} comparables selectionnes
          </h2>
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

          {allComps.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Comparables — decochez pour exclure de l analyse
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                    <tr>
                      {['', 'Date', 'Rue', 'Surf.', 'Etage', 'Prix/m2', 'Prix total'].map(h => (
                        <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allComps.map((c, i) => {
                      const selected = activeCompIndices.includes(i)
                      return (
                        <tr key={i} style={{ background: selected ? 'white' : '#fafafa', opacity: selected ? 1 : 0.4 }}>
                          <td style={{ padding: '6px 10px' }}>
                            <input type="checkbox" checked={selected} onChange={() => {
                              setSelectedComps(prev => {
                                const cur = prev || allComps.map((_, j) => j)
                                return cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i]
                              })
                            }} />
                          </td>
                          <td style={{ padding: '6px 10px', color: '#6b7280' }}>{c.date_mutation}</td>
                          <td style={{ padding: '6px 10px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.numero ? c.numero + ' ' : ''}{c.rue}</td>
                          <td style={{ padding: '6px 10px' }}>{c.surface}m2</td>
                          <td style={{ padding: '6px 10px' }}>{c.etage != null ? c.etage : '-'}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{fmt.pm2(c.prix_m2)}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{fmt.euro(c.prix)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
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

      {/* Finance */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {[
          ['ACQUISITION', [
            ['Prix FAI', fmt.euro(prixEff) + (prixEff && bien.surface ? ' · ' + Math.round(prixEff / bien.surface).toLocaleString('fr-FR') + ' EUR/m2' : '')],
            ['Frais notaire (8%)', fmt.euro(m?.fraisNotaire)],
            ['Travaux', fmt.euro(m?.travaux)],
            ['Total investi', fmt.euro(m?.totalInvesti), m?.totalInvesti <= effSettings.budgetMax ? '#15803d' : '#b91c1c']
          ]],
          ['FINANCEMENT', [
            ['LTV ' + effSettings.creditPct + '%', fmt.euro(m?.credit)],
            ['Apport ' + (100 - effSettings.creditPct) + '%', fmt.euro(m?.apport)],
            ['Mensualite', fmt.euro(m?.mensualite, 0) + '/mois'],
            ['Taux & duree', effSettings.tauxCredit + '% · ' + effSettings.dureeCredit + ' ans']
          ]],
          ['CASH FLOWS ANNUELS', [
            ['Loyer brut', fmt.euro(loyer ? loyer * 12 : null)],
            ['Vacance + charges', loyer ? '-' + fmt.euro((loyer * effSettings.vacanceMois) + (m?.charges || 0), 0) : '-'],
            ['Service dette', m ? '-' + fmt.euro(m.mensualite * 12, 0) : '-'],
            ['CF net/an', fmt.euro(m?.cashflowAnnuel, 0), m?.cashflowAnnuel >= 0 ? '#15803d' : '#b91c1c']
          ]],
          ['SORTIE ' + effSettings.horizon + ' ANS', [
            ['Base revente (auj.)', fmt.euro(prixRevEstAujourdhui) + (bien.surface ? ' · ' + Math.round(prixRevEstAujourdhui / bien.surface).toLocaleString('fr-FR') + ' EUR/m2' : '')],
            ['Appreciation ' + effSettings.appreciation + '%/an x ' + effSettings.horizon + ' ans', ''],
            ['Prix revente estime', fmt.euro(revente) + (bien.surface ? ' · ' + Math.round(revente / bien.surface).toLocaleString('fr-FR') + ' EUR/m2' : '')],
            ['Capital restant', m ? '-' + fmt.euro(m.capitalRestant, 0) : '-'],
            ['Frais vente ' + effSettings.fraisVente + '%', m ? '-' + fmt.euro(revente * effSettings.fraisVente / 100, 0) : '-'],
            ['Produit net revente', fmt.euro(m?.produitNetRevente), '#15803d']
          ]]
        ].map(([title, rows]) => (
          <div className="card" key={title} style={{ padding: '13px 15px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginBottom: 8 }}>{title}</div>
            {rows.map(([k, v, c]) => k && (
              <div key={k} className="divider-row">
                <span className="dk">{k}</span>
                <span className="dv mono" style={{ color: c || '#111827' }}>{v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {bien.url && <div style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 12, marginBottom: 12 }}><a href={bien.url} target="_blank" rel="noopener" style={{ color: '#6b7280' }}>{bien.url}</a></div>}
      {bien.notes && <div style={{ padding: '10px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 13, color: '#374151', marginBottom: 12 }}>{bien.notes}</div>}
    </div>
  )
}
