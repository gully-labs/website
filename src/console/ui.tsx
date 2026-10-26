/* Lab console building blocks (Direction A, owner pick 2026-10-25), shared by every route: pill buttons,
   live numbers and sparklines, ticker, stat tiles, product cards, stepper, trust band, toasts. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Activity, ArrowUpRight, Blocks, Check, CircleDollarSign, Coins, Gamepad2, HardDrive, KeyRound, LayoutGrid, Network, Rocket, ScanSearch, Server, ShieldCheck, Wallet, X, Zap, type LucideProps } from 'lucide-react'
import { MarkLogo, ProductLogo as KitProductLogo } from '../components/ProductLogo'
import { countUp, fmtInt, fmtTime, spark } from './charts'
import { dismissToast, toastStore, type ToastIcon } from './toast'
import { tapeItems, useLive, type TapeItem } from './live'

type Icon = ComponentType<LucideProps>
export const ic = (I: Icon, cls = 'ic') => <I className={cls} aria-hidden focusable={false} />

/** The arrow the signature button slides on hover (the static page's exact glyph). */
export const Arrow = () => (
  <svg className="ar" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
)

type BtnProps = { kind?: 'pri' | 'sec' | 'ter'; size?: 'sm' | 'xs'; icon?: Icon; arrow?: boolean; children: ReactNode; className?: string }
const btnCls = ({ kind = 'pri', size, className }: BtnProps) => ['btn', kind, size, className].filter(Boolean).join(' ')
const ext = (href: string) => /^https?:/.test(href)

/** Signature pill: a link (external opens a new tab), or a button when there is no href. */
export function Btn(p: BtnProps & { href?: string; onClick?: () => void; ariaLabel?: string }) {
  const inner = (
    <>
      {p.icon && ic(p.icon)}
      {p.children}
      {p.arrow && <Arrow />}
    </>
  )
  if (!p.href)
    return (
      <button type="button" className={btnCls(p)} onClick={p.onClick} aria-label={p.ariaLabel}>
        {inner}
      </button>
    )
  if (ext(p.href))
    return (
      <a className={btnCls(p)} href={p.href} target="_blank" rel="noopener noreferrer" aria-label={p.ariaLabel} onClick={p.onClick}>
        {inner}
      </a>
    )
  return (
    <Link className={btnCls(p)} to={p.href} aria-label={p.ariaLabel} onClick={p.onClick}>
      {inner}
    </Link>
  )
}

/** A live number: counts up from the last value on every change. */
export function Count({ value, fmt = fmtInt, className = 'num', as: Tag = 'span' }: { value: number | null | undefined; fmt?: (v: number) => string; className?: string; as?: 'span' | 'b' }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => countUp(ref.current, value, fmt), [value, fmt])
  return (
    <Tag ref={ref as never} className={className}>
      —
    </Tag>
  )
}

/** A sparkline that tweens to each new reading and carries a travelling glow dot. */
export function Spark({ values, color, h }: { values: (number | null)[]; color: string; h?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const key = JSON.stringify(values)
  useEffect(() => {
    spark(ref.current, JSON.parse(key) as (number | null)[], { color, h })
  }, [key, color, h])
  return <div ref={ref} />
}

const TAPE_IC: Record<TapeItem['icon'], Icon> = { coins: Coins, activity: Activity, blocks: Blocks, wallet: Wallet, server: Server }
/** The live ticker strip: always populated (last visit or source names before the first read), always moving. */
export function Ticker({ label = 'Live' }: { label?: string }) {
  const live = useLive()
  const items = tapeItems(live)
  const row = (dup: boolean) =>
    items.map((it, i) => (
      <span className="it" key={`${dup ? 'b' : 'a'}${i}`} aria-hidden={dup || undefined}>
        {ic(TAPE_IC[it.icon])}
        <span className="k">{it.k}</span>
        <span>{it.text}</span>
        {it.v != null && <b>{it.v}</b>}
      </span>
    ))
  return (
    <div className="tape" aria-label="Live events across Gully products">
      <span className="lb lab">{label}</span>
      <div className="trk">
        {row(false)}
        {row(true)}
      </div>
    </div>
  )
}

/** Header pill: when /api/stats was last read. */
export function LivePill() {
  const { stats, statsState } = useLive()
  const down = statsState === 'error'
  return (
    <span className={`pill ${down ? 'down' : 'live'}`}>
      <span className="dot" />
      <span>{down ? 'Stats unreadable' : stats ? `Live · ${fmtTime(stats.generatedAt)}` : 'Connecting'}</span>
    </span>
  )
}

export function Tile({ label, value, fmt, small, spark: s, color, sub }: { label: string; value: number | null | undefined; fmt?: (v: number) => string; small?: ReactNode; spark: (number | null)[]; color: string; sub: ReactNode }) {
  return (
    <div className="tile card">
      <span className="lab">{label}</span>
      <div className="v">
        <Count value={value} fmt={fmt} />
        {small != null && <small>{small}</small>}
      </div>
      <Spark values={s} color={color} />
      <span className="sub">{sub}</span>
    </div>
  )
}

export function SectionHead({ label, title, children, id }: { label: string; title: string; children?: ReactNode; id?: string }) {
  return (
    <div className="sh">
      <div>
        <span className="lab cy">{label}</span>
        <h2 id={id}>{title}</h2>
      </div>
      {children && <p>{children}</p>}
    </div>
  )
}

export interface Step {
  icon: Icon
  title: string
  body: ReactNode
}
/** Three-step stepper: tabs on the left, the current step on the right, gradient progress bars. */
export function Stepper({ steps, cta }: { steps: Step[]; cta: ReactNode }) {
  const [cur, setCur] = useState(0)
  return (
    <div className="street card">
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <button type="button" className={i < cur ? 'done' : undefined} aria-current={i === cur ? 'step' : undefined} onClick={() => setCur(i)}>
              <span className="n num">{String(i + 1).padStart(2, '0')}</span>
              <span>{ic(s.icon, 'ic si')}</span>
              {s.title}
              <span className="bar">
                <i />
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="spanel">
        <span className="lab">
          Step {cur + 1} of {steps.length}
        </span>
        <div key={cur} className="rise">
          <h3>{steps[cur].title}</h3>
          <p>{steps[cur].body}</p>
        </div>
        <div className="ctas">
          {cta}
          {cur < steps.length - 1 ? (
            <button className="btn ter sm" type="button" onClick={() => setCur(cur + 1)}>
              Next step
              <Arrow />
            </button>
          ) : (
            <button className="btn ter sm" type="button" onClick={() => setCur(0)}>
              Start over
              <Arrow />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
export const BUILD_STEPS: Step[] = [
  { icon: LayoutGrid, title: 'Pick a product', body: <>Payments, a chain, RPC, holder data, a security scan or a game SDK: <b>every product has a free tier</b> and a one-page quickstart.</> },
  { icon: KeyRound, title: 'Get your keys', body: <>Sign in to the Gully App with a wallet or passkey. <b>Keys are instant</b>; billing runs through Gully Pay when you need more.</> },
  { icon: Rocket, title: 'Ship', body: <>Drop in the SDK or a single script tag, point it at Gully RPC, and go live. <b>Status, usage and alerts</b> stay in the same dashboard.</> },
]

/* ---------- products ---------- */
export type ProductKey = 'chain' | 'pay' | 'rpc' | 'ipfs' | 'holders' | 'security' | 'studio'
export interface ProductDef {
  key: ProductKey
  name: string
  /** The product's own domain (its home page). */
  url: string
  /** Where its signed-in app lives, when it has one (the Gully Labs App hands off there). */
  app?: string
  /** The product's own docs, when it has them on its domain. */
  docs?: string
  /** Lucide icon for menus. */
  icon: Icon
  blurb: string
}
/* The products: six on their own domains since 2026-10-26 (Gully Labs is the hub that points to them), plus Gully IPFS,
   a Gully Labs service documented at docs.gullylabs.xyz/ipfs. */
export const PRODUCTS: ProductDef[] = [
  { key: 'chain', name: 'Gully Chain', url: 'https://gullychain.xyz', app: 'https://app.gullychain.xyz', docs: 'https://docs.gullychain.xyz', icon: Network, blurb: 'An L3 chain for launches and trading, with DeepCore built in.' },
  { key: 'pay', name: 'Gully Pay', url: 'https://gullypay.xyz', docs: 'https://gullypay.xyz/docs', icon: CircleDollarSign, blurb: 'x402 payments, checkout and a merchant OS, settled on chain.' },
  { key: 'rpc', name: 'Gully RPC', url: 'https://gullyrpc.xyz', app: 'https://app.gullyrpc.xyz', docs: 'https://gullyrpc.xyz/docs/', icon: Server, blurb: 'Node control plane and RPC gateway for every Gully chain.' },
  // A Gully Labs service (no own domain or kit): grouped with Gully RPC as infrastructure.
  { key: 'ipfs', name: 'Gully IPFS', url: 'https://docs.gullylabs.xyz/ipfs', icon: HardDrive, blurb: 'Our IPFS node and read-only gateway for Gully content: token art, metadata and .gully sites.' },
  { key: 'holders', name: 'HolderMaps', url: 'https://holdermaps.xyz', icon: ScanSearch, blurb: 'Who really holds a token: bubble maps, clusters and deep checks.' },
  { key: 'security', name: 'Gully Security', url: 'https://gullysecurity.xyz', icon: ShieldCheck, blurb: 'AI security scans, monitors and reports for any contract.' },
  { key: 'studio', name: 'Gully Studio', url: 'https://gullystudio.xyz', icon: Gamepad2, blurb: 'Our game studio: Unity 3D titles on Gully Chain with the Gully Game SDK.' },
]
export const productByKey = (k: ProductKey) => PRODUCTS.find((p) => p.key === k) as ProductDef

/** The product's kit logo in the shared slot (src/components/ProductLogo.tsx). */
export function ProductLogo({ p }: { p: ProductDef }) {
  return <KitProductLogo product={p.key} />
}

export interface ProductFigure {
  value: number | null | undefined
  fmt?: (v: number) => string
  label: string
  spark: (number | null)[]
  color: string
}
export function ProductCard({ p, f, href }: { p: ProductDef; f: ProductFigure; href?: string }) {
  return (
    <a className="prod card" href={href ?? p.url} target="_blank" rel="noopener noreferrer">
      <span className="go">{ic(ArrowUpRight)}</span>
      <span className="logo">
        <ProductLogo p={p} />
      </span>
      <p>{p.blurb}</p>
      <div className="v">
        <Count value={f.value} fmt={f.fmt} />
        <small>{f.label}</small>
      </div>
      <Spark values={f.spark} color={f.color} />
    </a>
  )
}

/** The eighth card beside the seven products: Gully Labs' own status page, with its live count of services up. */
export function StatusCard({ href = '/status' }: { href?: string }) {
  const { status } = useLive()
  const on = status ? status.components.filter((c) => c.state !== 'off') : []
  const up = status ? on.filter((c) => c.state === 'up').length : null
  const api = status?.components.find((c) => c.id === 'api')
  const body = (
    <>
      <span className="go">{ic(ArrowUpRight)}</span>
      <span className="logo">
        <MarkLogo label="Gully Status" />
      </span>
      <p>Every Gully Labs service checked each minute: 24 h uptime and incidents.</p>
      <div className="v">
        <Count value={up} fmt={(v) => `${v}/${on.length}`} />
        <small>services up · Gully Labs</small>
      </div>
      <Spark values={(api?.history ?? []).map((h) => (h.up == null ? null : Math.round(h.up * 1000) / 10))} color={C_STATUS} />
    </>
  )
  return ext(href) ? (
    <a className="prod card" href={href} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <Link className="prod card" to={href}>
      {body}
    </Link>
  )
}
const C_STATUS = '#3DDC97'

/** The products grid: every product card (live figure, opens its own domain) and the status card. */
export function ProductGrid({ figs, hrefOf, statusHref }: { figs: Record<ProductKey, ProductFigure>; hrefOf?: (p: ProductDef) => string; statusHref?: string }) {
  return (
    <div className="prods" data-testid="product-grid">
      {PRODUCTS.map((p) => (
        <ProductCard key={p.key} p={p} f={figs[p.key]} href={hrefOf?.(p)} />
      ))}
      <StatusCard href={statusHref} />
    </div>
  )
}

/* ---------- trust band ---------- */
export function TrustBand({ mascot = true }: { mascot?: boolean }) {
  const { stats, status, chainState, rpcMs } = useLive()
  const ok = stats ? stats.venues.filter((v) => v.state === 'ok').length : null
  const up = status ? status.components.filter((c) => c.state === 'up').length : null
  const on = status ? status.components.filter((c) => c.state !== 'off').length : null
  return (
    <div className="wrap" style={{ position: 'relative' }}>
      <div className="trust card">
        <div className="badges">
          {/* No "Powered by Gully Labs" here: this IS Gully Labs (owner rule 2026-10-26, rule 4). The badge sits in the
              footers of the app, the docs, the blog and the products' own sites. */}
          <a href="https://gullysecurity.xyz" target="_blank" rel="noopener noreferrer" aria-label="Secured by Gully Labs (opens in a new tab)">
            <img src="/brand/badges/secured-by-gully-labs-dark.png" srcSet="/brand/badges/secured-by-gully-labs-dark.png 1x, /brand/badges/secured-by-gully-labs-dark-2x.png 2x, /brand/badges/secured-by-gully-labs-dark-3x.png 3x" width={190} height={48} alt="Secured by Gully Labs" />
          </a>
        </div>
        <div className="facts">
          <span>
            Stats API <b>{stats ? `${ok}/${stats.venues.length} venues ok` : 'reading…'}</b>
          </span>
          <span>
            Gully Chain RPC <b>{chainState === 'error' ? 'unreadable' : rpcMs.length ? `ok · ${rpcMs[rpcMs.length - 1]} ms` : 'reading…'}</b>
          </span>
          <span>
            Last read <b>{stats ? fmtTime(stats.generatedAt) : '—'}</b>
          </span>
          <span>
            Services <b>{status ? `${up}/${on} services up` : 'reading…'}</b> ·{' '}
            <Link to="/status" style={{ color: 'var(--gl-cyan)' }}>
              status
            </Link>
          </span>
        </div>
      </div>
      {mascot && <img className="mascot" src="/brand/mascots/mascot-4-deploying-feathered.png" width={110} height={175} alt="" />}
    </div>
  )
}

/* ---------- toasts ---------- */
const TOAST_IC: Record<ToastIcon, Icon> = { activity: Activity, blocks: Blocks, zap: Zap, check: Check }
export function ConsoleToasts() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.get, toastStore.get)
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div className="toast" role="status" key={t.id}>
          {ic(TOAST_IC[t.icon])}
          <div>
            <b>{t.title}</b>
            <span>{t.text}</span>
          </div>
          <button className="x" type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            {ic(X)}
          </button>
          <i className="pb" style={{ animationDuration: `${t.ms}ms` }} />
        </div>
      ))}
    </div>
  )
}

/** Memo helper so chart inputs only change when the data does. */
export const useJsonMemo = <T,>(v: T) => {
  const k = JSON.stringify(v)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => v, [k])
}
