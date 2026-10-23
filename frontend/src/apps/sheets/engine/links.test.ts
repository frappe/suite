import { describe, expect, it } from 'vitest'

import { detectHyperlink, isAutoLinkText } from './links.js'

describe('detectHyperlink', () => {
  it('accepts full http(s) URLs as-is', () => {
    expect(detectHyperlink('https://frappe.io/')).toBe('https://frappe.io/')
    expect(detectHyperlink('http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c')
    expect(detectHyperlink('  https://frappe.io  ')).toBe('https://frappe.io')
  })

  it('prefixes www. and bare common-TLD domains with https://', () => {
    expect(detectHyperlink('www.frappe.io')).toBe('https://www.frappe.io')
    expect(detectHyperlink('frappe.io')).toBe('https://frappe.io')
    expect(detectHyperlink('frappe.io/sheets?x=1')).toBe('https://frappe.io/sheets?x=1')
    expect(detectHyperlink('sub.domain.google.com')).toBe('https://sub.domain.google.com')
  })

  it('keeps URLs with @ in the path when a scheme is present', () => {
    expect(detectHyperlink('https://medium.com/@user/post')).toBe('https://medium.com/@user/post')
  })

  it('rejects non-URL cell values', () => {
    expect(detectHyperlink('hello world')).toBe(null) // spaces
    expect(detectHyperlink('see frappe.io today')).toBe(null) // not whole-cell
    expect(detectHyperlink('=HYPERLINK("https://x.com")')).toBe(null)
    expect(detectHyperlink('3.14')).toBe(null) // numeric
    expect(detectHyperlink('file.txt')).toBe(null) // uncommon TLD
    expect(detectHyperlink('v1.2.3')).toBe(null)
    expect(detectHyperlink('')).toBe(null)
    expect(detectHyperlink(42)).toBe(null)
    expect(detectHyperlink(null)).toBe(null)
  })

  it('rejects emails and schemeless userinfo tricks', () => {
    expect(detectHyperlink('user@gmail.com')).toBe(null)
    expect(detectHyperlink('evil.com@127.0.0.1')).toBe(null)
  })

  it('rejects non-http schemes', () => {
    expect(detectHyperlink('javascript:alert(1)')).toBe(null)
    expect(detectHyperlink('ftp://host/file')).toBe(null)
  })
})

describe('isAutoLinkText', () => {
  it('true when the text is exactly the URL the link points at', () => {
    expect(isAutoLinkText('https://frappe.io/', 'https://frappe.io/')).toBe(true)
    expect(isAutoLinkText('frappe.io', 'https://frappe.io')).toBe(true)
    expect(isAutoLinkText('www.frappe.io', 'https://www.frappe.io')).toBe(true)
  })

  it('false for custom display text or a different target', () => {
    expect(isAutoLinkText('Frappe website', 'https://frappe.io/')).toBe(false)
    expect(isAutoLinkText('frappe.io', 'https://other.com')).toBe(false)
    expect(isAutoLinkText('', 'https://frappe.io/')).toBe(false)
    expect(isAutoLinkText('https://frappe.io/', null)).toBe(false)
  })
})
