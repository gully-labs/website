/* HolderMaps' empty, loading, error and 404 states: the mascot does the explaining (Mascot.tsx poses), the words say
   plainly what happened and what to do next, and something always moves (gentle under reduced motion). */
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Mascot, type MascotPose } from './Mascot'

export function HmState({ pose, eyebrow, title, text, children, h1 = false, testId }: { pose: MascotPose; eyebrow: string; title: string; text: ReactNode; children?: ReactNode; h1?: boolean; testId?: string }) {
  const H = h1 ? 'h1' : 'h2'
  return (
    <section className="hm-state" data-testid={testId} data-hm-state={pose}>
      <div className="hm-state-art" aria-hidden>
        <span className="hm-orbit" />
        <span className="hm-orbit o2" />
        <Mascot pose={pose} width={200} />
      </div>
      <div className="hm-state-body">
        <span className="hm-eyebrow">
          <i className="hm-dot" aria-hidden /> {eyebrow}
        </span>
        <H className="hm-state-h">{title}</H>
        <div className="hm-state-p">{text}</div>
        {children && <div className="hm-state-act">{children}</div>}
      </div>
    </section>
  )
}

/** "Mapping holders": the laptop pose, bubbles gathering into a map, and the server's progress when it gives one. */
export function HmLoading({ progress, label = 'Mapping holders' }: { progress?: number | null; label?: string }) {
  const pct = typeof progress === 'number' ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : null
  return (
    <section className="hm-state hm-loading" role="status" aria-live="polite" aria-label={pct === null ? `${label}…` : `${label}: ${pct}%`} data-hm-state="loading">
      <div className="hm-state-art" aria-hidden>
        <span className="hm-orbit" />
        <span className="hm-orbit o2" />
        <Mascot pose="laptop" width={200} />
      </div>
      <div className="hm-state-body">
        <span className="hm-eyebrow">
          <i className="hm-dot" aria-hidden /> LIVE READ
        </span>
        <h2 className="hm-state-h">{label}…</h2>
        <div className="hm-state-p">{pct === null ? 'Reading the biggest wallets, who sent tokens to whom, and the launch history. The first read of a big token can take a minute.' : 'Reading this token’s full transfer history for the first time. The page fills in by itself.'}</div>
        <div className={`hm-progress ${pct === null ? 'indet' : ''}`} aria-hidden>
          <i style={pct === null ? undefined : { width: `${pct}%` }} />
        </div>
        <div className="hm-skel-bubbles" aria-hidden>
          {[34, 22, 16, 26, 12, 18, 10].map((s, i) => (
            <span key={i} style={{ width: s * 2, height: s * 2, animationDelay: `${i * 0.18}s` }} />
          ))}
        </div>
      </div>
    </section>
  )
}

/** A path no HolderMaps page owns (the server answers it 404). */
export function HmNotFoundBody() {
  return (
    <HmState
      pose="backpack"
      eyebrow="404 · OFF THE MAP"
      title="This trail goes nowhere"
      h1
      testId="hm-404"
      text={
        <>
          No HolderMaps page lives at <code className="hm-code">{typeof window !== 'undefined' ? window.location.pathname : '/'}</code>. A token map’s address is{' '}
          <code className="hm-code">holdermaps.xyz/&lt;chain&gt;/&lt;token&gt;</code>, on Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM or Solana.
        </>
      }
    >
      <Link className="hm-btn" to="/#map">
        Map a token
      </Link>
      <Link className="hm-btn ghost" to="/#live">
        Most scanned today
      </Link>
    </HmState>
  )
}
