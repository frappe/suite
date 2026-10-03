// Differential test runner.
//
//   node run.mjs [N]          run curated cases + N random formulas (default 5000)
//
// Oracle = HyperFormula (an independent, production spreadsheet engine). A
// divergence is NOT automatically "Sheets is wrong" — it's "these two disagree,
// go adjudicate". Curated cases additionally carry the Excel-correct answer so
// we can catch the oracle being wrong too.

import { writeFileSync } from 'node:fs'

import { CURATED, genFormula, rng } from './corpus.js'
import { canon, compare, oracleEval, sheetsEval } from './grid.js'

const N = parseInt(process.argv[2] || '5000', 10)
const SEED = parseInt(process.argv[3] || '12345', 10)

const fmt = (c) =>
  c.kind === 'throw' ? `THROW(${c.v})` : c.kind === 'blank' ? '<blank>' : JSON.stringify(c.v)

// ── Curated pass (three-way: sheets vs oracle vs known-Excel) ─────────────────
const curatedRows = []
for (const { f, excel } of CURATED) {
  const s = sheetsEval(f),
    o = oracleEval(f)
  const cmp = compare(s, o)
  let excelVerdict = ''
  if (excel !== null && excel !== undefined) {
    const sVsE = compare(s, excel).match
    const oVsE = compare(o, excel).match
    excelVerdict = `${sVsE ? 'sheets✓' : 'sheets✗'} ${oVsE ? 'oracle✓' : 'oracle✗'}`
  }
  curatedRows.push({
    f,
    s: canon(s),
    o: canon(o),
    match: cmp.match,
    reason: cmp.reason,
    excel,
    excelVerdict,
  })
}

// ── Random pass ───────────────────────────────────────────────────────────────
const r = rng(SEED)
const buckets = {
  'num-diff': [],
  kind: [],
  'both-throw': [],
  'sheets-throw': [],
  'oracle-throw': [],
  other: [],
}
let ran = 0,
  agree = 0,
  errCodeDiff = 0
const seen = new Set()

while (ran < N) {
  const f = genFormula(r)
  if (seen.has(f)) continue
  seen.add(f)
  const s = sheetsEval(f),
    o = oracleEval(f)
  const cs = canon(s),
    co = canon(o)
  const cmp = compare(s, o)
  ran++
  if (cmp.match) {
    agree++
    if (cmp.reason === 'err-code-diff') errCodeDiff++
    continue
  }
  const rec = { f, s: fmt(cs), o: fmt(co), reason: cmp.reason }
  if (cs.kind === 'throw') buckets['sheets-throw'].push(rec)
  else if (co.kind === 'throw') buckets['oracle-throw'].push(rec)
  else if (cmp.reason === 'num-diff') buckets['num-diff'].push(rec)
  else if (cmp.reason.startsWith('kind')) buckets['kind'].push(rec)
  else buckets['other'].push(rec)
}

const divergent = ran - agree

// ── Console summary ───────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(64))
console.log(' FRAPPE SHEETS — formula engine differential test')
console.log(' oracle: HyperFormula 2.x   seed:', SEED)
console.log('═'.repeat(64))

console.log('\n■ Curated cases (from findings.md) — Sheets vs oracle vs known-Excel:')
for (const row of curatedRows) {
  const flag = row.match ? '  agree ' : '✗ DIFF  '
  console.log(
    `  ${flag} ${row.f.padEnd(24)} sheets=${fmt(row.s).padEnd(10)} oracle=${fmt(row.o).padEnd(10)} ${row.excelVerdict}`,
  )
}

console.log(`\n■ Random pass: ${ran} unique formulas, seed ${SEED}`)
console.log(`   agree:      ${agree}  (${((100 * agree) / ran).toFixed(2)}%)`)
console.log(`   divergent:  ${divergent}  (${((100 * divergent) / ran).toFixed(2)}%)`)
console.log(`   (of agreements, ${errCodeDiff} were "both error, different code")`)
console.log('\n   divergences by bucket:')
for (const [k, v] of Object.entries(buckets))
  if (v.length) console.log(`     ${k.padEnd(14)} ${v.length}`)

console.log('\n   sample divergences:')
for (const [k, v] of Object.entries(buckets)) {
  for (const rec of v.slice(0, 4))
    console.log(
      `     [${k}] ${rec.f.padEnd(30)} sheets=${rec.o !== undefined ? rec.s : ''} oracle=${rec.o}`,
    )
}

// ── Markdown report ───────────────────────────────────────────────────────────
let md = `# Formula engine differential report\n\n`
md += `- Oracle: **HyperFormula 2.x** (independent production engine)\n`
md += `- Random formulas: **${ran}** (seed ${SEED}, reproducible)\n`
md += `- Agreement: **${((100 * agree) / ran).toFixed(2)}%** — divergent: **${divergent}**\n\n`
md += `> A divergence means the two engines disagree, not automatically that Sheets is wrong.\n`
md += `> The curated table below adjudicates against known Excel/Sheets answers.\n\n`
md += `## Curated cases (Sheets vs oracle vs known-correct)\n\n`
md += `| Formula | Sheets | Oracle | Excel-correct | Verdict |\n|---|---|---|---|---|\n`
for (const row of curatedRows) {
  md += `| \`${row.f}\` | ${fmt(row.s)} | ${fmt(row.o)} | ${row.excel ?? '—'} | ${row.excelVerdict || '—'} |\n`
}
md += `\n## Random divergences by bucket\n\n`
for (const [k, v] of Object.entries(buckets)) {
  if (!v.length) continue
  md += `### ${k} (${v.length})\n\n| Formula | Sheets | Oracle |\n|---|---|---|\n`
  for (const rec of v.slice(0, 30)) md += `| \`${rec.f}\` | ${rec.s} | ${rec.o} |\n`
  md += `\n`
}
writeFileSync(new URL('./report.md', import.meta.url), md)
console.log('\n→ wrote report.md\n')
