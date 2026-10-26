/* What is live across Gully (2026-10-26), all read from GET /api/hub through the one live provider (live.tsx):
   - ChainSuite: every Gully Chain surface (Gully Street and its features, explorer, faucet, bridge, docs, developer
     portal, public RPC, indexer), each with its state, response time and a live sparkline;
   - QuestsPanel: Gully Quests on chain 485590 (quests, completions, the ETH left in the pools, hourly completions);
   - NetworkChips: Gully Pay's x402 networks or Gully RPC's gateway networks, Gully Chain included;
   - LabsBoard: every other Gully Labs surface and the status page's own reading.
   A source that cannot be read says so ("not reachable", "reading"); nothing is drawn as zero that was not read. */
import { ArrowUpRight, Blocks, BookOpen, Code2, Coins, Copy, Droplets, Gamepad2, Globe, Repeat, Rocket, ScrollText, Search, Server, Share2, Tag, Trophy, Users, Vault } from 'lucide-react'
import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import { C, fmtInt } from './charts'
import { hubState, useLive, type HubService } from './live'
import { Btn, Count, ic, Spark } from './ui'

type Icon = ComponentType<LucideProps>
export const STREET = 'https://app.gullychain.xyz'
export const EXPLORER = 'https://testnet-explorer.gullychain.xyz'

/** Gully Street's features (its own nav, read from app.gullychain.xyz on 2026-10-26). */
export const STREET_FEATURES: { label: string; path: string; icon: Icon }[] = [
  { label: 'Launchpad', path: '/launch', icon: Rocket },
  { label: 'Gully Swap', path: '/swap', icon: Repeat },
  { label: '.gully names', path: '/names', icon: Tag },
  { label: 'Quests', path: '/quests', icon: Trophy },
  { label: 'Arcade', path: '/arcade', icon: Gamepad2 },
  { label: 'Copy trading', path: '/copy', icon: Copy },
  { label: 'Referrals', path: '/referrals', icon: Users },
]

const SURF_IC: Record<string, Icon> = { copy: Copy, safe: Vault, 'chain-site': Globe, street: Rocket, explorer: Search, faucet: Droplets, bridge: Share2, docs: BookOpen, devportal: Code2, 'rpc-public': Server, indexer: Blocks }
const SURF_LINE: Record<string, string> = {
  'chain-site': 'The chain, its network details and the launch flow.',
  explorer: 'Blocks, transactions, tokens and verified contracts.',
  faucet: 'Test ETH for a wallet, once a day.',
  bridge: 'Move ETH between Arbitrum Sepolia and Gully Chain.',
  docs: 'Network details, contracts, guides and Quests.',
  devportal: 'SDKs, contract addresses and examples for builders.',
  'rpc-public': 'The free, rate-limited RPC. Keys at Gully RPC.',
  indexer: 'Tokens, trades, names and quests as JSON.',
  copy: 'The engine behind copy trading in Gully Street.',
  safe: 'Multisig wallets on Gully Chain.',
}
/** A sparkline once there are two readings; before that a small pulsing note (history builds one point a minute). */
function Trend({ values, color, h }: { values: (number | null)[]; color: string; h: number }) {
  if (values.filter((v) => v != null).length < 2)
    return (
      <span className="spkwait" style={{ height: h }}>
        <i />
        collecting readings
      </span>
    )
  return <Spark values={values} color={color} h={h} />
}
const host = (u: string) => u.replace(/^https:\/\//, '').replace(/\/$/, '')

function State({ s }: { s: HubService | undefined }) {
  if (!s)
    return (
      <span className="pill sm">
        <span className="dot" />
        reading
      </span>
    )
  const st = hubState(s)
  return (
    <span className={`pill sm ${st === 'up' ? 'live' : st === 'coming' ? 'soon' : 'down'}`}>
      <span className="dot" />
      {st}
    </span>
  )
}

/** One surface: icon, name, host, state, response time and its last hour as a sparkline. */
function Surface({ k, s, name, url }: { k: string; s?: HubService; name: string; url: string }) {
  const I = SURF_IC[k] ?? Globe
  return (
    <a className="sv card" href={url} target="_blank" rel="noopener noreferrer" data-surface={k}>
      <span className="svh">
        {ic(I)}
        <b>{name}</b>
        <State s={s} />
      </span>
      <span className="svu">{host(url)}</span>
      {SURF_LINE[k] && <span className="svl">{SURF_LINE[k]}</span>}
      <span className="svm">
        <Count value={s?.up ? s.ms : null} fmt={(v) => `${Math.round(v)} ms`} />
        <small>{s ? (s.up ? 'response, from our server' : 'no answer on the last check') : 'checking'}</small>
      </span>
      <Trend values={(s?.history ?? []).map((h) => h.ms)} color={s && !s.up ? C.down : C.s[0]} h={28} />
    </a>
  )
}

/** Gully Street: the consumer app on Gully Chain, with a deep link to each feature. */
function StreetCard({ s }: { s?: HubService }) {
  return (
    <div className="sv street2 card" data-surface="street">
      <span className="svh">
        {ic(Rocket)}
        <b>Gully Street</b>
        <State s={s} />
      </span>
      <span className="svu">app.gullychain.xyz · your profile is your wallet</span>
      <ul className="feats">
        {STREET_FEATURES.map((f) => (
          <li key={f.path}>
            <a href={`${STREET}${f.path}`} target="_blank" rel="noopener noreferrer">
              {ic(f.icon)}
              {f.label}
            </a>
          </li>
        ))}
      </ul>
      <span className="svm">
        <Count value={s?.up ? s.ms : null} fmt={(v) => `${Math.round(v)} ms`} />
        <small>{s ? (s.up ? 'response, from our server' : 'no answer on the last check') : 'checking'}</small>
      </span>
      <Trend values={(s?.history ?? []).map((h) => h.ms)} color={C.s[1]} h={28} />
    </div>
  )
}

const CHAIN_ORDER: { k: string; name: string; url: string }[] = [
  { k: 'explorer', name: 'Explorer', url: EXPLORER },
  { k: 'faucet', name: 'Faucet', url: 'https://faucet.gullychain.xyz' },
  { k: 'bridge', name: 'Bridge', url: 'https://testnet-bridge.gullychain.xyz' },
  { k: 'docs', name: 'Docs', url: 'https://docs.gullychain.xyz' },
  { k: 'devportal', name: 'Developer portal', url: 'https://dev.gullychain.xyz' },
  { k: 'rpc-public', name: 'Public RPC', url: 'https://testnet-rpc.gullychain.xyz' },
  { k: 'copy', name: 'Copy trading', url: 'https://copy.gullychain.xyz' },
  { k: 'safe', name: 'Gully Safe', url: 'https://safe.gullychain.xyz' },
]

/** Every Gully Chain surface, live: Gully Street with its features, then explorer, faucet, bridge, docs, developer portal, public RPC. */
export function ChainSuite() {
  const { hub } = useLive()
  const by = (k: string) => hub?.services.find((s) => s.key === k)
  const up = hub ? hub.services.filter((s) => s.group === 'chain' && s.up).length : null
  const all = hub ? hub.services.filter((s) => s.group === 'chain' && hubState(s) !== 'coming').length : null
  return (
    <div className="suite" data-testid="chain-suite">
      <div className="suiteh">
        <span className="lab cy">Gully Chain testnet · chain 485590</span>
        <span className="lab">{up == null ? 'checking every surface…' : `${up} of ${all} surfaces up · checked each minute`}</span>
      </div>
      <div className="surf">
        <StreetCard s={by('street')} />
        {CHAIN_ORDER.map((c) => (
          <Surface key={c.k} k={c.k} s={by(c.k)} name={c.name} url={c.url} />
        ))}
      </div>
    </div>
  )
}

const ethFmt = (v: number) => `${v < 0.01 ? v.toFixed(5) : v.toFixed(3)} ETH`
/** Gully Quests: on-chain quests on Gully Chain, read from the chain's indexer (or the registry itself). */
export function QuestsPanel() {
  const { hub } = useLive()
  const q = hub?.quests ?? null
  const live = q?.quests.filter((x) => x.state === 'active') ?? []
  return (
    <div className="quests card" data-testid="quests-panel">
      <div className="qh">
        <span className="lab cy">
          {ic(Trophy)}Gully Quests · on chain
        </span>
        <Btn kind="ter" size="xs" icon={ArrowUpRight} href={`${STREET}/quests`}>
          Open Quests
        </Btn>
      </div>
      <p className="qp">
        Do something on Gully Chain, prove it on chain, get paid from the quest&apos;s pool. <b>Rewards in test ETH</b> on the testnet.
      </p>
      <div className="qstats">
        <div>
          <span className="lab">Live quests</span>
          <Count as="b" value={q ? (q.active ?? q.total) : null} />
        </div>
        <div>
          <span className="lab">Completions</span>
          <Count as="b" value={q?.completions ?? null} />
        </div>
        <div>
          <span className="lab">Left in pools</span>
          <Count as="b" value={q?.poolEth ?? null} fmt={ethFmt} />
        </div>
      </div>
      <Spark values={q?.hourly ?? []} color={C.s[2]} h={36} />
      <span className="qsub">{q ? (q.hourly.length ? `completions per hour, last ${q.hourly.length} h · ${q.completions24h ?? 0} in 24 h` : `read from the QuestRegistry · ${fmtInt(q.total)} quests`) : hub ? 'Quests could not be read right now' : 'reading quests…'}</span>
      {live.length > 0 && (
        <ul className="qlist">
          {live.slice(0, 4).map((x) => (
            <li key={x.id}>
              <a href={`${STREET}/quests`} target="_blank" rel="noopener noreferrer">
                <span className="qt">{x.title}</span>
                <span className="qbar" aria-hidden>
                  <i style={{ width: `${x.max ? Math.min(100, (x.completions / x.max) * 100) : 0}%` }} />
                </span>
                <span className="qm">
                  {x.completions}/{x.max} done{x.rewardEth != null ? ` · ${ethFmt(x.rewardEth)} each` : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {q?.recent[0] && (
        <span className="qsub">
          Latest: <b>{q.recent[0].who}</b> completed “{q.recent[0].title ?? `quest ${q.recent[0].questId}`}”
        </span>
      )}
      <a className="qsub" href={`${EXPLORER}/address/${q?.registry ?? '0xE3E57e15A9973281A8de2B3bedd512BE8C3813Bb'}`} target="_blank" rel="noopener noreferrer">
        {ic(ScrollText)} QuestRegistry on the explorer
      </a>
    </div>
  )
}

/** Gully Pay's x402 networks or Gully RPC's gateway networks, as chips; Gully Chain is marked. */
export function NetworkChips({ kind }: { kind: 'x402' | 'gateway' }) {
  const { hub } = useLive()
  if (kind === 'x402') {
    const x = hub?.x402
    return (
      <div className="netchips" data-testid="x402-networks">
        <span className="lab cy">{ic(Coins)}Gully Pay x402 · networks</span>
        <ul className="chips">
          {x ? (
            x.networks.map((n) => (
              <li key={n.id} className={`chip${/gully/.test(n.id) ? ' gc' : ''}`}>
                {n.name}
                {n.testnet && !/gully/.test(n.id) ? <small>test</small> : null}
              </li>
            ))
          ) : (
            <li className="chip dim">{hub ? 'x402 status could not be read' : 'reading gullypay.xyz/x402/status…'}</li>
          )}
        </ul>
        {x && <span className="qsub">Assets {x.assets.join(', ')} · scheme {x.schemes.join(', ')} · settles on Gully Chain{x.gullyChain ? '' : ' (not listed right now)'}</span>}
      </div>
    )
  }
  const g = hub?.gateway
  const nm: Record<string, string> = { 'gully-testnet': 'Gully Chain Testnet', ethereum: 'Ethereum', base: 'Base', bsc: 'BNB Chain', arbitrum: 'Arbitrum One', robinhood: 'Robinhood' }
  const order = g ? [...g.networks].sort((a, b) => Number(b.chainId === 485590) - Number(a.chainId === 485590)) : []
  return (
    <div className="netchips" data-testid="gateway-networks">
      <span className="lab cy">{ic(Server)}Gully RPC gateway · rpc.gullyrpc.xyz</span>
      <ul className="chips">
        {g ? (
          order.map((n) => (
            <li key={n.alias} className={`chip${n.chainId === 485590 ? ' gc' : ''}${n.state === 'OK' ? '' : ' bad'}`}>
              {nm[n.alias] ?? n.alias}
              <small>{n.state === 'OK' ? (n.chainId ?? '') : n.state.toLowerCase()}</small>
            </li>
          ))
        ) : (
          <li className="chip dim">{hub ? 'the gateway could not be read' : 'reading the gateway…'}</li>
        )}
      </ul>
      {g && <span className="qsub">{g.ok} of {g.total} networks answering · https://rpc.gullyrpc.xyz/&lt;project&gt;/evm/&lt;chainId&gt;</span>}
    </div>
  )
}

const LABS: { k: string; name: string; url: string }[] = [
  { k: 'pay', name: 'Gully Pay', url: 'https://gullypay.xyz' },
  { k: 'x402', name: 'x402 facilitator', url: 'https://gullypay.xyz/x402/status' },
  { k: 'pay-admin', name: 'Gully Pay admin', url: 'https://admin.gullypay.xyz' },
  { k: 'rpc-site', name: 'Gully RPC', url: 'https://gullyrpc.xyz' },
  { k: 'rpc-app', name: 'Gully RPC app', url: 'https://app.gullyrpc.xyz' },
  { k: 'rpc-gateway', name: 'RPC gateway', url: 'https://rpc.gullyrpc.xyz' },
  { k: 'holders', name: 'HolderMaps', url: 'https://holdermaps.xyz' },
  { k: 'security', name: 'Gully Security', url: 'https://gullysecurity.xyz' },
  { k: 'gullyai', name: 'Gully AI', url: 'https://gullyai.xyz' },
  { k: 'ai-api', name: 'Gully AI API', url: 'https://gullyai.xyz/docs/' },
  { k: 'studio', name: 'Gully Studio', url: 'https://gullystudio.xyz' },
  { k: 'studio-dev', name: 'Studio dev portal', url: 'https://dev.gullystudio.xyz' },
  { k: 'studio-docs', name: 'Studio docs', url: 'https://docs.gullystudio.xyz' },
  { k: 'ipfs', name: 'Gully IPFS gateway', url: 'https://ipfs.gullylabs.xyz' },
  { k: 'status', name: 'Status page', url: 'https://status.gullylabs.xyz' },
]

/** Every Gully Labs surface beyond the chain, one row each, plus the status page's own reading. */
export function LabsBoard() {
  const { hub } = useLive()
  const by = (k: string) => hub?.services.find((s) => s.key === k)
  const sp = hub?.statusPage
  return (
    <div className="board card" data-testid="labs-board">
      <div className="qh">
        <span className="lab cy">Live across Gully Labs</span>
        <span className="lab">{hub ? `checked ${new Date(hub.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'checking…'}</span>
      </div>
      <ul className="rows">
        {LABS.map((r) => {
          const s = by(r.k)
          return (
            <li key={r.k}>
              <a href={r.url} target="_blank" rel="noopener noreferrer">
                <span className="rn">{r.name}</span>
                <span className="ru">{host(r.url)}</span>
                <State s={s} />
                <span className="rm num">{s?.up && s.ms != null ? `${s.ms} ms` : hubState(s) === 'coming' ? 'soon' : '—'}</span>
                <span className="rs">
                  <Trend values={(s?.history ?? []).map((h) => h.ms)} color={s && !s.up ? C.down : C.s[1]} h={20} />
                </span>
              </a>
            </li>
          )
        })}
      </ul>
      <span className="qsub">
        {sp ? (
          <>
            status.gullylabs.xyz (independent server): <b>{sp.up}/{sp.total} services operational</b>
            {sp.overall && sp.overall !== 'ok' ? ` · ${sp.overall === 'warn' ? 'degraded' : 'outage'}` : ''}
          </>
        ) : hub ? (
          'status.gullylabs.xyz could not be read'
        ) : (
          'reading status.gullylabs.xyz…'
        )}
      </span>
    </div>
  )
}

/** The live block a product shows under its figures (product pages and the app's hand-offs): Gully Chain gets its
    surfaces and Gully Quests, Gully Pay its x402 networks, Gully RPC its gateway networks. Null for the others. */
export function ProductLive({ k }: { k: string }) {
  if (k === 'chain')
    return (
      <div className="livegrid">
        <ChainSuite />
        <QuestsPanel />
      </div>
    )
  if (k === 'pay' || k === 'rpc')
    return (
      <div className="card netrow">
        <NetworkChips kind={k === 'pay' ? 'x402' : 'gateway'} />
        <NetworkChips kind={k === 'pay' ? 'gateway' : 'x402'} />
      </div>
    )
  return null
}
