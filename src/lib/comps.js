function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function scoreComp(comp, bien, settings) {
  let score = 100

  if (bien.surface && comp.surface) {
    const diff = Math.abs(comp.surface - bien.surface) / bien.surface * 100
    if (diff > settings.compsSurfPct) return 0
    score -= diff * 0.8
  }

  if (bien.latitude && bien.longitude && comp.latitude && comp.longitude) {
    const dist = haversine(bien.latitude, bien.longitude, comp.latitude, comp.longitude)
    comp._dist = dist
    if (dist < 200)       score += 20
    else if (dist < 500)  score += 10
    else if (dist > 1500) score -= 20
    else if (dist > 2500) return 0
  } else if (bien.rue && comp.rue) {
    if (comp.rue.toUpperCase().includes(bien.rue.toUpperCase()) ||
        bien.rue.toUpperCase().includes(comp.rue.toUpperCase())) {
      score += 25
    }
  }

  // Etage — exclusion si ecart > 2 etages
  const etageB = bien.etage != null ? parseInt(bien.etage) : null
  const etageC = comp.etage != null ? parseInt(comp.etage) : null
  if (etageB != null && etageC != null && !isNaN(etageB) && !isNaN(etageC)) {
    const diffEtage = Math.abs(etageC - etageB)
    if (diffEtage > 2) return 0   // exclu — trop different
    else if (diffEtage <= 1) score += 10
  }

  if (bien.pieces && comp.pieces) {
    const diffP = Math.abs(comp.pieces - bien.pieces)
    if (diffP > 2) score -= 15
    else if (diffP <= 1) score += 5
  }

  if (comp.date_mutation) {
    const mois = (new Date() - new Date(comp.date_mutation)) / (1000 * 60 * 60 * 24 * 30)
    if (mois < 6)  score += 10
    else if (mois > 18) score -= 10
  }

  return Math.max(0, Math.round(score))
}

export function selectComps(rawComps, bien, settings, maxResults = 50) {
  return rawComps
    .map(c => ({ ...c, _score: scoreComp(c, bien, settings) }))
    .filter(c => c._score > 20)
    .sort((a, b) => b._score - a._score)
    .slice(0, maxResults)
}

export function calcCompsStats(comps) {
  if (!comps || !comps.length) return null
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
    stddev: Math.sqrt(pm2s.reduce((a, b) => a + (b - q(0.50)) ** 2, 0) / n)
  }
}

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
