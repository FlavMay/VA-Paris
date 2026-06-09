import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { parseDVFCSV, deduplicateComps } from '../lib/dvf'

const BATCH_SIZE = 500

export default function Comparables() {
  const fileRef = useRef()
  const [stats, setStats] = useState(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ read: 0, valid: 0, inserted: 0, total: 0 })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Chargement des stats au démarrage
  useEffect(() => { loadStats() }, [])

  async function loadStats() {
    const { count } = await supabase.from('comparables').select('*', { count: 'exact', head: true })
    const { data: dates } = await supabase.from('comparables').select('date_mutation').order('date_mutation', { ascending: true }).limit(1)
    const { data: datesMax } = await supabase.from('comparables').select('date_mutation').order('date_mutation', { ascending: false }).limit(1)
    const { data: arrs } = await supabase.rpc('count_by_arrondissement').catch(() => ({ data: null }))
    setStats({
      total: count || 0,
      dateMin: dates?.[0]?.date_mutation,
      dateMax: datesMax?.[0]?.date_mutation,
      arrs: arrs || []
    })
  }

  async function importFile(file) {
    if (!file) return
    setImporting(true); setError(''); setSuccess('')
    setProgress({ read: 0, valid: 0, inserted: 0, total: 0 })

    try {
      // 1. Charger PapaParse si besoin
      if (!window.Papa) {
        await new Promise((res, rej) => {
          const s = document.createElement('script')
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js'
          s.onload = res; s.onerror = rej
          document.head.appendChild(s)
        })
      }

      // 2. Parser le CSV
      const parsed = await parseDVFCSV(file, (read, valid) =>
        setProgress(p => ({ ...p, read, valid }))
      )
      setProgress(p => ({ ...p, valid: parsed.length }))

      // 3. Récupérer les clés existantes pour déduplication
      const { data: existingIds } = await supabase
        .from('comparables').select('id_mutation,surface,prix')
      const existingKeys = new Set(existingIds?.map(r => `${r.id_mutation}_${r.surface}_${r.prix}`) || [])

      // 4. Dédupliquer
      const toInsert = deduplicateComps(parsed, existingKeys)

      // 5. Insérer en batches
      let inserted = 0
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE)
        const { error: err } = await supabase.from('comparables').insert(batch)
        if (err) { setError('Erreur insertion : ' + err.message); break }
        inserted += batch.length
        setProgress(p => ({ ...p, inserted, total: toInsert.length }))
      }

      setSuccess(`✅ ${inserted.toLocaleString('fr-FR')} transactions importées (${(parsed.length - toInsert.length).toLocaleString('fr-FR')} doublons ignorés)`)
      await loadStats()
    } catch (e) {
      setError('Erreur : ' + e.message)
    }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function clearAll() {
    if (!confirm('Effacer TOUTES les transactions DVF ? Cette action est irréversible.')) return
    await supabase.from('comparables').delete().neq('id', 0)
    setStats(s => ({ ...s, total: 0 }))
    setSuccess('Base de données vidée.')
  }

  const pct = progress.total ? Math.round(progress.inserted / progress.total * 100) : 0

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Comparables DVF</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>Importez les données de transactions immobilières depuis data.gouv.fr. Vous pouvez faire plusieurs imports successifs — les doublons sont automatiquement ignorés.</p>

      {/* Import card */}
      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📥 Importer un fichier DVF</h2>
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <strong>Où télécharger :</strong> <a href="https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/" target="_blank" rel="noopener" style={{ color: '#1e40af', textDecoration: 'underline' }}>data.gouv.fr → Demandes de Valeurs Foncières</a><br />
          Téléchargez le fichier CSV pour le département <strong>75 (Paris)</strong>. Fichier annuel ou semestriel — vous pouvez en importer plusieurs à la suite.
        </div>

        {error && <div className="alert" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5', marginBottom: 12 }}>{error}</div>}
        {success && <div className="alert alert-success" style={{ marginBottom: 12 }}>{success}</div>}

        {importing && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 5 }}>
              <span>Lignes lues : {progress.read.toLocaleString('fr-FR')}</span>
              <span>Valides : {progress.valid.toLocaleString('fr-FR')}</span>
              <span>Insérés : {progress.inserted.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')}</span>
            </div>
            <div style={{ background: '#e5e7eb', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ background: '#1e40af', height: '100%', width: pct + '%', transition: 'width .3s', borderRadius: 4 }} />
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{pct}% — Ne fermez pas cette page pendant l'import</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-teal" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? <><span className="spinner" style={{ marginRight: 8 }} />Import en cours…</> : '📂 Sélectionner un fichier CSV'}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={e => importFile(e.target.files[0])} />
          {stats?.total > 0 && (
            <button className="btn-danger" onClick={clearAll} disabled={importing}>🗑 Effacer toute la base</button>
          )}
        </div>
      </div>

      {/* Stats card */}
      <div className="card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>📊 Base de données actuelle</h2>
        {stats?.total === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Aucune transaction importée. Importez un fichier DVF pour démarrer.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                [stats?.total?.toLocaleString('fr-FR') || '—', 'Transactions'],
                [stats?.dateMin || '—', 'Date la plus ancienne'],
                [stats?.dateMax || '—', 'Date la plus récente'],
                ['Paris 75xxx', 'Périmètre']
              ].map(([v, l]) => (
                <div key={l} style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: 15, fontFamily: 'monospace' }}>{v}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{l}</div>
                </div>
              ))}
            </div>
            <div className="alert alert-info">
              <strong>Conseils pour de meilleurs comparables :</strong><br />
              • Importez les fichiers des <strong>3 dernières années</strong> pour avoir une base solide<br />
              • Ré-importez à chaque nouveau fichier semestriel publié — les doublons sont automatiquement gérés<br />
              • Chaque import ajoute les nouvelles transactions sans écraser les existantes
            </div>
          </>
        )}
      </div>
    </div>
  )
}
