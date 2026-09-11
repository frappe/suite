// A domain's status as the admin API reports it; the list, the detail page and the filter all
// read the same value so a domain never looks Active in one place and Pending in another.
export type DomainStatus = 'Active' | 'Pending Verification' | 'Disabled'

export type BadgeTheme = 'green' | 'amber' | 'gray'

export const DOMAIN_STATUSES: DomainStatus[] = ['Active', 'Pending Verification', 'Disabled']

const THEMES: Record<DomainStatus, BadgeTheme> = {
	Active: 'green',
	'Pending Verification': 'amber',
	Disabled: 'gray',
}

export const domainStatusLabel = (status: DomainStatus) =>
	({
		Active: __('Active'),
		'Pending Verification': __('Pending Verification'),
		Disabled: __('Disabled'),
	})[status]

export const domainStatusBadge = (status?: DomainStatus) =>
	status
		? { label: domainStatusLabel(status), theme: THEMES[status] }
		: { label: '', theme: 'gray' as BadgeTheme }

export const domainStatusOptions = () => [
	{ label: __('All'), value: 'All' },
	...DOMAIN_STATUSES.map((status) => ({ label: domainStatusLabel(status), value: status })),
]
