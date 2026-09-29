// What the DMARC and TLS report pages share: the period filter and how a rate reads.

// The themes frappe-ui's Badge knows; there is no orange, amber is the warning step.
export type BadgeTheme = 'gray' | 'green' | 'red' | 'amber' | 'blue'

// Below this share of passing mail (DMARC) or successful sessions (TLS) the rate is shown as
// something to act on.
export const RATE_WARN_BELOW = 90

export const DEFAULT_PERIOD = '30'

export const PERIOD_OPTIONS = [
	{ label: __('Last 7 days'), value: '7' },
	{ label: __('Last 30 days'), value: '30' },
	{ label: __('Last 90 days'), value: '90' },
	// Everything Suite Cloud still holds; how long that is depends on its retention setting.
	{ label: __('All reports'), value: '0' },
]

export const formatRate = (rate: number | null | undefined) => (rate == null ? '—' : `${rate}%`)

export const rateTheme = (rate: number | null | undefined): BadgeTheme => {
	if (rate == null) return 'gray'
	return rate < RATE_WARN_BELOW ? 'red' : 'green'
}

export const share = (part: number, whole: number) => (whole ? Math.round((part * 100) / whole) : null)
