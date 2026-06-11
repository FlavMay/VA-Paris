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
    loyerMensuel:  bien.loyerMensuel  ?? bien.loyer_mensuel  ?? null,
    travauxManuel: bien.travauxManuel ?? bien.travaux_manuel ?? null,
    arrondissement: bien.arrondissement ?? null,
    etage: bien.etage ?? null,
  }
}

// ─── LMNP REEL SIMPLIFIE ──────────────────────────────────────────────────────
// Calcule l impot annuel LMNP reel et le report de deficit BIC
// Retourne les flux nets d impots sur toute la duree de detention
export function calcLMNP(bien, m, s, lmnp) {
  if (!bien?.prix || !m) return null

  const loyer = bien.loyerMensuel || 0
  if (!loyer) return null

  const horizon     = lmnp.horizon || s.horizon
  const tmi         = (lmnp.tmi || 0) / 100
  const ps          = 0.172  // prelevements sociaux fixes
  const tauxTotal   = tmi + ps

  // Bases amortissables
  const prixHFN     = bien.prix / 1.08  // hors frais notaire
  const mobilier    = lmnp.mobilier || 0
  const travaux     = m.travaux || 0

  // Amortissements annuels
  const amortBien   = prixHFN / (lmnp.dureeAmortBien || 30)
  const amortMob    = mobilier > 0 ? mobilier / (lmnp.dureeAmortMob || 7) : 0
  const amortTrav   = travaux > 0 ? travaux / (lmnp.dureeAmortTrav || 10) : 0

  // Charges deductibles annuelles
  const lAn         = loyer * (12 - s.vacanceMois)
  const interets    = Array.from({ length: horizon }, (_, yr) => {
    // Interets = mensualite * 12 - remboursement capital
    const crDebut = calcCapitalRestant(m.credit, s.tauxCredit, s.dureeCredit, yr)
    const crFin   = calcCapitalRestant(m.credit, s.tauxCredit, s.dureeCredit, yr + 1)
    return Math.max(0, crDebut - crFin - m.mensualite * 12 + (crDebut - crFin))
  })
  // Simplification : interets = mensualite * 12 - (capital rembourse)
  const interetsAn  = Array.from({ length: horizon }, (_, yr) => {
    const crDebut = yr === 0 ? m.credit : calcCapitalRestant(m.credit, s.tauxCredit, s.dureeCredit, yr)
    const crFin   = calcCapitalRestant(m.credit, s.tauxCredit, s.dureeCredit, yr + 1)
    return Math.max(0, m.mensualite * 12 - (crDebut - crFin))
  })

  const chargesGestion  = lAn * (lmnp.fraisGestion || 8) / 100
  const assurance       = lmnp.assurance || 500
  const taxeFonciere    = lmnp.taxeFonciere || 0
  const chargesCopr     = lAn * s.chargesPct / 100

  // Simulation annee par annee
  let reportDeficit = 0
  const annees = []

  for (let yr = 0; yr < horizon; yr++) {
    const amortBienAn = yr < (lmnp.dureeAmortBien || 30) ? amortBien : 0
    const amortMobAn  = yr < (lmnp.dureeAmortMob  || 7)  ? amortMob  : 0
    const amortTravAn = yr < (lmnp.dureeAmortTrav  || 10) ? amortTrav : 0
    const totalAmort  = amortBienAn + amortMobAn + amortTravAn

    const chargesDeductibles = interetsAn[yr] + chargesGestion + assurance + taxeFonciere + chargesCopr
    const resultBrutAvantAmort = lAn - chargesDeductibles

    // Resultat BIC = loyers - charges - amortissements (max amort = resultat brut, pas de deficit par amort)
    const amortUtilisable = Math.min(totalAmort, Math.max(0, resultBrutAvantAmort + reportDeficit))
    const resultBIC = resultBrutAvantAmort - amortUtilisable

    // Report deficit (hors amortissement)
    const newDeficit = Math.max(0, -resultBrutAvantAmort)
    reportDeficit = Math.max(0, reportDeficit - Math.max(0, resultBrutAvantAmort)) + newDeficit

    // Impot
    const impot = resultBIC > 0 ? resultBIC * tauxTotal : 0

    // Cashflow net d impots
    const cfBrut = lAn - chargesCopr - m.mensualite * 12
    const cfNet  = cfBrut - impot

    annees.push({
      yr: yr + 1,
      lAn,
      chargesDeductibles: Math.round(chargesDeductibles),
      totalAmort: Math.round(totalAmort),
      amortUtilisable: Math.round(amortUtilisable),
      resultBIC: Math.round(resultBIC),
      reportDeficit: Math.round(reportDeficit),
      impot: Math.round(impot),
      cfBrut: Math.round(cfBrut),
      cfNet: Math.round(cfNet),
      impotCumul: 0,
    })
  }

  // Cumul impots
  let cumul = 0
  annees.forEach(a => { cumul += a.impot; a.impotCumul = cumul })

  // Plus-value a la revente (regime particuliers)
  const pvCalc = (prixVente, prixAcquis, horizon) => {
    const pvBrute = Math.max(0, prixVente - prixAcquis)
    if (pvBrute === 0) return { pvBrute: 0, pvIR: 0, pvPS: 0, impotPV: 0 }

    // Abattement IR : 0% < 6 ans, 6%/an de 6 a 21 ans, 4% 22e an, 100% >= 22 ans
    let abatIR = 0
    if (horizon >= 22) abatIR = 100
    else if (horizon > 5) abatIR = Math.min(100, (horizon - 5) * 6)
    if (horizon === 22) abatIR = 100

    // Abattement PS : 0% < 6 ans, 1.65%/an de 6 a 21 ans, 1.60% 22e, 9%/an de 23 a 30 ans, 100% >= 30 ans
    let abatPS = 0
    if (horizon >= 30) abatPS = 100
    else if (horizon >= 23) abatPS = Math.min(100, (horizon - 22) * 9 + 28)
    else if (horizon === 22) abatPS = 28
    else if (horizon > 5) abatPS = (horizon - 5) * 1.65

    const pvIR = pvBrute * (1 - abatIR / 100)
    const pvPS = pvBrute * (1 - abatPS / 100)
    const impotPV = pvIR * 0.19 + pvPS * 0.172

    return { pvBrute: Math.round(pvBrute), pvIR: Math.round(pvIR), pvPS: Math.round(pvPS), impotPV: Math.round(impotPV), abatIR, abatPS }
  }

  return { annees, pvCalc }
}

// ─── METRIQUES BRUTES (inchangees) ───────────────────────────────────────────
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
  const rev = prixRevBase * (1 + s.appreciation / 100) ** s.horizon

  const cred = tot * s.creditPct / 100
  const app = tot - cred
  const M = calcMensualite(cred, s.tauxCredit, s.dureeCredit)
  const lAn = loyer * (12 - s.vacanceMois)
  const ch = lAn * s.chargesPct / 100
  const cf = lAn - ch - M * 12
  const cr = calcCapitalRestant(cred, s.tauxCredit, s.dureeCredit, s.horizon)
  const nr = rev * (1 - s.fraisVente / 100) - cr
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

// ─── LIRR NET D IMPOTS LMNP ──────────────────────────────────────────────────
export function calcLIRR_LMNP(bienRaw, s, lmnp, prixReventeAujourdhui) {
  const bien = normBien(bienRaw)
  if (!bien?.prix) return null

  const horizon = lmnp.horizon || s.horizon

  // Recalculer m avec la bonne duree de detention LMNP
  const sLmnp = { ...s, horizon }
  // Ne pas passer _reventeOverride ici — on calcule nous-memes
  const bienSansOverride = { ...bien, _reventeOverride: null }
  const m = calcMetrics(bienSansOverride, sLmnp)
  if (!m) return null

  const lmnpData = calcLMNP(bien, m, sLmnp, lmnp)
  if (!lmnpData) return null

  // Prix de revente dans horizon ans base sur prix aujourd hui
  const prixRevBase = prixReventeAujourdhui || (
    bien.comp_stats?.q3
      ? bien.comp_stats.q3 * (bien.surface || 0) * (1 + (bien.premiumRevente || 0) / 100)
      : bien.prix
  )
  const prixVente = prixRevBase * (1 + s.appreciation / 100) ** horizon
  const cr = calcCapitalRestant(m.credit, s.tauxCredit, s.dureeCredit, horizon)

  const prixAcquis = bien.prix + m.fraisNotaire + (lmnp.mobilier || 0)
  const pv = lmnpData.pvCalc(prixVente, prixAcquis, horizon)

  const fraisVente = prixVente * s.fraisVente / 100
  const produitNet = prixVente - cr - fraisVente - pv.impotPV

  const flows = [
    -m.apport,
    ...lmnpData.annees.map((a, i) =>
      i === horizon - 1 ? a.cfNet + produitNet : a.cfNet
    )
  ]

  const lirrNet = calcIRR(flows)

  return {
    lirrNet,
    lirrBrut: m.lirr,
    impotTotal: lmnpData.annees[horizon - 1]?.impotCumul || 0,
    pv,
    prixVente: Math.round(prixVente),
    produitNet: Math.round(produitNet),
    annees: lmnpData.annees,
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
