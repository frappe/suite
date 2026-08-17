// Pure config factories for SheetEditor toolbar dropdowns.
// Each factory takes a map of action callbacks and returns a Frappe UI Dropdown options array.

export function buildAlignOptions({ setAlign, setValign }) {
  return [
    { group: 'Horizontal', options: [
      { label: 'Left',   icon: 'lucide-align-left',   onClick: () => setAlign('left')   },
      { label: 'Center', icon: 'lucide-align-center', onClick: () => setAlign('center') },
      { label: 'Right',  icon: 'lucide-align-right',  onClick: () => setAlign('right')  },
    ]},
    { group: 'Vertical', options: [
      { label: 'Top',    icon: 'lucide-arrow-up',   onClick: () => setValign('top')    },
      { label: 'Middle', icon: 'lucide-minus', onClick: () => setValign('middle') },
      { label: 'Bottom', icon: 'lucide-arrow-down', onClick: () => setValign('bottom') },
    ]},
  ]
}

export function buildBorderOptions({ applyBorder }) {
  return [
    { group: 'Apply to selection', options: [
      { label: 'All borders',     icon: 'lucide-grid-2x2', onClick: () => applyBorder('all')     },
      { label: 'Outside borders', icon: 'lucide-square',   onClick: () => applyBorder('outside') },
      { label: 'Inner borders',   icon: 'lucide-plus',     onClick: () => applyBorder('inner')   },
    ]},
    { group: 'Single side', options: [
      { label: 'Top border',    icon: 'lucide-arrow-up',    onClick: () => applyBorder('top')    },
      { label: 'Bottom border', icon: 'lucide-arrow-down',  onClick: () => applyBorder('bottom') },
      { label: 'Left border',   icon: 'lucide-arrow-left',  onClick: () => applyBorder('left')   },
      { label: 'Right border',  icon: 'lucide-arrow-right', onClick: () => applyBorder('right')  },
    ]},
    { group: 'Remove', options: [
      { label: 'No border', icon: 'lucide-square-x', theme: 'red', onClick: () => applyBorder('none') },
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
      { label: 'Wrap text',        icon: 'lucide-corner-down-left', onClick: () => toggleWrap()              },
      { label: 'Format painter',   icon: 'lucide-paint-roller',  onClick: () => toggleFormatPainter()     },
      { label: 'Clear formatting', icon: 'lucide-eraser',        onClick: () => clearFormatting()         },
    ]},
    { group: 'Numbers', options: [
      { label: 'Decrease decimal places', icon: 'lucide-minus', onClick: () => adjustDecimals(-1) },
      { label: 'Increase decimal places', icon: 'lucide-plus',  onClick: () => adjustDecimals(+1) },
    ]},
    { group: 'Cells', options: [
      { label: 'Conditional formatting', icon: 'lucide-blend', onClick: () => openCfDialog(null)        },
      { label: 'Insert hyperlink',       icon: 'lucide-link',  onClick: () => openHyperlinkDialog()     },
      { label: 'Merge / unmerge',        icon: 'lucide-maximize-2', onClick: () => toggleMerge()             },
      { label: 'Toggle filter',          icon: 'lucide-filter',     onClick: () => toggleSortFilter()        },
      { label: 'Smart Fill (Ctrl+E)',    icon: 'lucide-zap',        onClick: () => runSmartFill?.()          },
    ]},
    { group: 'Borders', options: [
      { label: 'All borders',     icon: 'lucide-grid-2x2', onClick: () => applyBorder('all')     },
      { label: 'Outside borders', icon: 'lucide-square',   onClick: () => applyBorder('outside') },
      { label: 'No border',       icon: 'lucide-square-x', onClick: () => applyBorder('none')    },
    ]},
    { group: 'View', options: [
      { label: 'Zoom in',    icon: 'lucide-zoom-in',  onClick: () => zoomBy(+0.1)  },
      { label: 'Zoom out',   icon: 'lucide-zoom-out', onClick: () => zoomBy(-0.1)  },
      { label: 'Reset zoom', icon: 'lucide-minimize', onClick: () => resetZoom()   },
    ]},
    { group: 'Insert', options: [
      { label: 'Pivot table…', icon: 'lucide-layout',      onClick: () => openPivotDialog() },
      { label: 'Chart…',       icon: 'lucide-chart-bar',   onClick: () => openChartDialog() },
    ]},
    { group: 'Workbook', options: [
      { label: 'Named ranges…', icon: 'lucide-bookmark', onClick: () => openNamedRangesDialog() },
    ]},
  ]
}
