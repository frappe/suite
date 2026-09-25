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

/**
 * The "…" overflow menu.
 *
 * `collapsed` mirrors the toolbar's `max-width: 1280px` breakpoint. An option
 * marked `inline: true` also has its own toolbar button, and that button is
 * only rendered above the breakpoint — so an uncollapsed toolbar drops those
 * options from the menu instead of listing them twice. Options left unmarked
 * have no toolbar button at any width; they must stay in the menu or they
 * become unreachable with the mouse.
 */
export function buildMoreToolbarOptions({
  toggleFmt, toggleWrap, toggleFormatPainter, clearFormatting,
  adjustDecimals, openCfDialog, openHyperlinkDialog, toggleMerge,
  toggleSortFilter, applyBorder, zoomBy, resetZoom, openPivotDialog,
  openChartDialog, openNamedRangesDialog, runSmartFill,
  collapsed = true,
}) {
  const groups = [
    { group: 'Format', options: [
      { label: 'Strikethrough',    icon: 'lucide-strikethrough',    inline: true, onClick: () => toggleFmt('strikethrough') },
      { label: 'Wrap text',        icon: 'lucide-corner-down-left', inline: true, onClick: () => toggleWrap()              },
      { label: 'Format painter',   icon: 'lucide-paint-roller',     inline: true, onClick: () => toggleFormatPainter()     },
      { label: 'Clear formatting', icon: 'lucide-eraser',           inline: true, onClick: () => clearFormatting()         },
    ]},
    { group: 'Numbers', options: [
      { label: 'Decrease decimal places', icon: 'lucide-minus', inline: true, onClick: () => adjustDecimals(-1) },
      { label: 'Increase decimal places', icon: 'lucide-plus',  inline: true, onClick: () => adjustDecimals(+1) },
    ]},
    { group: 'Cells', options: [
      { label: 'Conditional formatting', icon: 'lucide-blend',      inline: true, onClick: () => openCfDialog(null)    },
      { label: 'Insert hyperlink',       icon: 'lucide-link',       inline: true, onClick: () => openHyperlinkDialog() },
      { label: 'Merge / unmerge',        icon: 'lucide-maximize-2', inline: true, onClick: () => toggleMerge()         },
      { label: 'Toggle filter',          icon: 'lucide-filter',     inline: true, onClick: () => toggleSortFilter()    },
      { label: 'Smart Fill (Ctrl+E)',    icon: 'lucide-zap',                      onClick: () => runSmartFill?.()      },
    ]},
    { group: 'Borders', options: [
      { label: 'All borders',     icon: 'lucide-grid-2x2', inline: true, onClick: () => applyBorder('all')     },
      { label: 'Outside borders', icon: 'lucide-square',   inline: true, onClick: () => applyBorder('outside') },
      { label: 'No border',       icon: 'lucide-square-x', inline: true, onClick: () => applyBorder('none')    },
    ]},
    { group: 'View', options: [
      { label: 'Zoom in',    icon: 'lucide-zoom-in',  onClick: () => zoomBy(+0.1)  },
      { label: 'Zoom out',   icon: 'lucide-zoom-out', onClick: () => zoomBy(-0.1)  },
      { label: 'Reset zoom', icon: 'lucide-minimize', onClick: () => resetZoom()   },
    ]},
    { group: 'Insert', options: [
      { label: 'Pivot table…', icon: 'lucide-layout',                  onClick: () => openPivotDialog() },
      { label: 'Chart…',       icon: 'lucide-chart-bar', inline: true, onClick: () => openChartDialog() },
    ]},
    { group: 'Workbook', options: [
      { label: 'Named ranges…', icon: 'lucide-bookmark', onClick: () => openNamedRangesDialog() },
    ]},
  ]

  if (collapsed) return groups
  return groups
    .map((g) => ({ ...g, options: g.options.filter((o) => !o.inline) }))
    .filter((g) => g.options.length > 0)
}
