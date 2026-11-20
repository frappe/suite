// Pure config factories for SheetEditor toolbar dropdowns.
// Each factory takes a map of action callbacks and returns a Frappe UI Dropdown options array.

export function buildAlignOptions({ setAlign, setValign }) {
  return [
    {
      group: 'Horizontal',
      options: [
        { label: 'Left', icon: 'lucide-align-left', onClick: () => setAlign('left') },
        { label: 'Center', icon: 'lucide-align-center', onClick: () => setAlign('center') },
        { label: 'Right', icon: 'lucide-align-right', onClick: () => setAlign('right') },
      ],
    },
    {
      group: 'Vertical',
      options: [
        { label: 'Top', icon: 'lucide-arrow-up', onClick: () => setValign('top') },
        { label: 'Middle', icon: 'lucide-minus', onClick: () => setValign('middle') },
        { label: 'Bottom', icon: 'lucide-arrow-down', onClick: () => setValign('bottom') },
      ],
    },
  ]
}

export function buildBorderOptions({ applyBorder }) {
  return [
    {
      group: 'Apply to selection',
      options: [
        { label: 'All borders', icon: 'lucide-grid-2x2', onClick: () => applyBorder('all') },
        { label: 'Outside borders', icon: 'lucide-square', onClick: () => applyBorder('outside') },
        { label: 'Inner borders', icon: 'lucide-plus', onClick: () => applyBorder('inner') },
      ],
    },
    {
      group: 'Single side',
      options: [
        { label: 'Top border', icon: 'lucide-arrow-up', onClick: () => applyBorder('top') },
        { label: 'Bottom border', icon: 'lucide-arrow-down', onClick: () => applyBorder('bottom') },
        { label: 'Left border', icon: 'lucide-arrow-left', onClick: () => applyBorder('left') },
        { label: 'Right border', icon: 'lucide-arrow-right', onClick: () => applyBorder('right') },
      ],
    },
    {
      group: 'Remove',
      options: [
        {
          label: 'No border',
          icon: 'lucide-square-x',
          theme: 'red',
          onClick: () => applyBorder('none'),
        },
      ],
    },
  ]
}
