import { useState, type ReactNode } from 'react'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, P, Section } from '../DocPage'
import { apiOrigin } from '../nav'

const sections = [
  { id: 'family', title: 'One family' },
  { id: 'gallery', title: 'Every kind, size and theme' },
  { id: 'embed', title: 'Copy and paste' },
  { id: 'rules', title: 'How they are made' },
]

type Kind = 'score' | 'holders' | 'security' | 'project'
type Size = 'S' | 'M' | 'L'
type Theme = 'dark' | 'light'

const KINDS: { id: Kind; name: string; what: string; path: string; href: string; alt: string; tones?: string[] }[] = [
  { id: 'score', name: 'Gully Score', what: 'The score and its grade for one contract. It shows what is stored and never computes one.', path: '/score/base/0x…/badge.svg', href: 'https://gullylabs.xyz/score/base/0x…', alt: 'Gully Score', tones: ['good', 'brand', 'warn', 'neutral'] },
  { id: 'holders', name: 'Holder Map', what: 'The launch health, or the number of bundles in the warning tone. A neutral “Holder Map” pill until a map is cached.', path: '/api/holders/base/0x…/badge.svg', href: 'https://gullylabs.xyz/holders/base/0x…', alt: 'Holder Map', tones: ['good', 'brand', 'warn', 'neutral'] },
  { id: 'security', name: 'Gully Security', what: 'Only for a published report, with the date it was published.', path: '/api/security/reports/sec_…/badge.svg', href: 'https://gullylabs.xyz/security/reports/sec_…', alt: 'Gully Security' },
  { id: 'project', name: 'Built by Gully Labs', what: 'For the sites of our own projects.', path: '/badges/built-by-gully-labs.svg', href: 'https://gullylabs.xyz', alt: 'Built by Gully Labs' },
]
const SIZES: Size[] = ['S', 'M', 'L']
const HEIGHT: Record<Size, number> = { S: 20, M: 28, L: 36 }
const THEMES: Theme[] = ['dark', 'light']
const KIND_IDS = KINDS.map((x) => x.id)

const exampleSrc = (kind: Kind, size: Size, theme: Theme, tone?: string) => `${apiOrigin()}/badges/example/${kind}.svg?size=${size}&theme=${theme}${tone ? `&tone=${tone}` : ''}`

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-[6px] border border-line-strong">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={`min-h-[36px] cursor-pointer border-0 px-3 font-mono text-[12px] ${value === o ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}>
          {o}
        </button>
      ))}
    </div>
  )
}

/** A strip on the background a badge theme is made for. */
function Panel({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <div className={`flex flex-wrap items-center gap-x-8 gap-y-4 rounded-[12px] border border-line p-5 ${theme === 'dark' ? 'bg-[#0B1118]' : 'bg-[#ECEAE3]'}`}>{children}</div>
}

export function BadgesDocs() {
  const [kind, setKind] = useState<Kind>('score')
  const [size, setSize] = useState<Size>('M')
  const [theme, setTheme] = useState<Theme>('dark')
  const k = KINDS.find((x) => x.id === kind) ?? KINDS[0]
  const url = `https://gullylabs.xyz${k.path}?size=${size}&theme=${theme}`
  const html = `<a href="${k.href}"><img src="${url}" alt="${k.alt}" height="${HEIGHT[size]}"></a>`
  const md = `[![${k.alt}](${url})](${k.href})`

  return (
    <DocPage
      slug="badges"
      eyebrow="BUILD · BADGES"
      title="Badges"
      description="The Gully Labs badge family: Gully Score, Holder Map, Gully Security and Built by Gully Labs, in three sizes and two themes, with HTML and Markdown snippets to copy."
      lead="Small SVG badges you can put on a README, a docs page or a project site. One family: the Gully Labs mark, a label and a value."
      sections={sections}
    >
      <Section id="family" title="One family">
        <P>Every badge has the same three parts: the Gully Labs mark, the product in upper case, and a value in a second field. They are plain SVG images, open to any origin, so they work in a README, in an email or on any site.</P>
        <Fields head={['Badge', 'Says', 'Address']} variant="routes" rows={KINDS.map((x) => [x.name, x.what, <C key={x.id}>{x.path}</C>])} />
        <P>
          Add <C>?size=S|M|L</C> (20, 28 or 36 px tall, M by default) and <C>?theme=dark|light</C> (dark by default). The Gully Score, Holder Map and Gully Security badges link back to their page; they are cached and never start a computation, a map build or a scan.
        </P>
      </Section>

      <Section id="gallery" title="Every kind, size and theme">
        <P>
          These are live badges, served by <Ext href="https://gullylabs.xyz/badges/example/score.svg">/badges/example/&lt;kind&gt;.svg</Ext> with fixed example values. The tones: green for a healthy value, gold for a middle one, a solid gold field for a warning, grey when there is nothing to rate.
        </P>
        <div className="flex flex-col gap-6">
          {KINDS.map((x) => (
            <div key={x.id} className="flex flex-col gap-3">
              <h3 className="m-0 font-display text-[20px] font-bold uppercase tracking-[0.02em] text-ink">{x.name}</h3>
              {THEMES.map((th) => (
                <Panel key={th} theme={th}>
                  {SIZES.map((sz) => (
                    <img key={sz} src={exampleSrc(x.id, sz, th)} alt={`${x.name} badge, size ${sz}, ${th} theme (example)`} height={HEIGHT[sz]} loading="lazy" decoding="async" />
                  ))}
                </Panel>
              ))}
              {x.tones && (
                <Panel theme="dark">
                  {x.tones.map((tn) => (
                    <img key={tn} src={exampleSrc(x.id, 'M', 'dark', tn)} alt={`${x.name} badge, ${tn} tone (example)`} height={28} loading="lazy" decoding="async" />
                  ))}
                </Panel>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section id="embed" title="Copy and paste">
        <div className="flex flex-wrap items-center gap-3">
          <Seg label="Badge" value={kind} options={KIND_IDS} onChange={setKind} />
          <Seg label="Size" value={size} options={SIZES} onChange={setSize} />
          <Seg label="Theme" value={theme} options={THEMES} onChange={setTheme} />
        </div>
        <Panel theme={theme}>
          <img src={exampleSrc(kind, size, theme)} alt={`${k.name} badge (example)`} height={HEIGHT[size]} />
        </Panel>
        <CodeBlock code={html} lang="html" caption="HTML" wrap />
        <CodeBlock code={md} lang="text" caption="Markdown" wrap />
        <Callout label="Fill in the address">
          <P>
            Replace <C>0x…</C> or <C>sec_…</C> with the contract, token or report. The Holder Map takes a chain key and an address or ticker, like <DocLink to="holder-map">the map’s own links</DocLink>. A Gully Security badge exists only for a published report, see{' '}
            <DocLink to="gully-security">Gully Security</DocLink>.
          </P>
        </Callout>
      </Section>

      <Section id="rules" title="How they are made">
        <P>
          Nothing is drawn from a font on your side. The letters are outlined paths of the brand kit’s own typefaces (Barlow Condensed Bold for the label, JetBrains Mono for the value), the mark is the kit’s mascot bust, the colours are the kit tokens, and every edge sits on a whole pixel,
          so the badge is crisp at 1x and 2x. The width follows the text exactly. <DocLink to="gully-score">Gully Score</DocLink> explains what its number means.
        </P>
      </Section>
    </DocPage>
  )
}
