import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../App'
import { calcMetrics, calcScore, fmt, ETAT_LABELS } from '../lib/finance'
import { selectComps, calcCompsStats, buildHistogram } from '../lib/comps'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const ARRS = ['5e','6e','7e','8e','9e','10e']

const ETAT_OPTIONS = {
  bon:     'Bon etat / sans travaux',
  leger:   'Rafraichissement leger',
  complet: 'Renovation complete',
  gros:    'Gros oeuvre',
  occupe:  'Occupe (bail en cours)',
}

async function geocodeAddress(query) {
  try {
    const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query + ' Paris')}&limit=1`)
    const d = await r.json()
    if (d.features?.[0]) {
      const f = d.features[0]
      return { latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0], label: f.properties.label, code_postal: f.properties.postcode || '' }
    }
  } catch {}
  return null
}

// Hypotheses locales modifiables — separees des donnees du bien
const DEFAULT_HYP = {
  loyerMensuel: null,
  travauxManuel: null,
  creditPct: null,
  tauxCredit: null,
  dureeCredit: null,
  appreciation: null,
  premiumRevente: 0,
}

export default function Analyser() {
  const { user, settings } = useApp()
  const nav = useNavigate()
  const [step, setStep] = useState(1)
  const [aiLoading, setAiLoading] = useState(false)
  const [geoLoading, setGeoLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rawText, setRawText] = useState('')
  const [url, setUrl] = useState('')
  const [d, setD] = useState({ etat: 'bon' })
  const [hyp, setHyp] = useState(DEFAULT_HYP)
  const [compsResult, setCompsResult] = useState(null)
  const [selectedComps, setSelectedComps] = useState([])
  const [allCandidates, setAllCandidates] = useState([])
  const [estimatingLoyer, setEstimatingLoyer] = useState(false)

  const upd = patch => setD(prev => ({ ...prev, ...patch }))
  const updHyp = patch => setHyp(prev => ({ ...prev, ...patch }))

  // Settings effectifs = settings globaux overrides par hypotheses locales
  const effSettings = {
    ...settings,
    ...(hyp.creditPct    != null ? { creditPct: hyp.creditPct }       : {}),
    ...(hyp.tauxCredit   != null ? { tauxCredit: hyp.tauxCredit }     : {}),
    ...(hyp.dureeCredit  != null ? { dureeCredit: hyp.dureeCredit }   : {}),
    ...(hyp.appreciation != null ? { appreciation: hyp.appreciation } : {}),
  }

  const bienEff = {
    ...d,
    loyerMensuel:  hyp.loyerMensuel  ?? d.loyerMensuel  ?? null,
    travauxManuel: hyp.travauxManuel ?? d.travauxManuel ?? null,
    premiumRevente: hyp.premiumRevente || 0,
  }

  const m = calcMetrics(bienEff, effSettings)
  const sc = m ? calcScore(bienEff, m, effSettings) : null
  const pm2A = d.prix && d.surface ? Math.round(d.prix / d.surface) : null

  async function estimateLoyer() {
    if (!d.surface && !d.arrondissement) return
    setEstimatingLoyer(true)
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 200,
          messages: [{ role: 'user', content: `Estime le loyer mensuel nu (hors charges) pour: ${d.surface || '?'}m2, ${d.pieces || '?'} pieces, ${d.arrondissement || 'Paris 6e'} arr., etat: ${ETAT_OPTIONS[d.etat] || 'bon etat'}, adresse: ${d.adresse || d.rue || 'Paris'}. Reponds UNIQUEMENT JSON: {"loyer":1800,"fourchette":"1700-1900"}` }]
        })
      })
      const data = await resp.json()
      const txt = data.content?.find(c => c.type === 'text')?.text || '{}'
      const p = JSON.parse(txt.replace(/```[a-z]*|```/g, '').trim())
      if (p.loyer) {
        updHyp({ loyerMensuel: p.loyer })
        alert(`Estimation loyer: ${p.loyer} EUR/mois (fourchette ${p.fourchette})`)
      }
    } catch (e) {}
    setEstimatingLoyer(false)
  }

  async function parseWithAI() {
    if (!rawText.trim()) return
    setAiLoading(true)
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000,
          messages: [{ role: 'user', content: `Analyse cette annonce immobiliere parisienne. Retourne UNIQUEMENT un JSON valide sans backticks.
Annonce: ${rawText}
JSON attendu: {"titre":"string 40 car max","adresse":"numero rue code_postal Paris","rue":"nom de rue","code_postal":"75006","arrondissement":"6e","surface":35,"prix":280000,"etat":"bon","pieces":2,"etage":3,"loyerMensuelEstime":1700,"notes":"2 phrases"}
Pour etat: bon, leger, complet, gros, occupe` }] })
      })
      const data = await resp.json()
      const txt = data.content?.find(c => c.type === 'text')?.text || '{}'
      const p = JSON.parse(txt.replace(/```[a-z]*|```/g, '').trim())
      upd({ ...p })
      updHyp({ loyerMensuel: p.loyerMensuelEstime || null })
      setStep(2)
    } catch (e) { setStep(2) }
    setAiLoading(false)
  }

  async function searchComps() {
    setGeoLoading(true)
    const bien = { ...d, prix_m2: pm2A, rue: d.rue || '', code_postal: d.code_postal || '' }

    if (d.adresse) {
      const g = await geocodeAddress(d.adresse)
      if (g) {
        bien.latitude = g.latitude
        bien.longitude = g.longitude
        bien.code_postal = g.code_postal || d.code_postal
        upd({ latitude: g.latitude, longitude: g.longitude, geoLabel: g.label, code_postal: g.code_postal || d.code_postal })
      }
    }

    const dateLimit = (() => { const c = new Date(); c.setMonth(c.getMonth() - (settings.compsMois || 24)); return c.toISOString().slice(0, 10) })()
    const arrToSearch = d.arrondissement ? [d.arrondissement, ...ARRS].filter((v, i, a) => a.indexOf(v) === i) : ARRS

    let query = supabase.from('comparables').select('*').gte('date_mutation', dateLimit).limit(2000)
    if (arrToSearch.length > 0) query = query.in('arrondissement', arrToSearch)

    const { data: rawComps, error } = await query
    if (error) console.error('Supabase error:', error)

    const candidates = selectComps(rawComps || [], bien, settings, 100)
    const stats = calcCompsStats(candidates)

    setAllCandidates(candidates)
    setSelectedComps(candidates.slice(0, 30).map(c => c.id).filter(Boolean))
    setCompsResult({ stats, candidates })
    setGeoLoading(false)
    setStep(3)
  }

  const activeComps = allCandidates.filter(c => selectedComps.includes(c.id))
  const activeStats = calcCompsStats(activeComps)
  const hist = buildHistogram(activeStats?.pm2s, pm2A)

  async function saveProperty() {
    setSaving(true)
    const property = {
      user_id: user.id,
      titre: d.titre || 'Bien sans titre',
      adresse: d.adresse || null,
      rue: d.rue || null,
      code_postal: d.code_postal || null,
      arrondissement: d.arrondissement || null,
      surface: d.surface || null,
      prix: d.prix || null,
      etat: d.etat || 'bon',
      loyer_mensuel: hyp.loyerMensuel || d.loyerMensuel || null,
      travaux_manuel: hyp.travauxManuel || d.travauxManuel || null,
      notes: d.notes || null,
      url: url || null,
      latitude: d.latitude || null,
      longitude: d.longitude || null,
      pm2_ask: pm2A,
      pieces: d.pieces || null,
      etage: d.etage || null,
      premiumRevente: hyp.premiumRevente || 0,
      comp_stats: activeStats ? { ...activeStats, comps: activeComps.slice(0, 50) } : null,
    }
    const { data } = await supabase.from('properties').insert(property).select().single()
    setSaving(false)
    if (data) nav('/bien/' + data.id)
  }

  const scC = s => s >= 8 ? '#15803d' : s >= 6 ? '#b45309' : s >= 4 ? '#c2410c' : '#b91c1c'

  const InputNum = ({ label, val, onChange, placeholder, unit }) => (
    <div className="form-group">
      <label className="label">{label}{unit ? ` (${unit})` : ''}</label>
      <input type="number" value={val || ''} onChange={e => onChange(+e.target.value || null)} placeholder={placeholder} />
    </div>
  )

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>

      {/* Steps */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        {[['1', 'Annonce'], ['2', 'Details'], ['3', 'Comparables']].map(([n, l], i) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: step >= +n ? '#1e40af' : '#e5e7eb', color: step >= +n ? 'white' : '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{n}</div>
            <span style={{ fontSize: 13, color: step >= +n ? '#1e40af' : '#9ca3af', fontWeight: step === +n ? 600 : 400 }}>{l}</span>
            {i < 2 && <span style={{ color: '#d1d5db', margin: '0 2px' }}>→</span>}
          </div>
        ))}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Coller l annonce</h2>
          <div className="alert alert-info" style={{ marginBottom: 14 }}>Copiez le texte depuis PAP, Jinca ou SeLoger.</div>
          <div className="form-group"><label className="label">URL (optionnel)</label><input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.pap.fr/annonce/..." /></div>
          <div className="form-group"><label className="label">Texte de l annonce</label><textarea rows={8} value={rawText} onChange={e => setRawText(e.target.value)} placeholder="Collez ici le texte complet..." style={{ resize: 'vertical' }} /></div>
          <div style={{ display: 'flex', gap: 10 }}>
            {aiLoading
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b7280' }}><span className="spinner" />Analyse IA...</div>
              : <>
                <button className="btn-primary" onClick={parseWithAI} disabled={!rawText.trim()}>Analyser avec l IA</button>
                <button className="btn-ghost" onClick={() => setStep(2)}>Saisie manuelle →</button>
              </>
            }
          </div>
        </div>
      )}

      {/* Step 2 — Details + Hypotheses */}
      {step >= 2 && (
        <div className="card" style={{ padding: 24, marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Details du bien</h2>

          <div className="form-group"><label className="label">Titre</label><input value={d.titre || ''} onChange={e => upd({ titre: e.target.value })} placeholder="Ex: T2 75006 a renover" /></div>
          <div className="form-group"><label className="label">Adresse (optionnel)</label><input value={d.adresse || ''} onChange={e => upd({ adresse: e.target.value })} placeholder="Ex: 45 rue Saint-Jacques 75005 Paris" /></div>

          <div className="form-row">
            <div className="form-group">
              <label className="label">Prix FAI (EUR)</label>
              <input type="number" value={d.prix || ''} onChange={e => upd({ prix: +e.target.value || null })} placeholder="Ex: 350000" />
              {d.prix && d.surface && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{Math.round(d.prix / d.surface).toLocaleString('fr-FR')} EUR/m2</div>}
            </div>
            <div className="form-group"><label className="label">Surface (m2)</label><input type="number" value={d.surface || ''} onChange={e => upd({ surface: +e.target.value || null })} placeholder="Ex: 45" /></div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="label">Arrondissement</label>
              <select value={d.arrondissement || ''} onChange={e => upd({ arrondissement: e.target.value })}>
                <option value="">— Non precise</option>
                {ARRS.map(a => <option key={a} value={a}>{a} arr.</option>)}
                <option value="autre">Autre</option>
              </select>
            </div>
            <div className="form-group"><label className="label">Etage</label><input type="number" value={d.etage ?? ''} onChange={e => upd({ etage: e.target.value !== '' ? +e.target.value : null })} placeholder="Ex: 3" /></div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="label">Etat du bien</label>
              <select value={d.etat || 'bon'} onChange={e => upd({ etat: e.target.value })}>
                {Object.entries(ETAT_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="label">Pieces</label><input type="number" value={d.pieces || ''} onChange={e => upd({ pieces: +e.target.value || null })} placeholder="Ex: 2" /></div>
          </div>

          <div className="form-group"><label className="label">Notes (optionnel)</label><textarea rows={2} value={d.notes || ''} onChange={e => upd({ notes: e.target.value })} /></div>

          {/* Separateur hypotheses */}
          <div style={{ borderTop: '1px solid #e5e7eb', margin: '18px 0 14px', paddingTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Hypotheses financieres</div>

            <div className="form-row">
              <div className="form-group">
                <label className="label">Loyer mensuel cible (EUR)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" value={hyp.loyerMensuel || ''} onChange={e => updHyp({ loyerMensuel: +e.target.value || null })} placeholder="Ex: 1800" style={{ flex: 1 }} />
                  <button className="btn-ghost btn-sm" onClick={estimateLoyer} disabled={estimatingLoyer} style={{ whiteSpace: 'nowrap' }}>
                    {estimatingLoyer ? '...' : 'Estimer IA'}
                  </button>
                </div>
              </div>
              <div className="form-group"><label className="label">Travaux manuel (EUR) — vide = auto</label><input type="number" value={hyp.travauxManuel || ''} onChange={e => updHyp({ travauxManuel: +e.target.value || null })} placeholder="Calcul auto selon etat" /></div>
            </div>

            <div className="form-row">
              <div className="form-group"><label className="label">Apport (%)</label><input type="number" value={hyp.creditPct ?? settings.creditPct} onChange={e => updHyp({ creditPct: +e.target.value || null })} /></div>
              <div className="form-group"><label className="label">Taux credit (%)</label><input type="number" step="0.1" value={hyp.tauxCredit ?? settings.tauxCredit} onChange={e => updHyp({ tauxCredit: +e.target.value || null })} /></div>
              <div className="form-group"><label className="label">Duree (ans)</label><input type="number" value={hyp.dureeCredit ?? settings.dureeCredit} onChange={e => updHyp({ dureeCredit: +e.target.value || null })} /></div>
            </div>

            <div className="form-row">
              <div className="form-group"><label className="label">Appreciation annuelle (%)</label><input type="number" step="0.1" value={hyp.appreciation ?? settings.appreciation} onChange={e => updHyp({ appreciation: +e.target.value || null })} /></div>
              <div className="form-group">
                <label className="label">Premium revente (%) — vis-a-vis, etage...</label>
                <input type="number" step="0.5" value={hyp.premiumRevente || 0} onChange={e => updHyp({ premiumRevente: +e.target.value || 0 })} placeholder="0" />
              </div>
            </div>
          </div>

          {/* Live preview */}
          {m && bienEff.prix && bienEff.loyerMensuel && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[
                [fmt.pct(m.lirr), 'LIRR', m.lirr >= effSettings.lirrCible ? '#15803d' : m.lirr ? '#b45309' : '#b91c1c'],
                [fmt.euro(m.totalInvesti), 'Total investi', ''],
                [fmt.euro(m.cashflowAnnuel / 12, 0) + '/mo', 'CF net', m.cashflowAnnuel >= 0 ? '#15803d' : '#b91c1c'],
                [sc + '/10', 'Score', scC(sc || 0)]
              ].map(([v, l, c]) => (
                <div key={l} style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 17, color: c || '#111827', lineHeight: 1 }}>{v}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {step === 2 && <button className="btn-ghost" onClick={() => setStep(1)}>Retour</button>}
            {geoLoading
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b7280' }}><span className="spinner" />Recherche comparables...</div>
              : <button className="btn-teal" onClick={searchComps}>Rechercher les comparables DVF →</button>
            }
          </div>
        </div>
      )}

      {/* Step 3 — Comparables */}
      {step === 3 && compsResult && (
        <div className="card" style={{ padding: 24, marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Comparables DVF</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
            {allCandidates.length} trouves, {selectedComps.length} selectionnes · {settings.compsMois} mois · etage ±2
            {d.geoLabel && <> · <span style={{ color: '#15803d' }}>{d.geoLabel}</span></>}
          </p>

          {allCandidates.length === 0 ? (
            <div className="alert alert-warn">Aucun comparable. Verifiez l import DVF ou elargissez les criteres dans Parametres.</div>
          ) : (
            <>
              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14 }}>
                {[
                  [fmt.pm2(activeStats?.q1), 'Q1', '#6b7280'],
                  [fmt.pm2(activeStats?.median), 'Mediane', '#b45309'],
                  [fmt.pm2(activeStats?.q3), 'Q3', '#15803d'],
                  [fmt.pm2(activeStats?.avg), 'Moyenne', '#6b7280'],
                  [pm2A ? fmt.pm2(pm2A) : '-', 'Ce bien', pm2A && activeStats && pm2A < activeStats.median ? '#1e40af' : '#b91c1c']
                ].map(([v, l, c]) => (
                  <div key={l} style={{ background: '#f9fafb', borderRadius: 7, padding: '9px 10px', textAlign: 'center', border: l === 'Ce bien' ? '1.5px dashed ' + c : 'none' }}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: c }}>{v}</div>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Histogram */}
              {hist.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 5 }}>Distribution prix/m2</p>
                  <ResponsiveContainer width="100%" height={100}>
                    <BarChart data={hist} barSize={20} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                      <YAxis hide />
                      <Tooltip formatter={v => [v + ' ventes']} contentStyle={{ fontSize: 11 }} />
                      <Bar dataKey="cnt" radius={[2, 2, 0, 0]}>
                        {hist.map((e, i) => <Cell key={i} fill={e.isTarget ? '#ef4444' : '#3b82f6'} fillOpacity={.75} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Value-add */}
              {activeStats && pm2A && m && (
                <div style={{ background: '#eff6ff', borderRadius: 8, padding: '12px 14px', border: '1px solid #bfdbfe', marginBottom: 14 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#1e40af', marginBottom: 8 }}>Analyse Value-Add</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {[
                      ['ARV median', fmt.euro(activeStats.median * (d.surface || 0))],
                      ['ARV Q3 (optimiste)', fmt.euro(activeStats.q3 * (d.surface || 0))],
                      ['Cout total revient', fmt.euro(m.totalInvesti)],
                      ['Spread (ARV Q3 - cout)', (() => { const sp = activeStats.q3 * (d.surface || 0) - m.totalInvesti; return (sp > 0 ? '+' : '') + fmt.euro(sp) })()],
                      ['Return on cost (Q3)', fmt.signPct((activeStats.q3 * (d.surface || 0) - m.totalInvesti) / m.totalInvesti * 100)],
                      ['Position vs mediane', pm2A < activeStats.median ? `-${Math.round((1 - pm2A / activeStats.median) * 100)}% sous-cote` : `+${Math.round((pm2A / activeStats.median - 1) * 100)}% sur-cote`]
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 10, color: '#1e40af', opacity: .7, marginBottom: 1 }}>{k}</div>
                        <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: '#111827' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Table comparables avec checkboxes — visible par defaut */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 8 }}>
                  Comparables selectionnes ({selectedComps.length}/{allCandidates.length}) — decochez ceux a exclure
                </div>
                <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                      <tr>
                        {['', 'Score', 'Date', 'Rue', 'Surf.', 'Etage', 'Prix/m2', 'Dist.'].map(h => (
                          <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allCandidates.map(c => {
                        const selected = selectedComps.includes(c.id)
                        return (
                          <tr key={c.id} style={{ background: selected ? '#f0fdf4' : '#fafafa', opacity: selected ? 1 : 0.5 }}>
                            <td style={{ padding: '6px 10px' }}>
                              <input type="checkbox" checked={selected}
                                onChange={() => setSelectedComps(s => s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id])} />
                            </td>
                            <td style={{ padding: '6px 10px', fontWeight: 600, color: c._score >= 70 ? '#15803d' : c._score >= 50 ? '#b45309' : '#6b7280' }}>{c._score}</td>
                            <td style={{ padding: '6px 10px', color: '#6b7280' }}>{c.date_mutation}</td>
                            <td style={{ padding: '6px 10px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.rue}</td>
                            <td style={{ padding: '6px 10px' }}>{c.surface}m2</td>
                            <td style={{ padding: '6px 10px' }}>{c.etage != null ? c.etage : '-'}</td>
                            <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{fmt.pm2(c.prix_m2)}</td>
                            <td style={{ padding: '6px 10px', color: '#9ca3af' }}>{c._dist ? Math.round(c._dist) + 'm' : '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn-ghost" onClick={() => setStep(2)}>Modifier</button>
            <button className="btn-primary" onClick={saveProperty} disabled={saving}>
              {saving ? 'Enregistrement...' : 'Enregistrer le bien'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
