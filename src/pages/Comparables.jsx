import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { parseDVFCSV, parsePatrimXLSX, deduplicateComps } from '../lib/dvf'

const BATCH_SIZE = 500

export default function Comparables() {
  const fileRef = useRef()
  const [stats, setStats] = useState(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ read: 0, valid: 0, inserted: 0, total: 0 })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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
      const isXLSX = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')

      if (isXLSX && !window.XLSX) {
        await new Promise((res, rej) => {
          const s = document.createElement('script')
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
          s.onload = res; s.onerror = rej
          document.head.appendChild(s)
        })
      }

      if (!isXLSX && !window.Papa) {
        await new Promise((res, rej) => {
          const s = document.createElement('script')
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js'
          s.onload = res; s.onerror = rej
          document.head.appendChild(s)
        })
      }

      const parsed = isXLSX
        ? await parsePatrimXLSX(file)
        : await parseDVFCSV(file, (read, valid) => setProgress(p => ({ ...p, read, valid })))

      if (parsed.length === 0) {
        throw new Error('Aucune transaction valide trouvee dans le fichier. Verifiez le format.')
      }

      const existingKeys = new Set()
      const { data: existingIds } = await supabase
        .from('comparables')
        .select('id_mutation,rue,date_mutation,surface,prix')
      if (existingIds) {
        existingIds.forEach(r => {
          const key = `${r.id_mutation || 'na'}_${r.rue || 'na'}_${r.date_mutation || 'na'}_${r.surface || 'na'}_${r.prix || 'na'}`
          existingKeys.add(key)
        })
      }

      const deduped = deduplicateComps(parsed, existingKeys)
      setProgress(p => ({ ...p, total: deduped.length }))

      let inserted = 0
      for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
        const batch = deduped.slice(i, i + BATCH_SIZE)
        const { error: insertError } = await supabase.from('comparables').insert(batch)
        if (insertError) throw new Error(insertError.message)
        inserted += batch.length
        setProgress(p => ({ ...p, inserted }))
      }

      setSuccess(`\u2705 ${inserted} transactions importees (${parsed.length - inserted} doublons ignores)`)
      loadStats()
    } catch (err) {
      setError('Erreur : ' + err.message)
    }
    setImporting(false)
  }

  async function clearAll() {
    if (!confirm('Effacer TOUTES les transactions ? Cette action est irreversible.')) return
    await supabase.from('comparables').delete().neq('id', 0)
    setStats(s => ({ ...s, total: 0 }))
    setSuccess('Base de donnees videe.')
  }

  const pct = progress.total ? Math.round(progress.inserted / progress.total * 100) : 0

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Comparables DVF</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        Importez vos exports Patrim (XLSX) ou les fichiers DVF de data.gouv.fr (CSV).
        Vous pouvez faire plusieurs imports successifs - les doublons sont automatiquement ignores.
      </p>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Importer un fichier</h2>

        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <strong>Option 1 - Patrim XLSX</strong> (recommande) : exportez depuis{' '}
          <a href="https://www.impots.gouv.fr/particulier/rechercher-des-transactions-immobilieres" target="_blank" rel="noopener" style={{ color: '#1e40af', textDecoration: 'underline' }}>
            impots.gouv.fr
          </a>
          {' '}et importez directement le fichier Excel.<br />
          <strong>Option 2 - DVF CSV</strong> : telechargez le fichier CSV departement{' '}
          <strong>75 (Paris)</strong> sur{' '}
          <a href="https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/" target="_blank" rel="noopener" style={{ color: '#1e40af', textDecoration: 'underline' }}>
            data.gouv.fr
          </a>.
        </div>

        {error && (
          <div className="alert" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5', marginBottom: 12 }}>
            {error}
          </div>
        )}
        {success && (
          <div className="alert alert-success" style={{ marginBottom: 12 }}>{success}</div>
        )}

        {importing && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 5 }}>
              <span>Lignes lues : {progress.read.toLocaleString('fr-FR')}</span>
              <span>Valides : {progress.valid.toLocaleString('fr-FR')}</span>
              <span>Inseres : {progress.inserted.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')}</span>
            </div>
            <div style={{ background: '#e5e7eb', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ background: '#1e40af', height: '100%', width: pct + '%', transition: 'width .3s', borderRadius: 4 }} />
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              {pct}% - Ne fermez pas cette page pendant l import
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-teal" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? 'Import en cours...' : 'Selectionner un fichier CSV ou XLSX'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => { importFile(e.target.files[0]); e.target.value = '' }}
          />
          {stats?.total > 0 && (
            <button className="btn-danger" onClick={clearAll} disabled={importing}>
              Effacer toute la base
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Base de donnees actuelle</h2>
        {!stats || stats.total === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>
            Aucune transaction importee. Importez un fichier Patrim (XLSX) ou DVF (CSV) pour demarrer.
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                [stats?.total?.toLocaleString('fr-FR') || '-', 'Transactions'],
                [stats?.dateMin || '-', 'Date la plus ancienne'],
                [stats?.dateMax || '-', 'Date la plus recente'],
                ['Paris 75xxx', 'Perimetre']
              ].map(([v, l]) => (
                <div key={l} style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: 15, fontFamily: 'monospace' }}>{v}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{l}</div>
                </div>
              ))}
            </div>
            <div className="alert alert-info">
              <strong>Conseils pour de meilleurs comparables :</strong><br />
              - Importez les fichiers des <strong>3 dernieres annees</strong> pour avoir une base solide<br />
              - Re-importez a chaque nouveau fichier semestriel - les doublons sont automatiquement geres<br />
              - Chaque import ajoute les nouvelles transactions sans ecraser les existantes
            </div>
          </>
        )}
      </div>
    </div>
  )
}
