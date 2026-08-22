import { h } from 'vue'

import { pendingShapeType, pendingShapePreset } from '@/apps/slides/stores/element'

const armTool = (shapeType, preset = {}) => {
	pendingShapePreset.value = preset
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

export const shapeTools = [
	{
		label: 'Rectangle',
		icon: makeIcon([h('rect', { x: '2', y: '5', width: '20', height: '14' })]),
		onClick: () => armTool('rectangle'),
	},
	{
		label: 'Oval',
		icon: makeIcon([h('ellipse', { cx: '12', cy: '12', rx: '10', ry: '7' })]),
		onClick: () => armTool('oval'),
	},
	{
		label: 'Diamond',
		icon: makeIcon([h('polygon', { points: '12,2 22,12 12,22 2,12' })]),
		onClick: () => armTool('diamond'),
	},
	{
		label: 'Triangle',
		icon: makeIcon([h('polygon', { points: '12,2 22,21 2,21' })]),
		onClick: () => armTool('triangle'),
	},
	{
		label: 'Pentagon',
		icon: makeIcon([h('polygon', { points: '12,2 21.5,8.9 17.9,20.1 6.1,20.1 2.5,8.9' })]),
		onClick: () => armTool('pentagon'),
	},
]

const round = { 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }

export const lineTools = [
	{
		label: 'Line',
		icon: makeIcon([h('line', { x1: '3', y1: '12', x2: '21', y2: '12', ...round })]),
		onClick: () => armTool('line', { markerStart: 'none', markerEnd: 'none' }),
	},
	{
		label: 'Arrow',
		icon: makeIcon([h('path', { d: 'M3 12h18M15 6l6 6-6 6', ...round })]),
		onClick: () => armTool('line', { markerStart: 'none', markerEnd: 'arrow' }),
	},
	{
		label: 'Double arrow',
		icon: makeIcon([h('path', { d: 'M3 12h18M9 6l-6 6 6 6M15 6l6 6-6 6', ...round })]),
		onClick: () => armTool('line', { markerStart: 'arrow', markerEnd: 'arrow' }),
	},
	{
		label: 'Connector',
		icon: makeIcon([
			h('rect', { x: '2', y: '3', width: '7', height: '7' }),
			h('rect', { x: '15', y: '14', width: '7', height: '7' }),
			h('line', { x1: '9', y1: '10', x2: '15', y2: '14' }),
		]),
		onClick: () => armTool('connector', { route: 'straight' }),
	},
	{
		label: 'Elbow connector',
		icon: makeIcon([
			h('rect', { x: '2', y: '3', width: '7', height: '7' }),
			h('rect', { x: '15', y: '14', width: '7', height: '7' }),
			h('path', { d: 'M9 6.5h3.5v11H15' }),
		]),
		onClick: () => armTool('connector', { route: 'elbow' }),
	},
]
