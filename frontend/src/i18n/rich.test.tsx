// @vitest-environment node
import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { rich } from './context'

const text = (n: unknown): string => {
  if (typeof n === 'string') return n
  if (Array.isArray(n)) return n.map(text).join('')
  if (isValidElement(n)) {
    const el = n as ReactElement<{ children?: unknown }>
    const tag = typeof el.type === 'string' ? el.type : 'x'
    return `<${tag}>${text(el.props.children)}</${tag}>`
  }
  return ''
}

describe('rich', () => {
  it('renders built-in tags and leaves plain text alone', () => {
    expect(text(rich('plain'))).toBe('plain')
    expect(text(rich('Save <b>first</b>, then <code>AIza</code> and <em>their</em> terms.'))).toBe(
      'Save <strong>first</strong>, then <code>AIza</code> and <em>their</em> terms.',
    )
  })
  it('hands custom tags to their renderer and drops unknown ones', () => {
    const out = rich('Open <a>the site</a> now <zz>x</zz>', { a: (c) => `[${text(c)}]` })
    expect(text(out)).toBe('Open <span>[the site]</span> now x')
  })
})
