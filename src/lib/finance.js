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

  // Prix de revente = ARV Q3 des comparables × (1 + appreciation)^horizon
  // Si pas de comp_stats, fallback sur prix achat × appreciation
  const arvBase = bien.comp_stats?.q3
    ? bien.comp_stats.q3 * (bien.surface || 0)
    : bien.prix
  // Premium etage / vis-a-vis si renseigne (0 par defaut)
  const premiumRevente = bien.premiumRevente || 0
  const rev = (arvBase * (1 + premiumRevente / 100)) * (1 + s.appreciation / 100) ** s.horizon

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
