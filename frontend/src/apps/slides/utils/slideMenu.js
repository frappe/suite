import { deleteSlide, duplicateSlide } from '@/apps/slides/stores/slide'

export const buildSlideContextOptions = ({ index, openLayoutDialog }) => [
	{
		label: 'New',
		icon: 'lucide-plus',
		onClick: () => openLayoutDialog(index),
	},
	{
		label: 'Duplicate',
		icon: 'lucide-copy',
		onClick: () => duplicateSlide(index),
	},
	{
		label: 'Delete',
		icon: 'lucide-trash-2',
		theme: 'red',
		onClick: () => deleteSlide(false, index),
	},
]
