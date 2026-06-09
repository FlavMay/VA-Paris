// ── Algorithme de sélection et scoring des comparables ──────────────────
// Score sur 100 : géographie (40%) + surface (25%) + récence (20%) + pièces (15%)

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const d = n => n * Math.PI / 180
  const a = Math.sin(d(lat2 - lat1) / 2) ** 2
    + Math.cos(d(lat1)) * Math.cos(d(lat2)) * Math.sin(d(lng2 - lng1) / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function scoreComp(comp, bien) {
  let score = 0

  // ── 1. Géographie (40 pts) ──────────────────────────────────────────
  if (bien.latitude && bien.longitude && comp.latitude && comp.longitude) {
    const dist = haversine(bien.latitude, bien.longitude, comp.latitude, comp.longitude)
    if      (dist < 50)   score += 40
    else if (dist < 100)  score += 34
    else if (dist < 200)  score += 27
    else if (dist < 400)  score += 20
    else if (dist < 700)  score += 12
    else if (dist < 1000) score += 5
    // > 1000m : 0
  } else {
    // Fallback : correspondance rue
    const bRue = (bien.rue || '').toUpperCase().trim()
    const cRue = (comp.rue || '').toUpperCase().trim()
    if (bRue && cRue && (bRue === cRue || bRue.includes(cRue) || cRue.includes(bRue))) {
      score += 30
    } else if (comp.code_postal === bien.code_postal) {
      score += 10
    }
  }

  // ── 2. Surface (25 pts) ────────────────────────────────────────────
  if (bien.surface && comp.surface) {
    const diff = Math.abs(comp.surface - bien.surface) / bien.surface
    if      (diff < 0.05) score += 25
    else if (diff < 0.10) score += 20
    else if (diff < 0.15) score += 16
    else if (diff < 0.20) score += 12
    else if (diff < 0.30) score += 8
    else if (diff < 0.40) score += 4
    // > 40% : 0
  }

  // ── 3. Récence (20 pts) ────────────────────────────────────────────
  const jours = (Date.now() - new Date(comp.date_mutation).getTime()) / 86400000
  if      (jours < 90)  score += 20
  else if (jours < 180) score += 17
  else if (jours < 365) score += 13
  else if (jours < 548) score += 9
  else if (jours < 730) score += 5
  // > 730j : 0

  // ── 4. Nombre de pièces (15 pts) ───────────────────────────────────
  if (bien.pieces && comp.pieces) {
    const diff = Math.abs(comp.pieces - bien.pieces)
    if      (diff === 0) score += 15
    else if (diff === 1) score += 8
    else if (diff === 2) score += 3
    // > 2 : 0
  } else {
    score += 7 // Inconnu : moitié des points
  }

  return Math.round(score)
}

// Filtre et trie les comparables par pertinence
export function selectComps(allComps, bien, settings, maxResults = 80) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - settings.compsMois)
  const cStr = cutoff.toISOString().slice(0, 10)

  const surfMin = (bien.surface || 30) * (1 - settings.compsSurfPct / 100)
  const surfMax = (bien.surface || 30) * (1 + settings.compsSurfPct / 100)

  // Pré-filtrage
  const candidates = allComps.filter(c => {
    if (c.date_mutation < cStr) return false
    if (c.surface < surfMin || c.surface > surfMax) return false
    // Exclure si code postal trop différent (sauf si on a les coords)
    if (!bien.latitude && c.code_postal !== bien.code_postal) return false
    return true
  })

  // Scoring et tri
  const scored = candidates
    .map(c => ({ ...c, _score: scoreComp(c, bien) }))
    .filter(c => c._score >= 15) // Seuil minimum de pertinence
    .sort((a, b) => b._score - a._score)
    .slice(0, maxResults)

  return scored
}

// Statistiques sur un ensemble de comparables
export function calcCompsStats(comps) {
  if (!comps.length) return null
  const pm2s = comps.map(c => c.prix_m2).filter(Boolean).sort((a, b) => a - b)
  if (!pm2s.length) return null
  const n = pm2s.length
  const q = r => pm2s[Math.min(n - 1, Math.floor(n * r))]
  return {
    n,
    min:    pm2s[0],
    max:    pm2s[n - 1],
    q1:     q(0.25),
    median: q(0.50),
    q3:     q(0.75),
    avg:    Math.round(pm2s.reduce((a, b) => a + b, 0) / n),
    pm2s,
    // Écart-type pour détecter les outliers
    stddev: Math.sqrt(pm2s.reduce((a, b) => a + (b - pm2s[Math.floor(n / 2)]) ** 2, 0) / n)
  }
}

// Construit histogramme
export function buildHistogram(pm2s, askPm2) {
  if (!pm2s?.length) return []
  const mn = Math.min(...pm2s), mx = Math.max(...pm2s)
  const step = Math.max(200, Math.ceil((mx - mn) / 10 / 100) * 100)
  const B = {}
  pm2s.forEach(p => {
    const k = Math.floor(p / step) * step
    B[k] = (B[k] || 0) + 1
  })
  return Object.entries(B)
    .sort((a, b) => +a[0] - +b[0])
    .map(([k, cnt]) => ({
      label: ((+k) / 1000).toFixed(1) + 'k',
      cnt,
      isTarget: askPm2 && +k <= askPm2 && askPm2 < +k + step,
      rangeMin: +k, rangeMax: +k + step
    }))
}
