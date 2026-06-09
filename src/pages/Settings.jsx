import { useState } from 'react'
import { useApp } from '../App'

export default function Settings() {
  const { settings, saveSettings } = useApp()
  const [s, setS] = useState(settings)
  const [saved, setSaved] = useState(false)

  const upd = (k, v) => setS(prev => ({ ...prev, [k]: v }))
  const handleSave = async () => { await saveSettings(s); setSaved(true); setTimeout(() => setSaved(false), 2000) }
  const field = (label, key, step = 1, unit = '') => (
    <div className="form-group" key={key}>
      <label className="label">{label}{unit ? ` (${unit})` : ''}</label>
      <input type="number" step={step} value={s[key]} onChange={e => upd(key, +e.target.value)} />
    </div>
  )

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 700 }}>Paramètres</h1><p style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }}>Vos critères d'investissement et hypothèses de calcul LIRR</p></div>
        <button className="btn-primary" onClick={handleSave}>{saved ? '✓ Enregistré' : 'Enregistrer'}</button>
      </div>
      {[
        ['📊 Critères d\'investissement', [['LIRR cible', 'lirrCible', .5, '%'], ['Budget max', 'budgetMax', 10000, '€'], ['Horizon de revente', 'horizon', 1, 'ans']]],
        ['🏦 Financement', [['Part crédit', 'creditPct', 5, '%'], ['Taux crédit', 'tauxCredit', .1, '%/an'], ['Durée du crédit', 'dureeCredit', 1, 'ans']]],
        ['🔧 Barème travaux (€/m²)', [['Rafraîchissement léger', 'travauxLeger', 50], ['Rénovation complète', 'travauxComplet', 50], ['Gros œuvre / restructuration', 'travauxGros', 100]]],
        ['💰 Charges et revenus', [['Charges (copro, taxe foncière…)', 'chargesPct', 1, '% des loyers'], ['Vacance locative', 'vacanceMois', .5, 'mois/an'], ['Appréciation annuelle', 'appreciation', .5, '%/an'], ['Frais de vente', 'fraisVente', .5, '%']]],
        ['🔍 Comparables DVF', [['Fenêtre temporelle', 'compsMois', 1, 'mois'], ['Tolérance surface', 'compsSurfPct', 5, '%']]],
      ].map(([title, fields]) => (
        <div className="card" key={title} style={{ padding: 20, marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>{title}</h2>
          <div className="form-row-3">{fields.map(f => field(...f))}</div>
        </div>
      ))}
    </div>
  )
}
