// Pure config factories for SheetEditor toolbar dropdowns.
// Each factory takes a map of action callbacks and returns a Frappe UI Dropdown options array.

export function buildAlignOptions({ setAlign, setValign }) {
  return [
    { group: 'Horizontal', options: [
      { label: 'Left',   icon: 'align-left',   onClick: () => setAlign('left')   },
      { label: 'Center', icon: 'align-center', onClick: () => setAlign('center') },
      { label: 'Right',  icon: 'align-right',  onClick: () => setAlign('right')  },
    ]},
    { group: 'Vertical', options: [
      { label: 'Top',    icon: 'arrow-up',   onClick: () => setValign('top')    },
      { label: 'Middle', icon: 'minus',      onClick: () => setValign('middle') },
      { label: 'Bottom', icon: 'arrow-down', onClick: () => setValign('bottom') },
    ]},
  ]
}

export function buildBorderOptions({ applyBorder }) {
  return [
    { group: 'Apply to selection', options: [
      { label: 'All borders',     icon: 'grid',         onClick: () => applyBorder('all')     },
      { label: 'Outside borders', icon: 'square',       onClick: () => applyBorder('outside') },
      { label: 'Inner borders',   icon: 'plus',         onClick: () => applyBorder('inner')   },
    ]},
    { group: 'Single side', options: [
      { label: 'Top border',    icon: 'arrow-up',    onClick: () => applyBorder('top')    },
      { label: 'Bottom border', icon: 'arrow-down',  onClick: () => applyBorder('bottom') },
      { label: 'Left border',   icon: 'arrow-left',  onClick: () => applyBorder('left')   },
      { label: 'Right border',  icon: 'arrow-right', onClick: () => applyBorder('right')  },
    ]},
    { group: 'Remove', options: [
      { label: 'No border', icon: 'x-square', theme: 'red', onClick: () => applyBorder('none') },
    ]},
  ]
}

export function buildMoreToolbarOptions({
  toggleFmt, toggleWrap, toggleFormatPainter, clearFormatting,
  adjustDecimals, openCfDialog, openHyperlinkDialog, toggleMerge,
  toggleSortFilter, applyBorder, zoomBy, resetZoom, openPivotDialog,
  openChartDialog, openNamedRangesDialog, runSmartFill,
}) {
  return [
    { group: 'Format', options: [
      { label: 'Strikethrough',    icon: 'lucide-strikethrough', onClick: () => toggleFmt('strikethrough') },
      { label: 'Wrap text',        icon: 'corner-down-left',     onClick: () => toggleWrap()              },
      { label: 'Format painter',   icon: 'lucide-paint-roller',  onClick: () => toggleFormatPainter()     },
      { label: 'Clear formatting', icon: 'lucide-eraser',        onClick: () => clearFormatting()         },
    ]},
    { group: 'Numbers', options: [
      { label: 'Decrease decimal places', icon: 'minus', onClick: () => adjustDecimals(-1) },
      { label: 'Increase decimal places', icon: 'plus',  onClick: () => adjustDecimals(+1) },
    ]},
    { group: 'Cells', options: [
      { label: 'Conditional formatting', icon: 'lucide-blend', onClick: () => openCfDialog(null)        },
      { label: 'Insert hyperlink',       icon: 'lucide-link',  onClick: () => openHyperlinkDialog()     },
      { label: 'Merge / unmerge',        icon: 'maximize-2',   onClick: () => toggleMerge()             },
      { label: 'Toggle filter',          icon: 'filter',       onClick: () => toggleSortFilter()        },
      { label: 'Smart Fill (Ctrl+E)',    icon: 'zap',          onClick: () => runSmartFill?.()          },
    ]},
    { group: 'Borders', options: [
      { label: 'All borders',     icon: 'grid',     onClick: () => applyBorder('all')     },
      { label: 'Outside borders', icon: 'square',   onClick: () => applyBorder('outside') },
      { label: 'No border',       icon: 'x-square', onClick: () => applyBorder('none')    },
    ]},
    { group: 'View', options: [
      { label: 'Zoom in',    icon: 'zoom-in',  onClick: () => zoomBy(+0.1)  },
      { label: 'Zoom out',   icon: 'zoom-out', onClick: () => zoomBy(-0.1)  },
      { label: 'Reset zoom', icon: 'minimize', onClick: () => resetZoom()   },
    ]},
    { group: 'Insert', options: [
      { label: 'Pivot table…', icon: 'layout',      onClick: () => openPivotDialog() },
      { label: 'Chart…',       icon: 'bar-chart-2', onClick: () => openChartDialog() },
    ]},
    { group: 'Workbook', options: [
      { label: 'Named ranges…', icon: 'bookmark', onClick: () => openNamedRangesDialog() },
    ]},
  ]
}
