import { describe, expect, it } from 'vitest'

import { FONT_FAMILY_STACK } from '../utils/font-stacks.js'
import {
  cfFromXlsx,
  cfToXlsx,
  colWidthFromXlsx,
  colWidthToXlsx,
  commonFont,
  customHeightRows,
  refToRects,
  rowHeightFromXlsx,
  rowHeightToXlsx,
  styleFromXlsx,
  styleToXlsx,
  themePalette,
} from './xlsx-style.js'

describe('styleToXlsx / styleFromXlsx', () => {
  it('round-trips every format key a cell can carry', () => {
    const fmt = {
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      fontSize: 21,
      fontFamily: FONT_FAMILY_STACK.serif,
      color: '#ff0000',
      backgroundColor: '#cfe2f3',
      align: 'center',
      valign: 'top',
      textWrap: 'wrap',
      borderBottom: { style: 'medium', color: '#1f2937' },
      borderLeft: { style: 'thin', color: '#000000' },
    }
    const x = styleToXlsx(fmt)
    expect(x.font).toEqual({
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      size: 16,
      name: 'Georgia',
      color: { argb: 'FFFF0000' },
    })
    expect(x.fill).toEqual({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCFE2F3' } })
    expect(styleFromXlsx(x)).toEqual(fmt)
  })

  it('writes nothing for an unformatted cell', () => {
    expect(styleToXlsx({})).toEqual({})
    expect(styleToXlsx({ numberFormat: 'number' })).toEqual({})
  })

  it('spells out the default font around a partial one', () => {
    expect(styleToXlsx({ bold: true }).font).toEqual({ name: 'Calibri', size: 11, bold: true })
  })

  it("leaves out black text, white fills and the file's common font", () => {
    const font = { name: 'Arial', size: 10 }
    expect(
      styleFromXlsx(
        {
          font: { name: 'Arial', size: 10, bold: true, color: { theme: 1 } },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
        },
        { font },
      ),
    ).toEqual({ bold: true })
    // Google's 16 pt title on its Arial 10 sheet.
    expect(styleFromXlsx({ font: { name: 'Arial', size: 16 } }, { font })).toEqual({ fontSize: 21 })
    expect(styleFromXlsx({ font: { name: 'Comic Sans MS' } }, { font }).fontFamily).toBe(
      `"Comic Sans MS", ${FONT_FAMILY_STACK.inter}`,
    )
  })

  it('reads theme colours with their tint', () => {
    const theme = themePalette(null)
    expect(styleFromXlsx({ font: { color: { theme: 4 } } }, { theme })).toEqual({
      color: '#4472c4',
    })
    expect(styleFromXlsx({ font: { color: { theme: 0, tint: -0.5 } } }, { theme })).toEqual({
      color: '#808080',
    })
  })

  it("takes the theme colours from the file's theme", () => {
    const xml =
      '<a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1>' +
      '<a:lt1><a:srgbClr val="FEFEFE"/></a:lt1><a:accent1><a:srgbClr val="3366FF"/></a:accent1></a:clrScheme>'
    const t = themePalette(xml)
    expect(t.slice(0, 2)).toEqual(['FEFEFE', '111111'])
    expect(t[4]).toBe('3366FF')
    expect(t[5]).toBe('ED7D31')
  })
})

describe('commonFont', () => {
  it('is the most common name and size, where a missing size counts too', () => {
    // undefined: a cell with no style.
    const cells = [
      { font: { name: 'Arial' } },
      { font: { name: 'Arial' } },
      { font: { name: 'Arial', size: 16 } },
      undefined,
    ]
    expect(commonFont(cells)).toEqual({ name: 'Arial', size: undefined })
  })
})

describe('sizes', () => {
  it('column widths round-trip through Excel characters', () => {
    expect(colWidthToXlsx(100)).toBe(13.57)
    for (const px of [30, 64, 100, 153, 200, 400])
      expect(colWidthFromXlsx(colWidthToXlsx(px))).toBe(px)
    // Google's 21.88 characters.
    expect(colWidthFromXlsx(21.88)).toBe(158)
  })
  it('row heights round-trip through points', () => {
    expect(rowHeightToXlsx(24)).toBe(18)
    for (const px of [16, 21, 24, 40, 101]) expect(rowHeightFromXlsx(rowHeightToXlsx(px))).toBe(px)
  })
})

describe('customHeightRows', () => {
  it('lists the rows whose height was set by hand (customHeight), 0-based', () => {
    const xml =
      '<sheetData><row r="1" ht="30" customHeight="1"><c r="A1"/></row>' +
      '<row r="2" ht="21"><c r="A2"/></row><row customHeight="true" ht="40" r="5"/></sheetData>'
    expect([...customHeightRows(xml)]).toEqual([0, 4])
  })
})

describe('refToRects', () => {
  it('reads a multi-range sqref, absolute refs and single cells', () => {
    expect(refToRects('A1:B5 $D$2')).toEqual([
      { r0: 0, c0: 0, r1: 4, c1: 1 },
      { r0: 1, c0: 3, r1: 1, c1: 3 },
    ])
  })
})

describe('cfToXlsx / cfFromXlsx', () => {
  const range = { r0: 1, c0: 3, r1: 5, c1: 3 }
  const green = { backgroundColor: '#b7e1cd' }
  const rules = [
    { range, condition: { type: 'gt', value: '30000' }, format: green },
    {
      range,
      condition: { type: 'between', value: '1', value2: '5' },
      format: { color: '#ff0000' },
    },
    { range, condition: { type: 'eq', value: '7' }, format: green },
    { range, condition: { type: 'contains', value: 'North' }, format: green },
    { range, condition: { type: 'notcontains', value: 'a"b' }, format: green },
    { range, condition: { type: 'empty' }, format: green },
    { range, condition: { type: 'notempty' }, format: green },
    {
      range,
      kind: 'color-scale',
      scale: { variant: '2color', minColor: '#ffffff', maxColor: '#57bb8a' },
    },
    {
      range,
      kind: 'color-scale',
      scale: {
        variant: '3color',
        minColor: '#e67c73',
        midColor: '#ffd666',
        maxColor: '#57bb8a',
        midPercent: 0.4,
      },
    },
    { range, kind: 'data-bar', bar: { color: '#638ec6' } },
    { range, kind: 'icon-set', icons: { set: 'traffic3', thresholds: [0.25, 0.75] } },
  ] as const

  for (const rule of rules) {
    it(`round-trips ${rule.kind || rule.condition?.type}`, () => {
      const x = cfToXlsx({ ...rule, id: 1 } as never)
      expect(x?.ref).toBe('D2:D6')
      expect(cfFromXlsx(x!)).toEqual([rule])
    })
  }

  it('writes a greater-than rule the way Google does', () => {
    expect(cfToXlsx({ id: 1, ...rules[0] } as never)).toEqual({
      ref: 'D2:D6',
      rules: [
        {
          type: 'cellIs',
          operator: 'greaterThan',
          formulae: ['30000'],
          style: {
            fill: {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFB7E1CD' },
              bgColor: { argb: 'FFB7E1CD' },
            },
          },
        },
      ],
    })
  })

  // ExcelJS writes a containsText rule with no `text` attribute, which Google
  // reads as "contains nothing" and fills every cell; a quote in the text
  // also broke its formula.
  it('writes "contains" as the formula Excel uses, with the text quoted', () => {
    const rule = { id: 1, range, condition: { type: 'contains', value: 'say "hi"' }, format: green }
    const x = cfToXlsx(rule as never)!
    expect(x.rules[0]).toMatchObject({
      type: 'expression',
      formulae: ['NOT(ISERROR(SEARCH("say ""hi""",D2)))'],
    })
    expect(cfFromXlsx(x)).toEqual([{ range, condition: rule.condition, format: green }])
  })

  // An Excel formula rule is worked out for each cell, relative to the
  // range's top-left one. Ours can't evaluate formulas, so one that only
  // compares that cell becomes the matching rule; any other is kept as it
  // is, so it goes back out to Excel unchanged.
  it("reads a formula rule on the range's own cell as the matching rule", () => {
    const read = (f: string) =>
      cfFromXlsx({ ref: 'D2:D6', rules: [{ type: 'expression', formulae: [f], style: {} }] })[0]
        ?.condition
    expect(read('D2>100')).toEqual({ type: 'gt', value: '100' })
    expect(read('D2<=-2.5')).toEqual({ type: 'lte', value: '-2.5' })
    expect(read('D2<>0')).toEqual({ type: 'neq', value: '0' })
    expect(read('ISBLANK(D2)')).toEqual({ type: 'empty' })
    expect(read('LEN(TRIM(D2))=0')).toEqual({ type: 'empty' })
    expect(read('NOT(ISBLANK(D2))')).toEqual({ type: 'notempty' })
    expect(read('LEN(TRIM(D2))>0')).toEqual({ type: 'notempty' })
    // Another cell, or text: kept as the formula.
    expect(read('$C2>100')).toEqual({ type: 'formula', value: '=$C2>100' })
    expect(read('D2="Done"')).toEqual({ type: 'formula', value: '=D2="Done"' })
    expect(read('D3>100')).toEqual({ type: 'formula', value: '=D3>100' })
  })

  it('writes a kept formula rule back unchanged', () => {
    const rule = { id: 1, range, condition: { type: 'formula', value: '=$C2>100' }, format: green }
    expect(cfToXlsx(rule as never)!.rules[0]).toMatchObject({
      type: 'expression',
      formulae: ['$C2>100'],
    })
  })

  it("reads Excel's containsText rule by its text", () => {
    const got = cfFromXlsx({
      ref: 'D2:D6',
      rules: [{ type: 'containsText', operator: 'containsText', text: 'North', style: {} }],
    })
    expect(got).toEqual([{ range, condition: { type: 'contains', value: 'North' }, format: {} }])
  })

  it("reads Google's rule (fill in fgColor and bgColor) once per range", () => {
    const fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFB7E1CD' },
      bgColor: { argb: 'FFB7E1CD' },
    }
    const got = cfFromXlsx({
      ref: 'D2:D6 F2:F6',
      rules: [
        { type: 'cellIs', operator: 'greaterThan', formulae: ['30000'], style: { fill, font: {} } },
      ],
    })
    expect(got).toEqual([
      { range, condition: { type: 'gt', value: '30000' }, format: green },
      {
        range: { r0: 1, c0: 5, r1: 5, c1: 5 },
        condition: { type: 'gt', value: '30000' },
        format: green,
      },
    ])
  })
})
