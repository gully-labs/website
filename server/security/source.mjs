// Source handling shared by every input kind: scoping (what is in scope and why not), nSLOC, the
// prompt-injection guard and secret redaction. All source is untrusted data.

import crypto from 'node:crypto'

export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

const SOL_EXCLUDE_DIRS = /(^|\/)(lib|node_modules|test|tests|script|scripts|mocks?|out|cache|artifacts|\.github|forge-std|hardhat|typechain(-types)?)\//i
const DEP_PREFIX = /^(@[\w.-]+\/|lib\/|node_modules\/|forge-std\/|openzeppelin-contracts\/|solmate\/|solady\/)/i
const WEB_EXT = /\.(m?js|cjs|jsx|ts|tsx|mts|cts)$/i
const WEB_EXCLUDE = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next|\.nuxt|public|__tests__|__mocks__|test|tests|e2e|fixtures|migrations)\//i

export const languageOf = (p) => (/\.sol$/i.test(p) ? 'solidity' : /\.(ts|tsx|mts|cts)$/i.test(p) ? 'typescript' : WEB_EXT.test(p) ? 'javascript' : /\.json$/i.test(p) ? 'json' : 'other')

/** Files worth keeping from an archive for a scan kind ('contracts' | 'web2'). */
export function keepForKind(kind) {
  if (kind === 'web2') return (p) => (WEB_EXT.test(p) && !WEB_EXCLUDE.test(p) && !/\.min\.js$/i.test(p) && !/\.d\.ts$/i.test(p)) || /(^|\/)package(-lock)?\.json$/.test(p) || /(^|\/)\.env(\.[\w-]+)?$/.test(p)
  return (p) => /\.sol$/i.test(p) || /(^|\/)(foundry\.toml|remappings\.txt)$/.test(p)
}

/** In scope or not, with the reason when not. `deps` marks explorer sources with a dependency path. */
export function scopeOf(p, kind) {
  if (kind === 'web2') {
    if (!WEB_EXT.test(p)) return { inScope: false, reason: 'metadata' }
    if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(p)) return { inScope: false, reason: 'test file' }
    return { inScope: true, reason: null }
  }
  if (!/\.sol$/i.test(p)) return { inScope: false, reason: 'build configuration' }
  if (/\.(t|s)\.sol$/i.test(p)) return { inScope: false, reason: 'test or deploy script' }
  if (DEP_PREFIX.test(p) || SOL_EXCLUDE_DIRS.test(p)) return { inScope: false, reason: 'dependency, test or tooling' }
  return { inScope: true, reason: null }
}

/**
 * Splits C-like source (Solidity, JS, TS) into code and comments, line by line, honouring strings.
 * Returns { code: string[] (per line, comments removed), comments: [{ line, text }] }.
 */
export function splitComments(src) {
  const lines = String(src).split(/\r?\n/)
  const code = []
  const comments = []
  let inBlock = false
  let blockStart = 0
  let blockText = ''
  lines.forEach((line, idx) => {
    let out = ''
    let i = 0
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i)
        if (end < 0) {
          blockText += line.slice(i) + '\n'
          i = line.length
        } else {
          blockText += line.slice(i, end)
          comments.push({ line: blockStart + 1, text: blockText })
          inBlock = false
          i = end + 2
        }
        continue
      }
      const c = line[i]
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1
        while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1
        out += line.slice(i, j + 1)
        i = j + 1
        continue
      }
      if (c === '/' && line[i + 1] === '/') {
        comments.push({ line: idx + 1, text: line.slice(i + 2) })
        i = line.length
        continue
      }
      if (c === '/' && line[i + 1] === '*') {
        inBlock = true
        blockStart = idx
        blockText = ''
        i += 2
        continue
      }
      out += c
      i++
    }
    code.push(out)
  })
  if (inBlock) comments.push({ line: blockStart + 1, text: blockText })
  return { code, comments }
}

/** nSLOC: lines with code once comments and blank lines are removed. */
export function nsloc(src) {
  return splitComments(src).code.filter((l) => l.trim() !== '').length
}

/* ---------------------------------------------------- prompt-injection guard --- */

const INJECTION = [
  /\bignore\b.{0,40}\b(previous|prior|above|earlier|all|any|the|your)\b.{0,30}\b(instruction|prompt|rule|direction|guideline)s?/i,
  /\b(disregard|forget|override)\b.{0,40}\b(instruction|prompt|rule|system|guideline)s?/i,
  /\b(you are|act as|pretend to be|roleplay as)\b.{0,40}\b(ai|assistant|model|auditor|reviewer|llm|gpt|claude|chatbot)\b/i,
  /\b(ai|llm|gpt|claude|chatgpt|language model|auditor|reviewer|scanner|assistant)\b.{0,60}\b(must|should|shall|do not|don't|never|always)\b.{0,40}\b(report|flag|mention|find|say|output|mark|rate|classify)/i,
  /\b(report|output|return|respond with)\b.{0,30}\b(no|zero|0)\b.{0,20}\b(issues|vulnerabilit(y|ies)|findings|bugs)\b/i,
  /\b(this|the) (code|contract|function|repo|project) (is|has been) (fully )?(safe|secure|audited|verified|bug[- ]free)\b.{0,60}\b(ai|llm|model|scanner|reviewer|tool)s?\b/i,
  /<\/?\s*(system|instructions?|prompt|assistant|human|user)\s*>/i,
  /\b(system prompt|new instructions|jailbreak)\b/i,
  /^\s*(system|assistant|human)\s*:/im,
]

/** Comments that look addressed to an AI reviewer. */
export function findInjections(src) {
  const flags = []
  for (const c of splitComments(src).comments) {
    if (INJECTION.some((re) => re.test(c.text))) flags.push({ line: c.line, excerpt: c.text.replace(/\s+/g, ' ').trim().slice(0, 200) })
  }
  return flags
}

/**
 * The copy of a file the model sees: flagged comments replaced by a marker (line count unchanged, so
 * file:line stays right) and secrets redacted. Returns { text, flags, secrets }.
 */
export function prepareForModel(src) {
  const text0 = String(src)
  const flags = findInjections(text0)
  let lines = text0.split(/\r?\n/)
  if (flags.length) {
    const flagged = new Set(flags.map((f) => f.line))
    // Rebuild comments: blank out every flagged comment's text (keeping newlines).
    const out = []
    let inBlock = false
    let blockFlagged = false
    lines.forEach((line, idx) => {
      const n = idx + 1
      if (inBlock) {
        const end = line.indexOf('*/')
        if (blockFlagged) out.push(end < 0 ? '' : line.slice(end))
        else out.push(line)
        if (end >= 0) inBlock = false
        return
      }
      if (flagged.has(n)) {
        const sl = line.indexOf('//')
        const bl = line.indexOf('/*')
        const at = [sl, bl].filter((x) => x >= 0).sort((a, b) => a - b)[0]
        if (at === undefined) return void out.push(line)
        const marker = '/* [gully-security: comment removed: it looked like instructions to an AI reviewer] */'
        if (at === sl) return void out.push(line.slice(0, at) + marker)
        const end = line.indexOf('*/', at + 2)
        if (end >= 0) return void out.push(line.slice(0, at) + marker + line.slice(end + 2))
        inBlock = true
        blockFlagged = true
        return void out.push(line.slice(0, at) + marker)
      }
      const bl = line.indexOf('/*')
      if (bl >= 0 && line.indexOf('*/', bl + 2) < 0 && !/["'`]/.test(line.slice(0, bl))) {
        inBlock = true
        blockFlagged = false
      }
      out.push(line)
    })
    lines = out
  }
  const secrets = []
  lines = lines.map((line, idx) => {
    let l = line
    for (const [kind, re] of SECRET_PATTERNS) {
      l = l.replace(re, (m) => {
        secrets.push({ line: idx + 1, kind })
        return `[REDACTED:${kind}]`
      })
    }
    if (/(priv(ate)?[_-]?key|secret|mnemonic|seed[_-]?phrase|PK\b)/i.test(l)) {
      l = l.replace(/0x[0-9a-fA-F]{64}\b/g, () => {
        secrets.push({ line: idx + 1, kind: 'private-key' })
        return '[REDACTED:private-key]'
      })
    }
    return l
  })
  return { text: lines.join('\n'), flags, secrets }
}

const SECRET_PATTERNS = [
  ['anthropic-key', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['openai-key', /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/g],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['github-token', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['stripe-key', /\b[sr]k_live_[A-Za-z0-9]{20,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['private-key-block', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g],
]

/** Line-numbered text for the model ("  12 | code"). */
export const numbered = (text, from = 1) =>
  text
    .split('\n')
    .map((l, i) => `${String(i + from).padStart(5)} | ${l}`)
    .join('\n')
