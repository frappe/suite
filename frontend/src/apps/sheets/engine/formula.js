// FormulaEngine — full expression parser + evaluator for Frappe Sheets
// Converted from v1 IIFE to ES module. One local dep: the sparkline spec builder.

import { sparkSpec, isSparkSpec } from './sparkline.js'

const T = {
	NUM:'NUM', STR:'STR', BOOL:'BOOL', ERR:'ERR',
	REF:'REF', FN:'FN', OP:'OP',
	LP:'LP', RP:'RP', COMMA:'COMMA', COLON:'COLON',
	COLREF:'COLREF',
	SHEETREF:'SHEETREF',
	SHEETCOL:'SHEETCOL',
	NAME:'NAME',         // identifier that isn't a function call or cell ref
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────
export function tokenize(src) {
	const out = []
	let i = 0
	while (i < src.length) {
		if (/\s/.test(src[i])) { i++; continue }

		if (src[i] === '"') {
			let s = ''; i++
			while (i < src.length && src[i] !== '"') {
				// Only `\"` and `\\` are true escapes. Everything else (notably
				// `\d`, `\s`, `\w`) must pass through as backslash-plus-char so
				// regex functions like REGEXMATCH work.
				if (src[i] === '\\' && (src[i+1] === '"' || src[i+1] === '\\')) {
					i++
				}
				s += src[i++]
			}
			i++
			out.push({ t: T.STR, v: s }); continue
		}

		if (/[0-9]/.test(src[i]) || (src[i] === '.' && /[0-9]/.test(src[i+1] || ''))) {
			let s = ''
			while (i < src.length && /[0-9.]/.test(src[i])) s += src[i++]
			if (i < src.length && /[eE]/.test(src[i])) {
				s += src[i++]
				if (i < src.length && /[+\-]/.test(src[i])) s += src[i++]
				while (i < src.length && /[0-9]/.test(src[i])) s += src[i++]
			}
			out.push({ t: T.NUM, v: parseFloat(s) }); continue
		}

		if (src[i] === '#') {
			let s = '#'; i++
			while (i < src.length && !/[\s,();+\-*\/^&<>=]/.test(src[i]) && src[i] !== '"') s += src[i++]
			out.push({ t: T.ERR, v: s }); continue
		}

		// Quoted sheet name — `'Sheet 2'!A1`, `'My.Sheet'!A1:B3`, etc. Excel
		// convention: any sheet whose name contains a space, dot, dash or other
		// non-alphanumeric char must be wrapped in apostrophes; a literal
		// apostrophe is escaped by doubling it (`'O''Brien'`). Without this
		// branch the tokenizer just choked on the leading `'`.
		if (src[i] === "'") {
			i++
			let sheetName = ''
			while (i < src.length) {
				if (src[i] === "'") {
					if (src[i + 1] === "'") { sheetName += "'"; i += 2; continue }  // escaped
					i++; break
				}
				sheetName += src[i++]
			}
			if (src[i] !== '!') { out.push({ t: T.ERR, v: '#REF!' }); continue }
			i++
			let cell = ''
			while (i < src.length && /[A-Za-z0-9]/.test(src[i])) cell += src[i++]
			const cellUp = cell.toUpperCase()
			if (/^[A-Z]+[0-9]+$/.test(cellUp))      out.push({ t: T.SHEETREF, sheet: sheetName, v: cellUp })
			else if (/^[A-Z]+$/.test(cellUp))        out.push({ t: T.SHEETCOL, sheet: sheetName, v: cellUp })
			else                                      out.push({ t: T.ERR, v: '#REF!' })
			continue
		}

		if (/[A-Za-z_]/.test(src[i])) {
			let s = ''
			while (i < src.length && /[A-Za-z0-9_$ ]/.test(src[i])) {
				if (src[i] === ' ') {
					let k = i + 1
					while (k < src.length && src[k] === ' ') k++
					if (src[k] === '!') { s += src[i++] } else break
				} else {
					s += src[i++]
				}
			}
			const up = s.trim().toUpperCase()

			// Peek for an immediately-following `(` so `TRUE()` and `FALSE()`
			// resolve to function calls rather than the bool keyword + a stray
			// pair of parens (which would tokenise as syntax error). Sheets and
			// Excel both accept either form for these literals.
			let j = i; while (j < src.length && src[j] === ' ') j++
			const isCall = (src[j] === '(')

			if (!isCall && up === 'TRUE')  { out.push({ t: T.BOOL, v: true  }); continue }
			if (!isCall && up === 'FALSE') { out.push({ t: T.BOOL, v: false }); continue }

			if (i < src.length && src[i] === '!') {
				i++
				let cell = ''
				while (i < src.length && /[A-Za-z0-9]/.test(src[i])) cell += src[i++]
				const cellUp = cell.toUpperCase()
				const sheetName = s.trim()
				if (/^[A-Z]+[0-9]+$/.test(cellUp))      out.push({ t: T.SHEETREF, sheet: sheetName, v: cellUp })
				else if (/^[A-Z]+$/.test(cellUp))        out.push({ t: T.SHEETCOL, sheet: sheetName, v: cellUp })
				else                                      out.push({ t: T.ERR, v: '#REF!' })
				continue
			}

			if (isCall)                                  out.push({ t: T.FN, v: up })
			else if (/^[A-Z]+[0-9]+$/.test(up))         out.push({ t: T.REF, v: up })
			else if (/^[A-Z]+$/.test(up))               out.push({ t: T.COLREF, v: up })
			// Bare identifier not followed by `(` — candidate named range.
			// The parser resolves it via `resolveNamedRange`; if unresolved
			// the expression evaluates to `#NAME?`.
			else                                          out.push({ t: T.NAME, v: up })
			continue
		}

		const two = src.substring(i, i + 2)
		if (two === '>=' || two === '<=' || two === '<>') { out.push({ t: T.OP, v: two }); i += 2; continue }

		const c = src[i++]
		if ('+-*/^&%'.includes(c))  { out.push({ t: T.OP, v: c }); continue }
		if (c === '=') { out.push({ t: T.OP, v: '=' }); continue }
		if (c === '>') { out.push({ t: T.OP, v: '>' }); continue }
		if (c === '<') { out.push({ t: T.OP, v: '<' }); continue }
		if (c === '(') { out.push({ t: T.LP  }); continue }
		if (c === ')') { out.push({ t: T.RP  }); continue }
		if (c === ',' || c === ';') { out.push({ t: T.COMMA }); continue }
		if (c === ':') { out.push({ t: T.COLON }); continue }
	}
	return out
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Fully flatten nested arrays. Previous version only unwrapped one level,
// which "worked" for vertical ranges (single-element sub-arrays coerce to
// numbers via Number([n]) === n) but silently produced 0 for horizontal /
// rectangular ranges because Number([a, b]) is NaN.
function flatten(v) {
	if (!Array.isArray(v)) return [v]
	const r = []
	for (const item of v) {
		if (Array.isArray(item)) r.push(...flatten(item))
		else r.push(item)
	}
	return r
}

function toNum(v) {
	if (v === true)  return 1
	if (v === false) return 0
	if (v === '' || v === null || v === undefined) return 0
	const n = Number(v)
	return isNaN(n) ? 0 : n
}

// Stricter numeric coercion for *scalar arithmetic* — Excel/Sheets treat
// `=A1+B1` as `#VALUE!` when one operand is text, rather than silently
// pretending text is 0. Aggregate functions (SUM, AVERAGE, …) keep using
// `toNum` so they continue to skip text rather than poison the whole result.
function toNumStrict(v) {
	if (typeof v === 'string' && v.startsWith('#')) return v   // propagate errors
	if (v === true)  return 1
	if (v === false) return 0
	if (v === '' || v === null || v === undefined) return 0
	if (typeof v === 'number') return v
	const n = Number(v)
	return isNaN(n) ? '#VALUE!' : n
}

function isErr(v) { return typeof v === 'string' && v.startsWith('#') }

// A sparkline spec is a render-only object — coerce it to '' anywhere it would
// otherwise stringify to "[object Object]" (concat, string comparison).
function _str(v) { return v == null || isSparkSpec(v) ? '' : String(v) }

// Loose equality for lookups: case-insensitive string match, or numeric match
// when BOTH sides are genuinely numeric. Guards against toNum('a')===toNum('b')
// ===0 silently matching the first cell for any non-numeric lookup.
function looseMatch(a, lookup) {
	if (String(a).toLowerCase() === String(lookup).toLowerCase()) return true
	const an = Number(a), ln = Number(lookup)
	return !isNaN(an) && a !== '' && !isNaN(ln) && lookup !== '' && an === ln
}

function makeCriteriaTest(c) {
	if (typeof c === 'string') {
		if (c.startsWith('>=')) { const n=parseFloat(c.slice(2)); return x=>toNum(x)>=n }
		if (c.startsWith('<=')) { const n=parseFloat(c.slice(2)); return x=>toNum(x)<=n }
		if (c.startsWith('<>')) { const s=c.slice(2); return x=>String(x)!==s }
		if (c.startsWith('>'))  { const n=parseFloat(c.slice(1)); return x=>toNum(x)>n }
		if (c.startsWith('<'))  { const n=parseFloat(c.slice(1)); return x=>toNum(x)<n }
		if (c.startsWith('='))  { const s=c.slice(1); return x=>String(x).toLowerCase()===s.toLowerCase() }
		if (c.includes('*') || c.includes('?')) {
			const re = new RegExp('^' + c.replace(/\*/g,'.*').replace(/\?/g,'.') + '$', 'i')
			return x => re.test(String(x))
		}
		return x => String(x).toLowerCase() === c.toLowerCase()
	}
	if (typeof c === 'number') return x => toNum(x) === c
	return x => x === c
}

// ─── Built-in functions ───────────────────────────────────────────────────────
const FUNCTIONS = {
	SUM:     args => flatten(args).reduce((s,v)=>isErr(v)?s:s+toNum(v), 0),
	AVERAGE: args => {
		const vals = flatten(args).filter(v=>!isErr(v)&&v!==''&&v!==null)
		return vals.length ? vals.reduce((s,v)=>s+toNum(v),0)/vals.length : '#DIV/0!'
	},
	MAX: args => { const n=flatten(args).map(toNum); return n.length ? Math.max(...n) : 0 },
	MIN: args => { const n=flatten(args).map(toNum); return n.length ? Math.min(...n) : 0 },
	COUNT:      args => flatten(args).filter(v=>!isErr(v)&&v!==''&&v!==null&&!isNaN(Number(v))).length,
	COUNTA:     args => flatten(args).filter(v=>v!==''&&v!==null&&v!==undefined).length,
	COUNTBLANK: args => flatten(args).filter(v=>v===''||v===null||v===undefined).length,
	PRODUCT:    args => flatten(args).reduce((p,v)=>p*toNum(v), 1),

	ROUND:     ([v,d])   => { const f=Math.pow(10,toNum(d)); return Math.round(toNum(v)*f)/f },
	ROUNDUP:   ([v,d])   => { const f=Math.pow(10,toNum(d)); return Math.ceil(toNum(v)*f)/f },
	ROUNDDOWN: ([v,d])   => { const f=Math.pow(10,toNum(d)); return Math.floor(toNum(v)*f)/f },
	ABS:    ([v])        => Math.abs(toNum(v)),
	INT:    ([v])        => Math.floor(toNum(v)),
	SQRT:   ([v])        => { const n=toNum(v); return n<0 ? '#NUM!' : Math.sqrt(n) },
	POWER:  ([b,e])      => Math.pow(toNum(b), toNum(e)),
	MOD:    ([n,d])      => { const dn=toNum(d); return dn===0 ? '#DIV/0!' : toNum(n)%dn },
	LOG:    ([v,b])      => { const n=toNum(v); if(n<=0) return '#NUM!'; return Math.log(n)/Math.log(b!==undefined?toNum(b):10) },
	LN:     ([v])        => { const n=toNum(v); return n<=0 ? '#NUM!' : Math.log(n) },
	EXP:    ([v])        => Math.exp(toNum(v)),
	PI:     ()           => Math.PI,
	RAND:   ()           => Math.random(),
	RANDBETWEEN: ([lo,hi]) => Math.floor(Math.random()*(Math.floor(toNum(hi))-Math.ceil(toNum(lo))+1))+Math.ceil(toNum(lo)),
	FLOOR:  ([v,s])      => { const sig=s!==undefined?toNum(s):1; return sig===0?'#DIV/0!':Math.floor(toNum(v)/sig)*sig },
	CEILING:([v,s])      => { const sig=s!==undefined?toNum(s):1; return sig===0?'#DIV/0!':Math.ceil(toNum(v)/sig)*sig },
	TRUNC:  ([v])        => Math.trunc(toNum(v)),
	SIGN:   ([v])        => Math.sign(toNum(v)),
	FACT:   ([n])        => { let v=toNum(n),r=1; for(let i=2;i<=v;i++) r*=i; return r },
	QUOTIENT:([n,d])     => { const dn=toNum(d); return dn===0?'#DIV/0!':Math.trunc(toNum(n)/dn) },
	GCD:    ([a,b])      => { let x=Math.abs(toNum(a)),y=Math.abs(toNum(b)); while(y){const t=y;y=x%y;x=t;} return x },
	EVEN:   ([v])        => { const n=Math.ceil(Math.abs(toNum(v))); return n%2===0?n:n+1 },
	ODD:    ([v])        => { const n=Math.ceil(Math.abs(toNum(v))); return n%2!==0?n:n+1 },

	// Trigonometry — all in radians, matching Excel/Sheets convention.
	SIN:    ([v])        => Math.sin(toNum(v)),
	COS:    ([v])        => Math.cos(toNum(v)),
	TAN:    ([v])        => Math.tan(toNum(v)),
	ASIN:   ([v])        => { const n=toNum(v); return n<-1||n>1 ? '#NUM!' : Math.asin(n) },
	ACOS:   ([v])        => { const n=toNum(v); return n<-1||n>1 ? '#NUM!' : Math.acos(n) },
	ATAN:   ([v])        => Math.atan(toNum(v)),
	ATAN2:  ([x,y])      => Math.atan2(toNum(y), toNum(x)),     // Excel order: ATAN2(x,y)
	SINH:   ([v])        => Math.sinh(toNum(v)),
	COSH:   ([v])        => Math.cosh(toNum(v)),
	TANH:   ([v])        => Math.tanh(toNum(v)),
	DEGREES:([v])        => toNum(v) * 180 / Math.PI,
	RADIANS:([v])        => toNum(v) * Math.PI / 180,

	// Combinatorics.
	COMBIN: ([n,k]) => {
		const nn=Math.trunc(toNum(n)), kk=Math.trunc(toNum(k))
		if (nn<0||kk<0||kk>nn) return '#NUM!'
		let r=1; for (let i=1;i<=kk;i++) r = r*(nn-i+1)/i
		return Math.round(r)
	},
	PERMUT: ([n,k]) => {
		const nn=Math.trunc(toNum(n)), kk=Math.trunc(toNum(k))
		if (nn<0||kk<0||kk>nn) return '#NUM!'
		let r=1; for (let i=0;i<kk;i++) r *= (nn-i)
		return r
	},

	SUMPRODUCT: args => {
		const arrays = args.map(a => flatten([a]).map(toNum))
		const len = Math.min(...arrays.map(a=>a.length))
		let s = 0
		for (let i=0; i<len; i++) s += arrays.reduce((p,a)=>p*(a[i]||0), 1)
		return s
	},
	SUMIF: ([range,criteria,sumRange]) => {
		const r=flatten([range]), s=sumRange!==undefined?flatten([sumRange]):r
		const test=makeCriteriaTest(criteria)
		return r.reduce((acc,v,i)=>test(v)?acc+toNum(s[i]||0):acc, 0)
	},
	SUMIFS: args => {
		const sr=flatten([args[0]])
		const mask=sr.map(()=>true)
		for (let i=1; i<args.length-1; i+=2) {
			const range=flatten([args[i]]), test=makeCriteriaTest(args[i+1])
			range.forEach((v,j)=>{ if(!test(v)) mask[j]=false })
		}
		return sr.reduce((acc,v,i)=>mask[i]?acc+toNum(v):acc, 0)
	},
	COUNTIF:  ([range,criteria]) => { const test=makeCriteriaTest(criteria); return flatten([range]).filter(test).length },
	COUNTIFS: args => {
		const first=flatten([args[0]])
		const mask=first.map(()=>true)
		for (let i=0; i<args.length-1; i+=2) {
			const range=flatten([args[i]]), test=makeCriteriaTest(args[i+1])
			range.forEach((v,j)=>{ if(!test(v)) mask[j]=false })
		}
		return mask.filter(Boolean).length
	},
	AVERAGEIF: ([range,criteria,avgRange]) => {
		const r=flatten([range]), a=avgRange!==undefined?flatten([avgRange]):r
		const test=makeCriteriaTest(criteria)
		const vals=r.reduce((acc,v,i)=>test(v)?[...acc,toNum(a[i]||0)]:acc,[])
		return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : '#DIV/0!'
	},
	// AVERAGEIFS(avg_range, criteria_range1, criteria1, [criteria_range2, criteria2, ...])
	AVERAGEIFS: args => {
		const av = flatten([args[0]])
		const mask = av.map(() => true)
		for (let i=1; i<args.length-1; i+=2) {
			const range = flatten([args[i]]), test = makeCriteriaTest(args[i+1])
			range.forEach((v, j) => { if (!test(v)) mask[j] = false })
		}
		const vals = av.filter((_, i) => mask[i]).map(toNum)
		return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : '#DIV/0!'
	},
	MAXIFS: args => {
		const mr = flatten([args[0]])
		const mask = mr.map(() => true)
		for (let i=1; i<args.length-1; i+=2) {
			const range = flatten([args[i]]), test = makeCriteriaTest(args[i+1])
			range.forEach((v, j) => { if (!test(v)) mask[j] = false })
		}
		const vals = mr.filter((_, i) => mask[i]).map(toNum)
		return vals.length ? Math.max(...vals) : 0
	},
	MINIFS: args => {
		const mr = flatten([args[0]])
		const mask = mr.map(() => true)
		for (let i=1; i<args.length-1; i+=2) {
			const range = flatten([args[i]]), test = makeCriteriaTest(args[i+1])
			range.forEach((v, j) => { if (!test(v)) mask[j] = false })
		}
		const vals = mr.filter((_, i) => mask[i]).map(toNum)
		return vals.length ? Math.min(...vals) : 0
	},
	LARGE: ([range,k]) => {
		const arr=flatten([range]).map(toNum).sort((a,b)=>b-a)
		const n=toNum(k)-1; return n>=0&&n<arr.length ? arr[n] : '#NUM!'
	},
	SMALL: ([range,k]) => {
		const arr=flatten([range]).map(toNum).sort((a,b)=>a-b)
		const n=toNum(k)-1; return n>=0&&n<arr.length ? arr[n] : '#NUM!'
	},
	MEDIAN: args => {
		const arr=flatten(args).map(toNum).sort((a,b)=>a-b)
		const m=Math.floor(arr.length/2)
		return arr.length%2 ? arr[m] : (arr[m-1]+arr[m])/2
	},
	STDEV: args => {
		const vals=flatten(args).map(toNum)
		if(vals.length<2) return '#DIV/0!'
		const mean=vals.reduce((s,v)=>s+v,0)/vals.length
		return Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/(vals.length-1))
	},
	// Population stdev — divides by N, not (N-1).
	STDEVP: args => {
		const vals = flatten(args).map(toNum)
		if (vals.length < 1) return '#DIV/0!'
		const mean = vals.reduce((s,v)=>s+v,0) / vals.length
		return Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0) / vals.length)
	},
	// Sample variance.
	VAR: args => {
		const vals = flatten(args).map(toNum)
		if (vals.length < 2) return '#DIV/0!'
		const mean = vals.reduce((s,v)=>s+v,0) / vals.length
		return vals.reduce((s,v)=>s+(v-mean)**2,0) / (vals.length - 1)
	},
	// Population variance.
	VARP: args => {
		const vals = flatten(args).map(toNum)
		if (vals.length < 1) return '#DIV/0!'
		const mean = vals.reduce((s,v)=>s+v,0) / vals.length
		return vals.reduce((s,v)=>s+(v-mean)**2,0) / vals.length
	},
	// Average of absolute deviations from mean.
	AVEDEV: args => {
		const vals = flatten(args).map(toNum)
		if (!vals.length) return '#DIV/0!'
		const mean = vals.reduce((s,v)=>s+v,0) / vals.length
		return vals.reduce((s,v)=>s+Math.abs(v-mean),0) / vals.length
	},
	// Geometric mean. All values must be positive.
	GEOMEAN: args => {
		const vals = flatten(args).map(toNum)
		if (!vals.length || vals.some(v => v <= 0)) return '#NUM!'
		const product = vals.reduce((p, v) => p * v, 1)
		return Math.pow(product, 1 / vals.length)
	},
	// Harmonic mean.
	HARMEAN: args => {
		const vals = flatten(args).map(toNum)
		if (!vals.length || vals.some(v => v === 0)) return '#NUM!'
		return vals.length / vals.reduce((s, v) => s + 1/v, 0)
	},
	// Pearson correlation coefficient.
	CORREL: ([xs, ys]) => {
		const X = flatten([xs]).map(toNum), Y = flatten([ys]).map(toNum)
		const n = Math.min(X.length, Y.length)
		if (n < 2) return '#DIV/0!'
		const mx = X.slice(0,n).reduce((s,v)=>s+v,0) / n
		const my = Y.slice(0,n).reduce((s,v)=>s+v,0) / n
		let num=0, dx=0, dy=0
		for (let i=0; i<n; i++) {
			const a = X[i]-mx, b = Y[i]-my
			num += a*b; dx += a*a; dy += b*b
		}
		const den = Math.sqrt(dx*dy)
		return den === 0 ? '#DIV/0!' : num / den
	},
	// Linear regression slope: y = SLOPE*x + INTERCEPT
	SLOPE: ([ys, xs]) => {
		const Y = flatten([ys]).map(toNum), X = flatten([xs]).map(toNum)
		const n = Math.min(X.length, Y.length)
		if (n < 2) return '#DIV/0!'
		const mx = X.slice(0,n).reduce((s,v)=>s+v,0) / n
		const my = Y.slice(0,n).reduce((s,v)=>s+v,0) / n
		let num=0, den=0
		for (let i=0; i<n; i++) {
			num += (X[i]-mx) * (Y[i]-my)
			den += (X[i]-mx) ** 2
		}
		return den === 0 ? '#DIV/0!' : num / den
	},
	INTERCEPT: ([ys, xs]) => {
		const Y = flatten([ys]).map(toNum), X = flatten([xs]).map(toNum)
		const n = Math.min(X.length, Y.length)
		if (n < 2) return '#DIV/0!'
		const mx = X.slice(0,n).reduce((s,v)=>s+v,0) / n
		const my = Y.slice(0,n).reduce((s,v)=>s+v,0) / n
		let num=0, den=0
		for (let i=0; i<n; i++) {
			num += (X[i]-mx) * (Y[i]-my)
			den += (X[i]-mx) ** 2
		}
		if (den === 0) return '#DIV/0!'
		const slope = num / den
		return my - slope * mx
	},
	PERCENTILE: ([range,k]) => {
		const arr=flatten([range]).map(toNum).sort((a,b)=>a-b)
		const p=toNum(k)
		if(p<0||p>1) return '#NUM!'
		const idx=p*(arr.length-1), lo=Math.floor(idx), hi=Math.ceil(idx)
		return arr[lo]+(arr[hi]-arr[lo])*(idx-lo)
	},

	IF:      ([cond,t,f])  => cond ? t : (f!==undefined?f:false),
	IFS:     args          => { for(let i=0;i<args.length-1;i+=2) if(args[i]) return args[i+1]; return '#N/A' },
	AND:     args          => flatten(args).every(v=>!!v),
	OR:      args          => flatten(args).some(v=>!!v),
	NOT:     ([v])         => !v,
	XOR:     args          => flatten(args).filter(v=>!!v).length%2===1,
	IFERROR: ([v,alt])     => isErr(v) ? alt : v,
	IFNA:    ([v,alt])     => v==='#N/A' ? alt : v,
	TRUE:    ()            => true,
	FALSE:   ()            => false,
	SWITCH:  args => {
		const e=args[0]
		for(let i=1;i<args.length-1;i+=2) if(e===args[i]) return args[i+1]
		return args.length%2===0 ? args[args.length-1] : '#N/A'
	},

	LEN:    ([v])            => String(v??'').length,
	UPPER:  ([v])            => String(v).toUpperCase(),
	LOWER:  ([v])            => String(v).toLowerCase(),
	PROPER: ([v])            => String(v).replace(/\b\w/g,c=>c.toUpperCase()),
	TRIM:   ([v])            => String(v).trim().replace(/\s+/g,' '),
	CLEAN:  ([v])            => String(v).replace(/[\x00-\x1F]/g,''),
	LEFT:   ([v,n])          => String(v).substring(0, toNum(n)),
	RIGHT:  ([v,n])          => { const s=String(v); return s.substring(s.length-toNum(n)) },
	MID:    ([v,st,len])     => String(v).substring(toNum(st)-1, toNum(st)-1+toNum(len)),
	CONCAT: args             => flatten(args).map(v=>v==null?'':String(v)).join(''),
	CONCATENATE: args        => flatten(args).map(v=>v==null?'':String(v)).join(''),
	TEXTJOIN: ([delim,ig,...rest]) => {
		const vals=flatten(rest).map(v=>v==null?'':String(v))
		return (ig?vals.filter(v=>v!==''):vals).join(String(delim))
	},
	REPT:   ([v,n])          => String(v).repeat(Math.max(0,toNum(n))),
	CHAR:   ([v])            => String.fromCharCode(toNum(v)),
	CODE:   ([v])            => String(v).charCodeAt(0),
	EXACT:  ([a,b])          => String(a)===String(b),
	SUBSTITUTE: ([v,old,nv,n]) => {
		const s=String(v),o=String(old),r=String(nv)
		if(n===undefined) return s.split(o).join(r)
		let count=0
		return s.split(o).reduce((acc,part,i)=>i===0?part:acc+(++count===toNum(n)?r:o)+part)
	},
	REPLACE: ([v,st,len,nv]) => { const s=String(v); return s.substring(0,toNum(st)-1)+String(nv)+s.substring(toNum(st)-1+toNum(len)) },
	FIND:   ([ft,wt,st])     => { const idx=String(wt).indexOf(String(ft),(toNum(st)||1)-1); return idx===-1?'#VALUE!':idx+1 },
	SEARCH: ([ft,wt,st])     => { const idx=String(wt).toLowerCase().indexOf(String(ft).toLowerCase(),(toNum(st)||1)-1); return idx===-1?'#VALUE!':idx+1 },
	VALUE:  ([v])            => { const n=parseFloat(String(v).replace(/[$, ]/g,'')); return isNaN(n)?'#VALUE!':n },
	TEXT:   ([v,fmt])        => {
		const n=toNum(v)
		if(typeof fmt!=='string') return String(v)
		if(fmt.includes('%')){
			// Decimals may appear before the trailing `%`, e.g. `"0.0%"`. The
			// previous regex required the digits at end-of-string and missed
			// them when `%` followed.
			const m = fmt.match(/\.([0#]+)/)
			const d = m ? m[1].length : 0
			return (n*100).toFixed(d) + '%'
		}
		if(fmt.startsWith('$')) return '$'+n.toFixed(2)
		const dm=fmt.match(/\.([0#]+)$/); if(dm) return n.toFixed(dm[1].length)
		if(/[0#,]+/.test(fmt)) return n.toLocaleString()
		return String(v)
	},
	DOLLAR: ([v,d]) => '$'+toNum(v).toFixed(d!==undefined?toNum(d):2),
	FIXED:  ([v,d]) => toNum(v).toFixed(d!==undefined?toNum(d):2),
	NUMBERVALUE: ([v]) => parseFloat(String(v).replace(/[,\s]/g,'')),
	// SPLIT(text, delimiter, [split_by_each], [remove_empty]) — return an array.
	SPLIT: ([text, delim, splitByEach, removeEmpty]) => {
		const s = String(text ?? '')
		const d = String(delim ?? '')
		if (!d) return [s]
		const each = splitByEach === undefined ? true : !!splitByEach
		const dropEmpty = removeEmpty === undefined ? true : !!removeEmpty
		let parts
		if (each && d.length > 1) {
			// Split on each character in `d`.
			const re = new RegExp(`[${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`)
			parts = s.split(re)
		} else {
			parts = s.split(d)
		}
		return dropEmpty ? parts.filter(p => p !== '') : parts
	},
	JOIN: ([delim, ...rest]) => flatten(rest).map(v => v == null ? '' : String(v)).join(String(delim ?? '')),
	// Regex helpers — JavaScript regex flavour (ECMA-262), like Google Sheets.
	REGEXMATCH: ([text, pattern]) => {
		try { return new RegExp(String(pattern)).test(String(text ?? '')) }
		catch (_) { return '#ERROR!' }
	},
	REGEXEXTRACT: ([text, pattern]) => {
		try {
			const m = new RegExp(String(pattern)).exec(String(text ?? ''))
			if (!m) return '#N/A'
			return m[1] !== undefined ? m[1] : m[0]
		} catch (_) { return '#ERROR!' }
	},
	REGEXREPLACE: ([text, pattern, replacement]) => {
		try { return String(text ?? '').replace(new RegExp(String(pattern), 'g'), String(replacement ?? '')) }
		catch (_) { return '#ERROR!' }
	},
	// ADDRESS(row, col, [abs_num], [a1_or_r1c1], [sheet]) — build a textual
	// reference. `abs_num`: 1=$A$1, 2=A$1, 3=$A1, 4=A1. R1C1 mode not yet
	// supported — falls back to A1.
	ADDRESS: ([row, col, absNum, _a1, sheet]) => {
		const r = toNum(row), c = toNum(col)
		if (r < 1 || c < 1) return '#VALUE!'
		const an = absNum === undefined ? 1 : toNum(absNum)
		// Build column letter.
		let n = c, label = ''
		while (n > 0) { const m = (n - 1) % 26; label = String.fromCharCode(65 + m) + label; n = Math.floor((n - 1) / 26) }
		const colAbs = (an === 1 || an === 3) ? '$' : ''
		const rowAbs = (an === 1 || an === 2) ? '$' : ''
		const ref = `${colAbs}${label}${rowAbs}${r}`
		return sheet ? `${sheet}!${ref}` : ref
	},

	TODAY:  () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` },
	NOW:    () => new Date().toLocaleString(),
	DATE:   ([y,m,d]) => { const dt=new Date(toNum(y),toNum(m)-1,toNum(d)); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}` },
	YEAR:   ([v]) => new Date(v).getFullYear(),
	MONTH:  ([v]) => new Date(v).getMonth()+1,
	DAY:    ([v]) => new Date(v).getDate(),
	HOUR:   ([v]) => new Date(v).getHours(),
	MINUTE: ([v]) => new Date(v).getMinutes(),
	SECOND: ([v]) => new Date(v).getSeconds(),
	DAYS:   ([en,st]) => Math.round((new Date(en)-new Date(st))/86400000),
	WEEKDAY:([v,type]) => { const d=new Date(v).getDay(),t=toNum(type)||1; if(t===2) return d||7; if(t===3) return d===0?6:d-1; return d+1 },
	EOMONTH:([v,m]) => {
		const d=new Date(v), nm=d.getMonth()+toNum(m)+1
		const nd=new Date(d.getFullYear()+Math.floor(nm/12),nm%12,0)
		return `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}-${String(nd.getDate()).padStart(2,'0')}`
	},
	DATEDIF:([st,en,unit]) => {
		const s=new Date(st),e=new Date(en),u=String(unit).toUpperCase()
		if(u==='D') return Math.floor((e-s)/86400000)
		if(u==='M') return (e.getFullYear()-s.getFullYear())*12+(e.getMonth()-s.getMonth())
		if(u==='Y') return e.getFullYear()-s.getFullYear()
		return 0
	},
	NETWORKDAYS: ([st,en]) => {
		let count=0,d=new Date(st),end=new Date(en)
		while(d<=end){ const day=d.getDay(); if(day!==0&&day!==6) count++; d.setDate(d.getDate()+1) }
		return count
	},
	// TIME(h, m, s) — Sheets/Excel store time as a fraction of a day. We return
	// the same fractional representation so it composes with arithmetic.
	TIME: ([h, m, s]) => {
		const hh=toNum(h), mm=toNum(m), ss=toNum(s)
		const secs = hh*3600 + mm*60 + ss
		const frac = (secs / 86400) % 1
		return frac < 0 ? frac + 1 : frac
	},
	// EDATE(start_date, months) — same calendar day, N months forward/backward.
	EDATE: ([start, months]) => {
		const d = new Date(start)
		if (isNaN(d.getTime())) return '#VALUE!'
		const day = d.getDate()
		d.setMonth(d.getMonth() + toNum(months))
		// If the target month is shorter, JS rolls over to the next month.
		// Clamp to the last day of the intended month (Excel behaviour).
		if (d.getDate() < day) d.setDate(0)
		return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
	},
	// WORKDAY(start_date, days) — add N working days (Mon-Fri), skipping weekends.
	WORKDAY: ([start, days]) => {
		const d = new Date(start)
		if (isNaN(d.getTime())) return '#VALUE!'
		let remaining = toNum(days)
		const step = remaining >= 0 ? 1 : -1
		remaining = Math.abs(remaining)
		while (remaining > 0) {
			d.setDate(d.getDate() + step)
			const day = d.getDay()
			if (day !== 0 && day !== 6) remaining--
		}
		return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
	},
	// DATEVALUE("2026-05-23") — Excel/Sheets serial number. We use the Excel
	// epoch (1900-01-00) for compatibility with their date math.
	DATEVALUE: ([text]) => {
		const d = new Date(text)
		if (isNaN(d.getTime())) return '#VALUE!'
		// Excel's serial: days since 1899-12-30 (the broken 1900-02-29 leap).
		const epoch = Date.UTC(1899, 11, 30)
		return Math.floor((d.getTime() - epoch) / 86400000)
	},
	TIMEVALUE: ([text]) => {
		// Accept "HH:MM" or "HH:MM:SS" with optional AM/PM.
		const m = String(text).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i)
		if (!m) return '#VALUE!'
		let h = parseInt(m[1], 10)
		const mm = parseInt(m[2], 10), ss = parseInt(m[3] || '0', 10)
		const ap = (m[4] || '').toLowerCase()
		if (ap === 'pm' && h < 12) h += 12
		if (ap === 'am' && h === 12) h = 0
		return (h*3600 + mm*60 + ss) / 86400
	},

	// Per Excel/Sheets semantics: range_lookup defaults to approximate match.
	// FALSE/0 explicitly forces exact match. The `exact` flag below is `true`
	// only when FALSE/0 was passed — the previous code had the polarity
	// inverted, which silently broke every exact-match VLOOKUP call.
	VLOOKUP: ([lookup,table,colIdx,rangeLookup]) => {
		if(!Array.isArray(table)) return '#VALUE!'
		// Implicit intersection: when the user passes a range as the lookup
		// value (e.g. =VLOOKUP(C25:C44, …) instead of =VLOOKUP(C25, …)),
		// reduce it to its first scalar. The engine doesn't spill arrays, so
		// without this every range-as-lookup formula coerces to a joined
		// string and returns #N/A. Matches Excel's pre-spill behaviour and
		// lets the user fill the formula down to populate the column.
		if (Array.isArray(lookup)) lookup = Array.isArray(lookup[0]) ? lookup[0][0] : lookup[0]
		const ci=toNum(colIdx)-1
		const exact = rangeLookup === false || rangeLookup === 0
		if(!exact) {
			let best=null
			for(const row of table) {
				if(!Array.isArray(row)) continue
				if(toNum(row[0])<=toNum(lookup)) best=row; else break
			}
			return best ? (best[ci]!==undefined?best[ci]:'#REF!') : '#N/A'
		}
		const row = table.find(r => {
			if (!Array.isArray(r)) return false
			if (String(r[0]).toLowerCase() === String(lookup).toLowerCase()) return true
			// Only fall through to numeric compare when BOTH sides are
			// numeric — otherwise toNum('a')===toNum('b')===0 silently
			// matches the first cell for any non-numeric lookup.
			const rn = Number(r[0]), ln = Number(lookup)
			return !isNaN(rn) && r[0] !== '' && !isNaN(ln) && lookup !== '' && rn === ln
		})
		return row ? (row[ci]!==undefined?row[ci]:'#REF!') : '#N/A'
	},
	HLOOKUP: ([lookup,table,rowIdx,rangeLookup]) => {
		if(!Array.isArray(table)||!Array.isArray(table[0])) return '#VALUE!'
		if (Array.isArray(lookup)) lookup = Array.isArray(lookup[0]) ? lookup[0][0] : lookup[0]
		const ri=toNum(rowIdx)-1, first=table[0]
		const exact = rangeLookup === false || rangeLookup === 0
		let ci=-1
		if(!exact) { for(let i=0;i<first.length;i++){if(toNum(first[i])<=toNum(lookup))ci=i;else break;} }
		else {
			ci = first.findIndex(v => {
				if (String(v).toLowerCase() === String(lookup).toLowerCase()) return true
				const vn = Number(v), ln = Number(lookup)
				return !isNaN(vn) && v !== '' && !isNaN(ln) && lookup !== '' && vn === ln
			})
		}
		if(ci===-1) return '#N/A'
		return table[ri] ? (table[ri][ci]!==undefined?table[ri][ci]:'#REF!') : '#REF!'
	},
	// XLOOKUP(lookup, lookup_array, return_array, [if_not_found], [match_mode])
	// match_mode: 0 exact (default), -1 exact-or-next-smaller, 1 exact-or-next-larger.
	// Pre-spill: lookup/return arrays are flattened and a single matched value is
	// returned (full spill is a planned follow-up, same as VLOOKUP).
	XLOOKUP: ([lookup,lookupArr,returnArr,ifNotFound,matchMode]) => {
		if (Array.isArray(lookup)) lookup = Array.isArray(lookup[0]) ? lookup[0][0] : lookup[0]
		const keys = flatten([lookupArr]), vals = flatten([returnArr])
		const mm = matchMode !== undefined ? toNum(matchMode) : 0
		// Approximate match only makes sense for a numeric lookup — otherwise
		// Number('cherry')→NaN (and toNum→0) would spuriously match numeric keys.
		// A non-numeric lookup falls back to exact-only, returning if_not_found.
		const target = Number(lookup)
		const canApprox = mm !== 0 && lookup !== '' && lookup != null && !isNaN(target)
		let idx = -1, bestNum = null
		for (let i = 0; i < keys.length; i++) {
			if (looseMatch(keys[i], lookup)) { idx = i; break }
			if (!canApprox) continue
			const n = Number(keys[i])
			if (isNaN(n) || keys[i] === '') continue
			// mm=1 wants the smallest key >= target; mm=-1 the largest key <= target.
			if (mm === 1  && n > target && (bestNum === null || n < bestNum)) { bestNum = n; idx = i }
			if (mm === -1 && n < target && (bestNum === null || n > bestNum)) { bestNum = n; idx = i }
		}
		if (idx === -1) return ifNotFound !== undefined ? ifNotFound : '#N/A'
		return vals[idx] !== undefined ? vals[idx] : '#REF!'
	},
	MATCH: ([lookup,range,matchType]) => {
		const arr=flatten([range]), mt=matchType!==undefined?toNum(matchType):1
		if(mt===0){
			// Match by string OR by numeric value — but only fall through to a
			// numeric compare when BOTH sides are actually numeric. Otherwise
			// toNum('a')===toNum('b')===0 incorrectly matches the first cell
			// for any non-numeric lookup.
			const i = arr.findIndex(v => {
				if (String(v).toLowerCase() === String(lookup).toLowerCase()) return true
				const vn = Number(v), ln = Number(lookup)
				return !isNaN(vn) && v !== '' && !isNaN(ln) && lookup !== '' && vn === ln
			})
			return i === -1 ? '#N/A' : i + 1
		}
		if(mt===1){ for(let i=0;i<arr.length;i++){if(toNum(arr[i])>toNum(lookup))return i>0?i:'#N/A';} return arr.length }
		if(mt===-1){ for(let i=0;i<arr.length;i++){if(toNum(arr[i])<toNum(lookup))return i>0?i:'#N/A';} return arr.length }
		return '#N/A'
	},
	INDEX: ([range,rowNum,colNum]) => {
		const r=toNum(rowNum)-1, c=colNum!==undefined?toNum(colNum)-1:0
		if(!Array.isArray(range)) return range
		const row=Array.isArray(range[r])?range[r]:range
		return row[Array.isArray(range[r])?c:r]!==undefined ? row[Array.isArray(range[r])?c:r] : '#REF!'
	},
	CHOOSE: ([idx,...vals]) => { const i=toNum(idx); return i>=1&&i<=vals.length?vals[i-1]:'#VALUE!' },

	ISBLANK:  ([v]) => v===''||v===null||v===undefined,
	ISNUMBER: ([v]) => !isErr(v)&&v!==''&&v!==null&&!isNaN(Number(v)),
	ISTEXT:   ([v]) => typeof v==='string'&&(isNaN(Number(v))||v===''),
	ISERROR:  ([v]) => isErr(v),
	ISERR:    ([v]) => isErr(v)&&v!=='#N/A',
	ISNA:     ([v]) => v==='#N/A',
	ISLOGICAL:([v]) => typeof v==='boolean',
	ISODD:    ([v]) => Math.abs(toNum(v))%2===1,
	ISEVEN:   ([v]) => Math.abs(toNum(v))%2===0,
	N:        ([v]) => toNum(v),
	T:        ([v]) => typeof v==='string'?v:'',
	NA:       ()    => '#N/A',
	ROW: ([v]) => {
		if(typeof v==='string'&&/^[A-Z]+[0-9]+$/.test(v)) return parseInt(v.match(/[0-9]+/)[0])
		return 1
	},
	COLUMN: ([v]) => {
		if(typeof v==='string'&&/^[A-Z]+[0-9]+$/.test(v))
			return v.match(/[A-Z]+/)[0].split('').reduce((acc,c)=>acc*26+(c.charCodeAt(0)-64),0)
		return 1
	},
	ROWS:    ([v]) => Array.isArray(v)?v.length:1,
	COLUMNS: ([v]) => Array.isArray(v)&&Array.isArray(v[0])?v[0].length:(Array.isArray(v)?v.length:1),

	// SPARKLINE(data_range, [type], [color]) — returns a spec the cell renders as
	// an in-cell mini chart instead of text (type: line | column | bar). It's a
	// normal formula, so it recomputes and shifts with its range like any other.
	SPARKLINE: ([range, type, color]) => sparkSpec(flatten([range]), type, color),

	// ── Array functions ─────────────────────────────────────────────────────
	//
	// These return arrays. They work as input to other functions (e.g.
	// SUM(TRANSPOSE(A1:A3))). Direct cell use without array-formula spilling
	// will display the first element only — full spilling is a planned
	// follow-up; for now they're useful as composable building blocks.

	TRANSPOSE: ([range]) => {
		if (!Array.isArray(range)) return [[range]]
		if (!Array.isArray(range[0])) return [range]   // 1D → single row
		const rows = range.length, cols = range[0].length
		const out = []
		for (let c = 0; c < cols; c++) {
			const row = []
			for (let r = 0; r < rows; r++) row.push(range[r][c])
			out.push(row)
		}
		return out
	},
	// FILTER(range, condition) — keeps rows where `condition[i]` is truthy.
	// Sheets supports multiple conditions; we'll do v1 with a single boolean
	// array and extend later if needed.
	FILTER: ([range, include]) => {
		if (!Array.isArray(range)) return range
		const inc = flatten([include])
		const out = range.filter((_, i) => !!inc[i])
		return out.length ? out : '#N/A'
	},
	// SORT(range, [sort_col], [is_ascending])
	SORT: ([range, sortCol, asc]) => {
		if (!Array.isArray(range)) return range
		const isMatrix = Array.isArray(range[0])
		const rows = isMatrix ? range.map(r => [...r]) : range.map(v => [v])
		const col  = sortCol !== undefined ? toNum(sortCol) - 1 : 0
		const dir  = (asc === false || asc === 0) ? -1 : 1
		rows.sort((a, b) => {
			const av = a[col], bv = b[col]
			const an = Number(av), bn = Number(bv)
			if (!isNaN(an) && !isNaN(bn) && av !== '' && bv !== '') return dir * (an - bn)
			return dir * String(av).localeCompare(String(bv))
		})
		return isMatrix ? rows : rows.map(r => r[0])
	},
	UNIQUE: ([range]) => {
		if (!Array.isArray(range)) return range
		const isMatrix = Array.isArray(range[0])
		const seen = new Set(), out = []
		for (const row of range) {
			const key = isMatrix ? JSON.stringify(row) : String(row)
			if (seen.has(key)) continue
			seen.add(key); out.push(row)
		}
		return out
	},
	// SEQUENCE(rows, [cols], [start], [step]) — numeric grid generator.
	SEQUENCE: ([rows, cols, start, step]) => {
		const r = Math.max(1, toNum(rows))
		const c = cols  !== undefined ? Math.max(1, toNum(cols))  : 1
		const s = start !== undefined ? toNum(start) : 1
		const st = step  !== undefined ? toNum(step)  : 1
		const out = []
		let v = s
		for (let i = 0; i < r; i++) {
			const row = []
			for (let j = 0; j < c; j++) { row.push(v); v += st }
			out.push(c === 1 ? row[0] : row)
		}
		return out
	},

	// ── Financial ────────────────────────────────────────────────────────────
	//
	// Standard Excel/Sheets formulas. Rates are per-period; sign convention is
	// "cash flow positive when received". PMT defaults assume payment-at-end
	// of period (`type=0`); pass `1` for payment-at-start.

	// PMT(rate, nper, pv, [fv], [type])
	PMT: ([rate, nper, pv, fv, type]) => {
		const r = toNum(rate), n = toNum(nper), p = toNum(pv)
		const f = fv !== undefined ? toNum(fv) : 0
		const t = type !== undefined ? toNum(type) : 0
		if (n === 0) return '#NUM!'
		if (r === 0) return -(p + f) / n
		const pvf = Math.pow(1 + r, n)
		return -(p * pvf + f) * r / ((pvf - 1) * (1 + r * t))
	},
	// FV(rate, nper, pmt, [pv], [type])
	FV: ([rate, nper, pmt, pv, type]) => {
		const r = toNum(rate), n = toNum(nper), pm = toNum(pmt)
		const p = pv !== undefined ? toNum(pv) : 0
		const t = type !== undefined ? toNum(type) : 0
		if (r === 0) return -(p + pm * n)
		const pvf = Math.pow(1 + r, n)
		return -(p * pvf + pm * (1 + r * t) * (pvf - 1) / r)
	},
	// PV(rate, nper, pmt, [fv], [type])
	PV: ([rate, nper, pmt, fv, type]) => {
		const r = toNum(rate), n = toNum(nper), pm = toNum(pmt)
		const f = fv !== undefined ? toNum(fv) : 0
		const t = type !== undefined ? toNum(type) : 0
		if (r === 0) return -(pm * n + f)
		const pvf = Math.pow(1 + r, n)
		return -(pm * (1 + r * t) * (pvf - 1) / r + f) / pvf
	},
	// NPV(rate, value1, value2, ...) — values are end-of-period cash flows.
	NPV: ([rate, ...values]) => {
		const r = toNum(rate)
		const flat = flatten(values).map(toNum)
		let npv = 0
		for (let i = 0; i < flat.length; i++) npv += flat[i] / Math.pow(1 + r, i + 1)
		return npv
	},
	// IRR(values, [guess]) — Newton-Raphson on NPV. Returns the per-period
	// rate that makes NPV zero. Throws #NUM! if no convergence in 100 iters.
	IRR: ([values, guess]) => {
		const flow = flatten([values]).map(toNum)
		if (flow.length < 2) return '#NUM!'
		let r = guess !== undefined ? toNum(guess) : 0.1
		for (let iter = 0; iter < 100; iter++) {
			let npv = 0, dnpv = 0
			for (let i = 0; i < flow.length; i++) {
				const d = Math.pow(1 + r, i)
				npv  += flow[i] / d
				dnpv -= i * flow[i] / (d * (1 + r))
			}
			if (Math.abs(npv) < 1e-9) return r
			if (dnpv === 0) return '#NUM!'
			r = r - npv / dnpv
		}
		return '#NUM!'
	},
}

// ─── Parser (recursive descent) ───────────────────────────────────────────────
function createParser(tokens, getCellValue, getRangeValues, getSheetCellValue, getSheetRangeValues, resolveNamedRange) {
	getSheetCellValue   = getSheetCellValue   || ((sheet, ref) => getCellValue(ref))
	getSheetRangeValues = getSheetRangeValues || ((sheet, s, e) => getRangeValues(s, e))
	resolveNamedRange   = resolveNamedRange   || (() => null)

	// Shared resolution path for both `T.NAME` and `T.COLREF`-as-named-range.
	// Returns either a scalar value or a 2D matrix depending on the binding.
	function _resolveBinding({ sheet, start, end }) {
		if (start === end) {
			return sheet ? getSheetCellValue(sheet, start) : getCellValue(start)
		}
		return sheet ? getSheetRangeValues(sheet, start, end) : getRangeValues(start, end)
	}
	let pos = 0
	const peek = (off=0) => tokens[pos+off]
	const next = ()      => tokens[pos++]
	const expect = type  => {
		const t = tokens[pos++]
		if (!t || t.t !== type) throw new Error('Expected ' + type)
		return t
	}

	function expr()       { return comparison() }

	function comparison() {
		let l = concat()
		while (peek()?.t===T.OP && ['=','<>','>','<','>=','<='].includes(peek().v)) {
			const op=next().v, r=concat()
			switch(op) {
				case '=':  l = _str(l).toLowerCase()===_str(r).toLowerCase() || toNum(l)===toNum(r); break
				case '<>': l = _str(l).toLowerCase()!==_str(r).toLowerCase(); break
				case '>':  l = toNum(l)>toNum(r);  break
				case '<':  l = toNum(l)<toNum(r);  break
				case '>=': l = toNum(l)>=toNum(r); break
				case '<=': l = toNum(l)<=toNum(r); break
			}
		}
		return l
	}

	function concat() {
		let l = add()
		while (peek()?.t===T.OP && peek().v==='&') {
			next()
			const r = add()
			l = _str(l) + _str(r)
		}
		return l
	}

	function add() {
		let l = mul()
		while (peek()?.t===T.OP && (peek().v==='+'||peek().v==='-')) {
			const op=next().v, r=mul()
			if (isErr(l)) return l
			if (isErr(r)) return r
			const ln = toNumStrict(l); if (isErr(ln)) return ln
			const rn = toNumStrict(r); if (isErr(rn)) return rn
			l = op==='+' ? ln+rn : ln-rn
		}
		return l
	}

	function mul() {
		let l = pow()
		while (peek()?.t===T.OP && (peek().v==='*'||peek().v==='/')) {
			const op=next().v, r=pow()
			if (isErr(l)) return l
			if (isErr(r)) return r
			const ln = toNumStrict(l); if (isErr(ln)) return ln
			const rn = toNumStrict(r); if (isErr(rn)) return rn
			if (op==='/') { if (rn===0) return '#DIV/0!'; l = ln/rn }
			else l = ln*rn
		}
		return l
	}

	function pow() {
		const b = unary()
		if (peek()?.t===T.OP && peek().v==='^') {
			next()
			const bn = toNumStrict(b); if (isErr(bn)) return bn
			const en = toNumStrict(unary()); if (isErr(en)) return en
			return Math.pow(bn, en)
		}
		return b
	}

	function unary() {
		if (peek()?.t===T.OP && peek().v==='-') { next(); const n = toNumStrict(primary()); return isErr(n) ? n : -n }
		if (peek()?.t===T.OP && peek().v==='+') { next(); const n = toNumStrict(primary()); return n }
		let v = primary()
		if (peek()?.t===T.OP && peek().v==='%') { next(); const n = toNumStrict(v); return isErr(n) ? n : n/100 }
		return v
	}

	function primary() {
		const tok = peek()
		if (!tok) throw new Error('Unexpected end')

		if (tok.t===T.NUM)  { next(); return tok.v }
		if (tok.t===T.STR)  { next(); return tok.v }
		if (tok.t===T.BOOL) { next(); return tok.v }
		if (tok.t===T.ERR)  { next(); return tok.v }

		if (tok.t===T.REF) {
			next()
			if (peek()?.t===T.COLON) {
				next()
				const endTok = next()
				if (!endTok || (endTok.t!==T.REF && endTok.t!==T.COLREF)) throw new Error('Bad range')
				const endRef = endTok.t===T.COLREF
					? `${endTok.v}${tok.v.match(/[0-9]+$/)[0]}`
					: endTok.v
				return getRangeValues(tok.v, endRef)
			}
			return getCellValue(tok.v)
		}

		if (tok.t===T.COLREF) {
			next()
			if (peek()?.t===T.COLON) {
				next()
				const endTok = next()
				if (!endTok || (endTok.t!==T.COLREF && endTok.t!==T.REF)) throw new Error('Bad col range')
				const endCol = endTok.t===T.REF ? endTok.v.match(/^[A-Z]+/)[0] : endTok.v
				return getRangeValues(`${tok.v}1`, `${endCol}1048576`)
			}
			// COLREF without a trailing `:` — the tokenizer emits all-letter
			// identifiers as COLREF, so a name like "Revenue" lands here too.
			// Try to resolve it as a named range; otherwise this is the same
			// as a bare unresolved identifier, which Excel/Sheets surface as
			// #NAME?, not #REF!.
			const resolvedCR = resolveNamedRange?.(tok.v)
			if (resolvedCR) return _resolveBinding(resolvedCR)
			return '#NAME?'
		}

		if (tok.t===T.SHEETREF) {
			next()
			if (peek()?.t===T.COLON) {
				next()
				const endTok = next()
				if (!endTok || (endTok.t!==T.REF && endTok.t!==T.SHEETREF && endTok.t!==T.COLREF)) throw new Error('Bad sheet range')
				const endRef = endTok.t===T.SHEETREF ? endTok.v : (endTok.t===T.COLREF ? `${endTok.v}1048576` : endTok.v)
				return getSheetRangeValues(tok.sheet, tok.v, endRef)
			}
			return getSheetCellValue(tok.sheet, tok.v)
		}

		if (tok.t===T.SHEETCOL) {
			next()
			if (peek()?.t===T.COLON) {
				next()
				const endTok = next()
				const endCol = endTok ? (endTok.t===T.SHEETCOL||endTok.t===T.COLREF ? endTok.v : endTok.v.match(/^[A-Z]+/)?.[0] || tok.v) : tok.v
				return getSheetRangeValues(tok.sheet, `${tok.v}1`, `${endCol}1048576`)
			}
			return '#REF!'
		}

		if (tok.t===T.FN) {
			next()
			expect(T.LP)
			const args = []
			while (peek()?.t !== T.RP) {
				if (!peek()) throw new Error('Unclosed (')
				args.push(expr())
				if (peek()?.t===T.COMMA) next()
			}
			expect(T.RP)
			const fn = FUNCTIONS[tok.v]
			if (!fn) return '#NAME?'
			try { return fn(args) } catch(e) { return '#VALUE!' }
		}

		if (tok.t===T.NAME) {
			next()
			const resolved = resolveNamedRange?.(tok.v)
			if (!resolved) return '#NAME?'
			return _resolveBinding(resolved)
		}

		if (tok.t===T.LP) {
			next()
			const v = expr()
			expect(T.RP)
			return v
		}

		next(); return 0
	}

	return expr
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function evaluate(
	formula,
	getCellValue,
	getRangeValues,
	getSheetCellValue,
	getSheetRangeValues,
	resolveNamedRange,
) {
	try {
		const tokens = tokenize(formula)
		if (!tokens.length) return ''
		return createParser(
			tokens, getCellValue, getRangeValues, getSheetCellValue, getSheetRangeValues, resolveNamedRange,
		)()
	} catch(e) {
		return '#ERROR!'
	}
}

const _fnNames = Object.keys(FUNCTIONS).sort()

export function getFunctionNames() { return _fnNames }
