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
    surface:            Math.round(surf * 10) / 10,
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
          rows.forEach(row => {
            const ref = String(row['Ref. Enreg.'] || '')
            if (!ref || !ref.match(/[0-9]{4}[A-Z][0-9]+/)) return

            const surfC = pn(row['Surface Carrez (m2)'])
            const surfU = pn(row['Surface Utile (m2)'])
            const prix = pn(row['Prix (EUR)'])

            // Utiliser surface utile comme fallback si carrez manquant
            const surf = (surfC && surfC > 1) ? surfC : surfU

            if (!surf || surf < 7 || !prix || prix < 1000) return

            const commune = String(row['Commune'] || '')
            let cp = '75006'
            if (commune.includes('07')) cp = '75007'
            else if (commune.includes('08')) cp = '75008'
            const cod = cp.slice(-2)
            const arr = (cod.startsWith('0') ? cod[1] : cod) + 'e'

            const adresse = String(row['Adresse'] || '').trim()
            const numMatch = adresse.match(/^(\d+\s*(?:bis|ter|quater)?)\s+(.+)$/i)

            const dateVal = String(row['Date Vente'] || '')
            const anneeRaw = parseInt(row['Annee Constr.'])
            const piecesRaw = parseInt(row['Nb Pieces'])
            const etageRaw = parseInt(row['Etage'])

            results.push({
              id_mutation:        ref,
              date_mutation:      dateVal.includes('/') ? dateVal.split('/').reverse().join('-') : (dateVal || null),
              rue:                (numMatch ? numMatch[2] : adresse).toUpperCase().trim(),
              numero:             numMatch ? parseInt(numMatch[1]) : null,
              code_postal:        cp,
              arrondissement:     arr,
              surface:            Math.round(surf * 10) / 10,
              surface_utile:      (surfU && surfU > 1) ? Math.round(surfU * 10) / 10 : null,
              prix:               Math.round(prix),
              prix_m2:            Math.round(prix / surf),
              pieces:             isNaN(piecesRaw) ? null : piecesRaw,
              nombre_lots:        null,
              etage:              isNaN(etageRaw) ? null : etageRaw,
              annee_construction: (!isNaN(anneeRaw) && anneeRaw > 1000) ? anneeRaw : null,
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
