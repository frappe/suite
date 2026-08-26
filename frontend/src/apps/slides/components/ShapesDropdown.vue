<template>
	<Dropdown :options="shapeOptions" side="top" align="center" :offset="12">
		<template #default="{ open }">
			<div :class="triggerClass(open)">
				<LucideShapes class="size-4.5 stroke-[1.5] text-ink-gray-7" />
			</div>
		</template>
	</Dropdown>
</template>

<script setup>
import { h } from 'vue'
import { Dropdown } from 'frappe-ui'

import { pendingShapeType } from '@/apps/slides/stores/element'

const triggerClass = (open) => [
	'cursor-pointer rounded-4 p-2 hover:bg-surface-gray-3',
	{ 'bg-surface-gray-3': open },
]

const addShape = (shapeType) => {
	pendingShapeType.value = shapeType
}

const makeIcon = (children) => (_, { attrs }) =>
	h(
		'svg',
		{
			xmlns: 'http://www.w3.org/2000/svg',
			fill: 'none',
			viewBox: '0 0 24 24',
			stroke: 'currentColor',
			...attrs,
			class: ['stroke-[1.5]', attrs.class],
		},
		children,
	)

const shapeOptions = [
	{
		label: 'Rectangle',
		icon: makeIcon([h('rect', { x: '2', y: '5', width: '20', height: '14' })]),
		onClick: () => addShape('rectangle'),
	},
	{
		label: 'Oval',
		icon: makeIcon([h('ellipse', { cx: '12', cy: '12', rx: '10', ry: '7' })]),
		onClick: () => addShape('oval'),
	},
	{
		label: 'Diamond',
		icon: makeIcon([h('polygon', { points: '12,2 22,12 12,22 2,12' })]),
		onClick: () => addShape('diamond'),
	},
	{
		label: 'Triangle',
		icon: makeIcon([h('polygon', { points: '12,2 22,21 2,21' })]),
		onClick: () => addShape('triangle'),
	},
	{
		label: 'Pentagon',
		icon: makeIcon([
			h('polygon', { points: '12,2 21.5,8.9 17.9,20.1 6.1,20.1 2.5,8.9' }),
		]),
		onClick: () => addShape('pentagon'),
	},
	{
		label: 'Line',
		icon: makeIcon([h('line', { x1: '2', y1: '12', x2: '22', y2: '12' })]),
		onClick: () => addShape('line'),
	},
]
</script>
