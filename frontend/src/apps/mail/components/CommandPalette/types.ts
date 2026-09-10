export interface MailSearchFilterBadge {
	key: string
	value: string
	displayValue: string
}

export interface MailContactSuggestion {
	resultType: 'mail-contact'
	value: string
	label: string
	email: string
	name?: string
	user_image?: string
}

export interface MailFilterSuggestion {
	resultType: 'mail-filter-suggestion'
	value: string
	label: string
	filterKey: string
	filterValue: string
	icon: string
	iconClass?: string
}
