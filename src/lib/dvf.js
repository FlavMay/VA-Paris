const pn = s => s ? parseFloat(String(s).replace(/\s/g, '').replace(',', '.')) : null

export function parseDVFRow(row) {
  const prix = pn(row.valeur_fonciere)
  const surf = pn(row.surface_reelle_bati)
  if (!prix || !surf || surf < 7 || surf > 250) return null
  const type = (row.type_local || '').toLowerCase()
  if (!type.includes('appartement')) return null
  const nat = (row.nature_mutation || '').toLowerCase()
  if (!nat.includes('vente')) return null
  const cp = (row.code_postal || '').trim()
  if (!cp.startsWith('75')) return null
  const cod = cp.slice(-2)
  const arr = (cod.startsWith('0') ? cod[1] : cod) + 'e'
  const lat = pn(row.latitude)
  const lng = pn(row.longitude)
  return {
    id_mutation:        row.id_mutation || null,
    date_mutation:      row.date_mutation || null,
    rue:                (row.adresse_nom_voie || '').toUpperCase().trim(),
    numero:             parseInt(row.adresse_numero) || null,
    code_postal:        cp,
    arrondissement:     arr,
    surface:            Math.round(surf * 10) / 10,
    surface_utile:      null,
    prix:               Math.round(prix),
    prix_m2:            Math.round(prix / surf),
    pieces:             parseInt(row.nombre_pieces_principales) || null,
    nombre_lots:        parseInt(row.nombre_lots) || null,
    etage:              null,
    annee_construction: null,
    latitude:           lat,
    longitude:          lng,
  }
}

export function parseDVFCSV(file, onProgress) {
  return new Promise((resolve, reject) => {
    const Papa = window.Papa
    if (!Papa) { reject(new Error('PapaParse non charge')); return }
    let total = 0
    const results = []
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      chunkSize: 1024 * 512,
      chunk(chunk) {
        chunk.data.forEach(row => {
          total++
          const parsed = parseDVFRow(row)
          if (parsed) results.push(parsed)
        })
        if (onProgress) onProgress(total, results.length)
      },
      complete() { resolve(results) },
      error(err) { reject(err) }
    })
  })
}

export function parsePatrimXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const XLSX = window.XLSX
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const results = []
        wb.SheetNames.forEach(sheetName => {
          const ws = wb.Sheets[sheetName]
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '', range: 2 })
