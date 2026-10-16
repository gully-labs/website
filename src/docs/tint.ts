/* Hand-rolled syntax tinting for the four languages the docs show. Not a parser: each language is one
   ordered list of patterns, tried left to right at every position; text no pattern claims is plain. */

export type Lang = 'json' | 'js' | 'html' | 'bash' | 'text'
export type TokenKind = 'plain' | 'key' | 'string' | 'number' | 'keyword' | 'comment' | 'punct' | 'tag' | 'attr' | 'fn'
export interface Token {
  k: TokenKind
  v: string
}

type Rule = [RegExp, TokenKind]

const RULES: Record<Exclude<Lang, 'text'>, Rule[]> = {
  json: [
    [/"(?:[^"\\]|\\.)*"(?=\s*:)/y, 'key'],
    [/"(?:[^"\\]|\\.)*"/y, 'string'],
    [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, 'number'],
    [/\b(?:true|false|null)\b/y, 'keyword'],
    [/[{}[\],:]/y, 'punct'],
  ],
  js: [
    [/\/\/[^\n]*/y, 'comment'],
    [/\/\*[\s\S]*?\*\//y, 'comment'],
    [/`(?:[^`\\]|\\.)*`/y, 'string'],
    [/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/y, 'string'],
    [/\b(?:const|let|var|await|async|function|return|if|else|new|throw|of|for|try|catch|import|from|export)\b/y, 'keyword'],
    [/\b(?:true|false|null|undefined)\b/y, 'keyword'],
    [/\b\d+(?:\.\d+)?\b/y, 'number'],
    [/\b[A-Za-z_$][\w$]*(?=\()/y, 'fn'],
    [/[{}()[\];,.]/y, 'punct'],
  ],
  html: [
    [/<!--[\s\S]*?-->/y, 'comment'],
    [/<\/?[A-Za-z][\w-]*/y, 'tag'],
    [/\/?>/y, 'tag'],
    [/[A-Za-z-:]+(?==)/y, 'attr'],
    [/"[^"]*"|'[^']*'/y, 'string'],
    [/=/y, 'punct'],
  ],
  bash: [
    [/#[^\n]*/y, 'comment'],
    [/'[^']*'|"(?:[^"\\]|\\.)*"/y, 'string'],
    [/(?<=^|\n|\|\s?)[a-z][\w-]*/y, 'fn'],
    [/\s--?[A-Za-z][\w-]*/y, 'keyword'],
    [/\\$/my, 'punct'],
  ],
}

export function tint(code: string, lang: Lang): Token[] {
  if (lang === 'text') return [{ k: 'plain', v: code }]
  const rules = RULES[lang]
  const out: Token[] = []
  let plain = ''
  let i = 0
  outer: while (i < code.length) {
    for (const [re, k] of rules) {
      re.lastIndex = i
      const m = re.exec(code)
      if (m && m[0].length) {
        if (plain) out.push({ k: 'plain', v: plain })
        plain = ''
        out.push({ k, v: m[0] })
        i += m[0].length
        continue outer
      }
    }
    plain += code[i]
    i++
  }
  if (plain) out.push({ k: 'plain', v: plain })
  return out
}

/** Token colours: brand tokens only. */
export const TINT: Record<TokenKind, string> = {
  plain: 'var(--color-ink-2)',
  key: 'var(--color-gold)',
  string: 'var(--color-green)',
  number: 'var(--color-gold-hover)',
  keyword: 'var(--color-gold)',
  comment: 'var(--color-faint)',
  punct: 'var(--color-dim)',
  tag: 'var(--color-gold)',
  attr: 'var(--color-muted)',
  fn: 'var(--color-ink)',
}
