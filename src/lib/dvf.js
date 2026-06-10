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
            const keys = Object.keys(row)

            // Detection des colonnes par position (plus fiable que par nom)
            // Col 0=Ref, 1=RefCad, 2=Dept, 3=Commune, 4=Adresse, 5=Date, 6=Annee, 7=Pieces, 8=Etage, 9=SurfCarrez, 10=SurfUtile, 11=Prix, 12=PrixM2Carrez, 13=PrixM2Utile
            if (keys.length < 12) return

            const ref = String(row[keys[0]] || '')
            // Verifier que c'est bien une ref transaction (ex: 2025P13064)
            if (!ref || ref.length < 5 || !ref.match(/[0-9]{4}[A-Z][0-9]+/)) return

            const surf = pn(row[keys[9]])
            const surfUtile = pn(row[keys[10]])
            const prix = pn(row[keys[11]])

            if (!surf || surf < 7 || !prix || prix < 1000) return

            const commune = String(row[keys[3]] || '')
            let cp = '75006'
            if (commune.includes('07')) cp = '75007'
            else if (commune.includes('08')) cp = '75008'
            const cod = cp.slice(-2)
            const arr = (cod.startsWith('0') ? cod[1] : cod) + 'e'

            const adresse = String(row[keys[4]] || '').trim()
            const numMatch = adresse.match(/^(\d+\s*(?:bis|ter|quater)?)\s+(.+)$/i)

            const dateVal = String(row[keys[5]] || '')
            const anneeRaw = parseInt(row[keys[6]])
            const piecesRaw = parseInt(row[keys[7]])
            const etageRaw = parseInt(row[keys[8]])

            results.push({
              id_mutation:        ref,
              date_mutation:      dateVal.includes('/') ? dateVal.split('/').reverse().join('-') : (dateVal || null),
              rue:                (numMatch ? numMatch[2] : adresse).toUpperCase().trim(),
              numero:             numMatch ? parseInt(numMatch[1]) : null,
              code_postal:        cp,
              arrondissement:     arr,
              surface:            Math.round(surf * 10) / 10,
              surface_utile:      surfUtile > 0 ? Math.round(surfUtile * 10) / 10 : null,
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
