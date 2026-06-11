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
  const [compsResult, setCompsResult] = useState(null)
  const [selectedComps, setSelectedComps] = useState([])
  const [allCandidates, setAllCandidates] = useState([])

  const upd = patch => setD(prev => ({ ...prev, ...patch }))
  const m = calcMetrics(d, settings)
  const sc = m ? calcScore(d, m, settings) : null
  const cs = compsResult?.stats
  const pm2A = d.prix && d.surface ? Math.round(d.prix / d.surface) : null

  async function parseWithAI() {
    if (!rawText.trim()) return
    setAiLoading(true)
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000,
          messages: [{ role: 'user', content: `Analyse cette annonce immobiliere parisienne. Retourne UNIQUEMENT un JSON valide sans backticks.

Annonce:
${rawText}

JSON attendu (valeurs numeriques sans unites):
{"titre":"string 40 car max","adresse":"numero rue code_postal Paris","rue":"nom de rue","code_postal":"75006","arrondissement":"6e","surface":35,"prix":280000,"etat":"bon","pieces":2,"loyerMensuelEstime":1700,"notes":"2 phrases: etat etage atouts risques"}

Pour etat, utilise uniquement: bon, leger, complet, gros, occupe` }] })
      })
      const data = await resp.json()
      const txt = data.content?.find(c => c.type === 'text')?.text || '{}'
      const p = JSON.parse(txt.replace(/```[a-z]*|```/g, '').trim())
      upd({ ...p, loyerMensuel: p.loyerMensuelEstime })
      setStep(2)
    } catch (e) { setStep(2) }
    setAiLoading(false)
  }

  async function searchComps() {
    setGeoLoading(true)

    const bien = {
      ...d,
      prix_m2: pm2A,
      rue: d.rue || '',
      code_postal: d.code_postal || '',
    }

    // Geolocaliser si adresse fournie
    if (d.adresse) {
      const g = await geocodeAddress(d.adresse)
      if (g) {
        bien.latitude = g.latitude
        bien.longitude = g.longitude
        bien.code_postal = g.code_postal || d.code_postal
        upd({ latitude: g.latitude, longitude: g.longitude, geoLabel: g.label, code_postal: g.code_postal || d.code_postal })
      }
    }

    // Date limite pour les comparables
    const dateLimit = (() => {
      const c = new Date()
      c.setMonth(c.getMonth() - (settings.compsMois || 24))
      return c.toISOString().slice(0, 10)
    })()

    // Arrondissements a chercher
    const arrToSearch = d.arrondissement ? [d.arrondissement, ...ARRS].filter((v, i, a) => a.indexOf(v) === i) : ARRS

    // Charger les comparables depuis Supabase — sans filtre arrondissement si vide
    let query = supabase
      .from('comparables')
      .select('*')
      .gte('date_mutation', dateLimit)
      .limit(2000)

    if (arrToSearch.length > 0) {
      query = query.in('arrondissement', arrToSearch)
    }

    const { data: rawComps, error } = await query

    if (error) {
      console.error('Supabase error:', error)
    }

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
      loyer_mensuel: d.loyerMensuel || null,
      travaux_manuel: d.travauxManuel || null,
      notes: d.notes || null,
      url: url || null,
      latitude: d.latitude || null,
      longitude: d.longitude || null,
      pm2_ask: pm2A,
      pieces: d.pieces || null,
      comp_stats: activeStats ? { ...activeStats, comps: activeComps.slice(0, 50) } : null,
    }
    const { data } = await supabase.from('properties').insert(property).select().single()
    setSaving(false)
    if (data) nav('/bien/' + data.id)
  }

  const scC = s => s >= 8 ? '#15803d' : s >= 6 ? '#b45309' : s >= 4 ? '#c2410c' : '#b91c1c'

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {/* Steps indicator */}
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
          <div className="alert alert-info" style={{ marginBottom: 14 }}>Copiez le texte depuis PAP, Jinca ou SeLoger. L IA extraira automatiquement les donnees cles.</div>
          <div className="form-group"><label className="label">URL de reference (optionnel)</label><input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.pap.fr/annonce/..." /></div>
          <div className="form-group"><label className="label">Texte de l annonce</label><textarea rows={8} value={rawText} onChange={e => setRawText(e.target.value)} placeholder="Collez ici le texte complet de l annonce..." style={{ resize: 'vertical' }} /></div>
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

      {/* Step 2 */}
      {step >= 2 && (
        <div className="card" style={{ padding: 24, marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Verifier et completer</h2>

          <div className="form-group"><label className="label">Titre</label><input value={d.titre || ''} onChange={e => upd({ titre: e.target.value })} placeholder="Ex: T2 75006 a renover" /></div>
          <div className="form-group"><label className="label">Adresse complete (optionnel — pour geolocalisation)</label><input value={d.adresse || ''} onChange={e => upd({ adresse: e.target.value })} placeholder="Ex: 45 rue Saint-Jacques 75005 Paris" /></div>

          <div className="form-row">
            <div className="form-group"><label className="label">Prix FAI (€)</label><input type="number" value={d.prix || ''} onChange={e => upd({ prix: +e.target.value || null })} placeholder="Ex: 350000" /></div>
            <div className="form-group"><label className="label">Surface (m²)</label><input type="number" value={d.surface || ''} onChange={e => upd({ surface: +e.target.value || null })} placeholder="Ex: 45" /></div>
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
            <div className="form-group"><label className="label">Pieces</label><input type="number" value={d.pieces || ''} onChange={e => upd({ pieces: +e.target.value || null })} placeholder="Ex: 2" /></div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="label">Etat du bien</label>
              <select value={d.etat || 'bon'} onChange={e => upd({ etat: e.target.value })}>
                {Object.entries(ETAT_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="label">Loyer mensuel cible (€) — optionnel</label><input type="number" value={d.loyerMensuel || ''} onChange={e => upd({ loyerMensuel: +e.target.value || null })} placeholder="Ex: 1800" /></div>
          </div>

          <div className="form-group">
            <label className="label">Budget travaux manuel (€) — optionnel, laisser vide pour le bareme auto</label>
            <input type="number" value={d.travauxManuel || ''} onChange={e => upd({ travauxManuel: +e.target.value || null })} placeholder="Laisser vide pour calcul automatique" />
          </div>
          <div className="form-group"><label className="label">Notes (optionnel)</label><textarea rows={2} value={d.notes || ''} onChange={e => upd({ notes: e.target.value })} /></div>

          {/* Live preview — uniquement si prix et loyer renseignes */}
          {m && d.prix && d.loyerMensuel && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', marginTop: 4, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
              {[[fmt.pct(m.lirr), 'LIRR', m.lirr >= settings.lirrCible ? '#15803d' : m.lirr ? '#b45309' : '#b91c1c'],
                [fmt.euro(m.totalInvesti), 'Total investi', ''],
                [fmt.euro(m.cashflowAnnuel / 12, 0) + '/mo', 'CF net', m.cashflowAnnuel >= 0 ? '#15803d' : '#b91c1c'],
                [sc + '/10', 'Score', scC(sc || 0)]].map(([v, l, c]) => (
                <div key={l} style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 17, color: c || '#111827', lineHeight: 1 }}>{v}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {step === 2 && <button className="btn-ghost" onClick={() => setStep(1)}>← Retour</button>}
            {geoLoading
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b7280' }}><span className="spinner" />Recherche des comparables...</div>
              : <button className="btn-teal" onClick={searchComps}>Rechercher les comparables DVF →</button>
            }
            {/* Permettre d enregistrer sans comparables si deja a l etape 3 */}
            {step === 3 && (
              <button className="btn-primary" onClick={saveProperty} disabled={saving}>
                {saving ? 'Enregistrement...' : 'Enregistrer le bien'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && compsResult && (
        <div className="card" style={{ padding: 24, marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Comparables DVF</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
            {allCandidates.length} comparables trouves ({settings.compsMois} mois · ±{settings.compsSurfPct}% surface)
            {d.geoLabel && <> · <span style={{ color: '#15803d' }}>{d.geoLabel}</span></>}
          </p>

          {allCandidates.length === 0
            ? <div className="alert alert-warn">Aucun comparable trouve. Verifiez que vous avez importe les donnees DVF dans l onglet Comparables, ou elargissez la fenetre temporelle dans Parametres.</div>
            : <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14 }}>
                {[[fmt.pm2(activeStats?.q1), 'Q1 (25%)', '#6b7280'],
                  [fmt.pm2(activeStats?.median), 'Mediane', '#b45309'],
                  [fmt.pm2(activeStats?.q3), 'Q3 (75%)', '#15803d'],
                  [fmt.pm2(activeStats?.avg), 'Moyenne', '#6b7280'],
                  [pm2A ? fmt.pm2(pm2A) : '—', 'Ce bien', pm2A && activeStats && pm2A < activeStats.median ? '#1e40af' : '#b91c1c']].map(([v, l, c]) => (
                  <div key={l} style={{ background: '#f9fafb', borderRadius: 7, padding: '9px 10px', textAlign: 'center', border: l === 'Ce bien' ? '1.5px dashed ' + c : 'none' }}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: c }}>{v}</div>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>

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

              {activeStats && pm2A && m && (
                <div style={{ background: '#eff6ff', borderRadius: 8, padding: '12px 14px', border: '1px solid #bfdbfe', marginBottom: 14 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#1e40af', marginBottom: 8 }}>Analyse Value-Add</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {[
                      ['ARV median', fmt.euro(activeStats.median * (d.surface || 0))],
                      ['ARV Q3 (optimiste)', fmt.euro(activeStats.q3 * (d.surface || 0))],
                      ['Cout total revient', fmt.euro(m.totalInvesti)],
                      ['Spread (ARV Q3 − cout)', (() => { const sp = activeStats.q3 * (d.surface || 0) - m.totalInvesti; return (sp > 0 ? '+' : '') + fmt.euro(sp) })()],
                      ['Return on cost (Q3)', fmt.signPct((activeStats.q3 * (d.surface || 0) - m.totalInvesti) / m.totalInvesti * 100)],
                      ['Position vs mediane', pm2A < activeStats.median ? `−${Math.round((1 - pm2A / activeStats.median) * 100)}% sous-cote` : `+${Math.round((pm2A / activeStats.median - 1) * 100)}% sur-cote`]
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 10, color: '#1e40af', opacity: .7, marginBottom: 1 }}>{k}</div>
                        <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: '#111827' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <details style={{ marginBottom: 14 }}>
                <summary style={{ fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: '6px 0', color: '#374151' }}>
                  Gerer les comparables ({selectedComps.length}/{allCandidates.length})
                </summary>
                <div style={{ marginTop: 10, maxHeight: 280, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                      <tr>{['', 'Score', 'Date', 'Rue', 'Surf.', 'Prix/m2', 'Dist.'].map(h => <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {allCandidates.map(c => (
                        <tr key={c.id} style={{ background: selectedComps.includes(c.id) ? '#f0fdf4' : 'white' }}>
                          <td style={{ padding: '6px 10px' }}><input type="checkbox" checked={selectedComps.includes(c.id)} onChange={() => setSelectedComps(s => s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id])} /></td>
                          <td style={{ padding: '6px 10px', fontWeight: 600, color: c._score >= 70 ? '#15803d' : c._score >= 50 ? '#b45309' : '#6b7280' }}>{c._score}</td>
                          <td style={{ padding: '6px 10px' }}>{c.date_mutation}</td>
                          <td style={{ padding: '6px 10px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.rue}</td>
                          <td style={{ padding: '6px 10px' }}>{c.surface}m2</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{fmt.pm2(c.prix_m2)}</td>
                          <td style={{ padding: '6px 10px', color: '#9ca3af' }}>{c._dist ? Math.round(c._dist) + 'm' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          }

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn-ghost" onClick={() => setStep(2)}>← Modifier</button>
            <button className="btn-primary" onClick={saveProperty} disabled={saving}>
              {saving ? 'Enregistrement...' : 'Enregistrer le bien'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
