export function calcIRR(flows) {
  let r = 0.1
  for (let i = 0; i < 500; i++) {
    let n = 0, d = 0
    flows.forEach((cf, t) => { n += cf / (1 + r) ** t; d -= t * cf / (1 + r) ** (t + 1) })
    if (Math.abs(n) < 1 || !d) break
    r -= n / d
    if (!isFinite(r) || r < -1) return null
  }
  return isFinite(r) ? r * 100 : null
}

export function calcMensualite(P, ta, dur) {
  const r = ta / 100 / 12, n = dur * 12
  return r ? P * r * (1 + r) ** n / ((1 + r) ** n - 1) : P / n
}

export function calcCapitalRestant(P, ta, dur, ans) {
  const r = ta / 100 / 12, m = ans * 12, M = calcMensualite(P, ta, dur)
  return r ? P * (1 + r) ** m - M * ((1 + r) ** m - 1) / r : P * (1 - m / (dur * 12))
}

function normBien(bien) {
  if (!bien) return bien
  return {
    ...bien,
    loyerMensuel:   bien.loyerMensuel   ?? bien.loyer_mensuel   ?? null,
    travauxManuel:  bien.travauxManuel  ?? bien.travaux_manuel  ?? null,
    arrondissement: bien.arrondissement ?? null,
    etage:          bien.etage          ?? null,
  }
}

export function calcLMNP(bien, m, s, lmnp) {
  if (!bien?.prix || !m) return null
  const loyer = bien.loyerMensuel || 0
  if (!loyer) return null

  const horizon   = lmnp.horizon || s.horizon
  const tmi       = (lmnp.tmi || 0) / 100
  const ps        = 0.172
  const tauxTotal = tmi + ps

  const prixHFN = bien.prix / 1.08
  const mobilier = lmnp.mobilier || 0
  const travaux  = m.travaux || 0

  const amortBien = prixHFN / (lmnp.dureeAmortBien || 30)
  const amortMob  = mobilier > 0 ? mobilier / (lmnp.dureeAmortMob || 7) : 0
  const amortTrav = travaux  > 0 ? travaux  / (lmnp.dureeAmortTrav || 10) : 0

  const lAn            = loyer * (12 - s.vacanceMois)
  const chargesGestion = lAn * (lmnp.fraisGestion || 8) / 100
  const assurance      = lmnp.assurance    || 0
  const taxeFonciere   = lmnp.taxeFonciere || 0
  const chargesCopr    = lAn * s.chargesPct / 100

  const interetsAn = Array.from({ length: horizon }, (_, yr) => {
    const crDebut = yr === 0 ? m.credit : calcCapitalRestant(m.credit, s.tauxCredit, s.dureeCredit, yr)
    const crFin   = calcCapitalRestant(m.credit, s.tauxCredit, s.dureeCredit, yr + 1)
    return Math.max(0, m.mensualite * 12 - (crDebut - crFin))
  })

  let reportDeficit = 0
  const annees = []

  for (let yr = 0; yr < horizon; yr++) {
    const amortBienAn = yr < (lmnp.dureeAmortBien || 30) ? amortBien : 0
    const amortMobAn  = yr < (lmnp.dureeAmortMob  || 7)  ? amortMob  : 0
    const amortTravAn = yr < (lmnp.dureeAmortTrav  || 10) ? amortTrav : 0
    const totalAmort  = amortBienAn + amortMobAn + amortTravAn

    const chargesDeductibles   = interetsAn[yr] + chargesGestion + assurance + taxeFonciere + chargesCopr
    const resultBrutAvantAmort = lAn - chargesDeductibles

    const amortUtilisable = Math.min(totalAmort, Math.max(0, resultBrutAvantAmort + reportDeficit))
    const resultBIC       = resultBrutAvantAmort - amortUtilisable

    const newDeficit = Math.max(0, -resultBrutAvantAmort)
    reportDeficit = Math.max(0, reportDeficit - Math.max(0, resultBrutAvantAmort)) + newDeficit

    const impot  = resultBIC > 0 ? resultBIC * tauxTotal : 0
    const cfBrut = lAn - chargesCopr - m.mensualite * 12
    const cfNet  = cfBrut - impot

    annees.push({
      yr: yr + 1,
      lAn,
      chargesDeductibles: Math.round(chargesDeductibles),
      totalAmort:         Math.round(totalAmort),
      amortUtilisable:    Math.round(amortUtilisable),
      resultBIC:          Math.round(resultBIC),
      reportDeficit:      Math.round(reportDeficit),
      impot:              Math.round(impot),
      cfBrut:             Math.round(cfBrut),
      cfNet:              Math.round(cfNet),
      impotCumul:         0,
    })
  }

  let cumul = 0
  annees.forEach(a => { cumul += a.impot; a.impotCumul = cumul })

  const pvCalc = (prixVente, prixAcquis, hor) => {
    const pvBrute = Math.max(0, prixVente - prixAcquis)
    if (pvBrute === 0) return { pvBrute: 0, impotPV: 0, abatIR: 0, abatPS: 0 }

    let abatIR = 0
    if (hor >= 22)     abatIR = 100
    else if (hor > 5)  abatIR = Math.min(100, (hor - 5) * 6)

    let abatPS = 0
    if (hor >= 30)      abatPS = 100
    else if (hor >= 23) abatPS = Math.min(100, (hor - 22) * 9 + 28)
    else if (hor === 22) abatPS = 28
    else if (hor > 5)   abatPS = (hor - 5) * 1.65

    const pvIR    = pvBrute * (1 - abatIR / 100)
    const pvPS    = pvBrute * (1 - abatPS / 100)
    const impotPV = pvIR * 0.19 + pvPS * 0.172

    return {
      pvBrute: Math.round(pvBrute),
      impotPV: Math.round(impotPV),
      abatIR,
      abatPS: Math.round(abatPS * 10) / 10,
    }
  }

  return { annees, pvCalc }
}

export function calcMetrics(bienRaw, s) {
  const bien = normBien(bienRaw)
  if (!bien?.prix) return null
  const loyer = bien.loyerMensuel || 0
  const fn = bien.prix * 0.08
  const tr = bien.travauxManuel != null ? bien.travauxManuel
    : bien.etat === 'gros'    ? (bien.surface || 0) * s.travauxGros
    : bien.etat === 'complet' ? (bien.surface || 0) * s.travauxComplet
    : bien.etat === 'leger'   ? (bien.surface || 0) * s.travauxLeger
    : 0
  const tot = bien.prix + fn + tr

  const prixRevBase = bien._reventeOverride || (
    bien.comp_stats?.q3
      ? bien.comp_stats.q3 * (bien.surface || 0) * (1 + (bien.premiumRevente || 0) / 100)
      : bien.prix
  )
  const rev  = prixRevBase * (1 + s.appreciation / 100) ** s.horizon
  const cred = tot * s.creditPct / 100
  const app  = tot - cred
  const M    = calcMensualite(cred, s.tauxCredit, s.dureeCredit)
  const lAn  = loyer * (12 - s.vacanceMois)
  const ch   = lAn * s.chargesPct / 100
  const cf   = lAn - ch - M * 12
  const cr   = calcCapitalRestant(cred, s.tauxCredit, s.dureeCredit, s.horizon)
  const nr   = rev * (1 - s.fraisVente / 100) - cr
  const flows = [-app, ...Array.from({ length: s.horizon }, (_, i) => i === s.horizon - 1 ? cf + nr : cf)]

  return {
    lirr: loyer ? calcIRR(flows) : null,
    apport: app, credit: cred, mensualite: M,
    travaux: tr, fraisNotaire: fn, totalInvesti: tot,
    loyerAnnuel: lAn, charges: ch, cashflowAnnuel: cf,
    revente: rev, produitNetRevente: nr, capitalRestant: cr,
    rendementBrut: loyer ? loyer * 12 / bien.prix * 100 : null,
    rendementNet:  loyer ? (lAn - ch) / tot * 100 : null,
    cashOnCash:    loyer ? cf / app * 100 : null,
  }
}

export function calcLIRR_LMNP(bienRaw, s, lmnp, prixReventeAujourdhui) {
  const bien = normBien(bienRaw)
  if (!bien?.prix) return null

  const horizon      = lmnp.horizon || s.horizon
  const sAvecHorizon = { ...s, horizon }
  const m            = calcMetrics({ ...bien, _reventeOverride: null }, sAvecHorizon)
  if (!m) return null

  const lmnpData = calcLMNP(bien, m, sAvecHorizon, lmnp)
  if (!lmnpData) return null

  const prixRevBase = prixReventeAujourdhui || (
    bien.comp_stats?.q3
      ? bien.comp_stats.q3 * (bien.surface || 0) * (1 + (bien.premiumRevente || 0) / 100)
      : bien.prix
  )
  const prixVente = prixRevBase * (1 + s.appreciation / 100) ** horizon
  const cr        = calcCapitalRestant(m.credit, sAvecHorizon.tauxCredit, sAvecHorizon.dureeCredit, horizon)
  const prixAcquis = bien.prix + m.fraisNotaire + (lmnp.mobilier || 0)
  const pv         = lmnpData.pvCalc(prixVente, prixAcquis, horizon)
  const fraisVente = prixVente * sAvecHorizon.fraisVente / 100

  const produitNetAvantImpotPV = prixVente - cr - fraisVente
  const produitNetApresImpotPV = produitNetAvantImpotPV - pv.impotPV

  const flows = [
    -m.apport,
    ...lmnpData.annees.map((a, i) =>
      i === horizon - 1 ? a.cfNet + produitNetApresImpotPV : a.cfNet
    )
  ]

  return {
    lirrNet:               calcIRR(flows),
    lirrBrut:              m.lirr,
    impotRevenusCumules:   lmnpData.annees[horizon - 1]?.impotCumul || 0,
    pv,
    prixVente:             Math.round(prixVente),
    capitalRestant:        Math.round(cr),
    fraisVente:            Math.round(fraisVente),
    produitNetAvantImpotPV: Math.round(produitNetAvantImpotPV),
    produitNetApresImpotPV: Math.round(produitNetApresImpotPV),
    annees:                lmnpData.annees,
  }
}

export function calcScore(bienRaw, m, s) {
  const bien = normBien(bienRaw)
  if (!m?.lirr) return 0
  let sc = Math.min(7, Math.max(0, m.lirr / s.lirrCible * 7))
  if (['5e','6e','7e','8e','9e','10e'].includes(bien.arrondissement)) sc += 1.5
  if (m.totalInvesti <= s.budgetMax) sc += 1
  if (m.cashflowAnnuel > 0) sc += 0.5
  return Math.min(10, Math.round(sc * 10) / 10)
}

export const DEFAULT_SETTINGS = {
  budgetMax: 500000, lirrCible: 12, creditPct: 50, tauxCredit: 3.5,
  dureeCredit: 20, horizon: 10, appreciation: 2, chargesPct: 20,
  vacanceMois: 1, fraisVente: 3, travauxLeger: 500, travauxComplet: 1200,
  travauxGros: 2200, compsMois: 24, compsSurfPct: 35
}

export const DEFAULT_LMNP = {
  tmi: 30,
  horizon: 10,
  mobilier: 3000,
  dureeAmortBien: 30,
  dureeAmortMob: 7,
  dureeAmortTrav: 10,
  fraisGestion: 8,
  assurance: 500,
  taxeFonciere: 0,
}

export const ETAT_LABELS = {
  bon:     'Bon etat / sans travaux',
  leger:   'Rafraichissement leger',
  complet: 'Renovation complete',
  gros:    'Gros oeuvre',
  occupe:  'Occupe (loue)',
}

export const fmt = {
  euro:    (n, d = 0) => n == null ? '-' : n.toLocaleString('fr-FR', { maximumFractionDigits: d }) + '\u00a0EUR',
  pct:     (n, d = 1) => n == null ? '-' : n.toLocaleString('fr-FR', { maximumFractionDigits: d }) + '\u00a0%',
  pm2:     n          => n == null ? '-' : Math.round(n).toLocaleString('fr-FR') + '\u00a0EUR/m2',
  signPct: (n, d = 1) => n == null ? '-' : (n > 0 ? '+' : '') + n.toLocaleString('fr-FR', { maximumFractionDigits: d }) + '\u00a0%',
}
