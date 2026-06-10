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
  return {
    id_mutation:        row.id_mutation || null,
    date_mutation:      row.date_mutation || null,
    rue:                (row.adresse_nom_voie || '').toUpperCase().trim(),
    numero:             parseInt(row.adresse_numero) || null,
    code_postal:        cp,
    arrondissement:     arr,
    surface:            Math.round(pn(row.surface_reelle_bati) * 10) / 10,
    surface_utile:      null,
    prix:               Math.round(prix),
    prix_m2:            Math.round(prix / surf),
    pieces:             parseInt(row.nombre_pieces_principales) || null,
    nombre_lots:        parseInt(row.nombre_lots) || null,
    etage:              null,
    annee_construction: null,
    latitude:           pn(row.latitude),
    longitude:          pn(row.longitude),
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
          rows.forEach((row, idx) => {
            // Prendre la premiere cle disponible pour ref
            const keys = Object.keys(row)
            const refKey = keys[0]
            const ref = String(row[refKey] || '')
            if (!ref || !ref.match(/\d{4}P\d+/)) return

            // Surface et prix — colonnes numeriques directement
            const surfKey = keys.find(k => k.includes('Carrez') && k.includes('m'))
            const surfUtileKey = keys.find(k => k.includes('Utile') && k.includes('m'))
            const prixKey = keys.find(k => k.includes('Prix') && !k.includes('m'))
            const adresseKey = keys.find(k => k.includes('Adresse'))
            const dateKey = keys.find(k => k.includes('Date'))
            const communeKey = keys.find(k => k.includes('Commune'))
            const piecesKey = keys.find(k => k.includes('ces') || k.includes('Pieces'))
            const etageKey = keys.find(k => k.includes('tage'))
            const anneeKey = keys.find(k => k.includes('nne'))

            const surf = pn(row[surfKey])
            const surfUtile = pn(row[surfUtileKey])
            const prix = pn(row[prixKey])

            if (!surf || surf < 7 || !prix || prix < 1000) return

            const commune = String(row[communeKey] || '')
            let cp = '75006'
            if (commune.includes('07')) cp = '75007'
            else if (commune.includes('08')) cp = '75008'
            const cod = cp.slice(-2)
            const arr = (cod.startsWith('0') ? cod[1] : cod) + 'e'

            const adresse = String(row[adresseKey] || '').trim()
            const numMatch = adresse.match(/^(\d+\s*(?:bis|ter|quater)?)\s+(.+)$/i)

            const etageRaw = parseInt(row[etageKey])
            const anneeRaw = parseInt(row[anneeKey])
            const dateVal = String(row[dateKey] || '')

            results.push({
              id_mutation:        ref,
              date_mutation:      dateVal.includes('/') ? dateVal.split('/').reverse().join('-') : dateVal || null,
              rue:                (numMatch ? numMatch[2] : adresse).toUpperCase().trim(),
              numero:             numMatch ? parseInt(numMatch[1]) : null,
              code_postal:        cp,
              arrondissement:     arr,
              surface:            Math.round(surf * 10) / 10,
              surface_utile:      surfUtile > 0 ? Math.round(surfUtile * 10) / 10 : null,
              prix:               Math.round(prix),
              prix_m2:            Math.round(prix / surf),
              pieces:             parseInt(row[piecesKey]) || null,
              nombre_lots:        null,
              etage:              !isNaN(etageRaw) ? etageRaw : null,
              annee_construction: !isNaN(anneeRaw) && anneeRaw > 1000 ? anneeRaw : null,
              latitude:           null,
              longitude:          null,
            })
          })
        })
        resolve(results)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

export function deduplicateComps(newComps, existingKeys) {
  const seen = new Set(existingKeys)
  return newComps.filter(c => {
    const key = `${c.id_mutation || 'na'}_${c.rue || 'na'}_${c.date_mutation || 'na'}_${c.surface || 'na'}_${c.prix || 'na'}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
