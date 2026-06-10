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
        throw new Error('Aucune transaction valide trouvée dans le fichier. Vérifiez le format.')
      }

      // Récupérer les clés existantes pour dédoublonnage
      const existingKeys = new Set()
      const { data: existingIds } = await supabase
        .from('comparables')
        .select('id_mutation,rue,date_mutation,surface,prix')
      if (existingIds) {
        existingIds.forEach(r => {
          const key = r.id_mutation
            ? String(r.id_mutation)
            : `${r.rue}_${r.date_mutation}_${r.surface}_${r.prix}`
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

      setSuccess(`✅ ${inserted} transactions importées (${parsed.length - inserted} doublons ignorés)`)
      loadStats()
    } catch (err) {
      setError('Erreur : ' + err.message)
    }
    setImporting(false)
  }

  async function clearAll() {
    if (!confirm('Effacer TOUTES les transactions ? Cette action est irréversible.')) return
    await supabase.from('comparables').delete().neq('id', 0)
    setStats(s => ({ ...s, total: 0 }))
    setSuccess('Base de données vidée.')
  }

  const pct = progress.total ? Math.round(progress.inserted / progress.total * 100) : 0

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Comparables DVF</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        Importez vos exports Patrim (XLSX) ou les fichiers DVF de data.gouv.fr (CSV).
        Vous pouvez faire plusieurs imports successifs — les doublons sont automatiquement ignorés.
      </p>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📥 Importer un fichier</h2>

        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <strong>Option 1 — Patrim XLSX</strong> (recommandé) : exportez depuis{' '}
          <a href="https://www.impots.gouv.fr/particulier/rechercher-des-transactions-immobilieres" target="_blank" rel="noopener" style={{ color: '#1e40af', textDecoration: 'underline' }}>
            impots.gouv.fr → Rechercher des transactions
          </a>
          {' '}et importez directement le fichier Excel.<br />
          <strong>Option 2 — DVF CSV</strong> : téléchargez le fichier CSV département{' '}
          <strong>75 (Paris)</strong> sur{' '}
          <a href="https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/" target="
