import { MiniSpark } from '../../components/charts/MiniSpark'
import type { IpfsStats } from '../../console/live'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { useApi } from '../useApi'

const sections = [
  { id: 'what', title: 'What Gully IPFS is' },
  { id: 'live', title: 'Live figures' },
  { id: 'gateway', title: 'The gateway' },
  { id: 'uses', title: 'What we pin' },
  { id: 'api', title: 'GET /api/ipfs/stats' },
]

const URLS = `https://ipfs.gullylabs.xyz/ipfs/<CID>
https://ipfs.gullylabs.xyz/ipfs/<CID>/path/inside/a/folder.json`

const CURL = `curl -s https://api.gullylabs.xyz/api/ipfs/stats | jq '{source, pinned, repoBytes, gatewayUp}'`

const gb = (v: number) => `${(v / 1e9).toFixed(2)} GB`

/** The node's figures, read every minute: pinned CIDs, repo size and gateway response time, each with its line. */
function IpfsLive() {
  const s = useApi<IpfsStats>('/api/ipfs/stats', 60_000)
  const st = s && s !== 'error' ? s : null
  const h = st?.history ?? []
  const labels = h.map((x) => new Date(x.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
  const tiles: { label: string; value: string; data: (number | null)[]; fmt?: (v: number) => string }[] = [
    { label: 'CIDs pinned', value: st?.pinned == null ? 'not readable' : st.pinned.toLocaleString('en-US'), data: h.map((x) => x.pinned) },
    { label: 'Repo size', value: st?.repoBytes == null ? 'not readable' : gb(st.repoBytes), data: h.map((x) => x.repoBytes), fmt: gb },
    { label: 'Gateway', value: st?.gatewayUp == null ? 'not reachable yet' : st.gatewayUp ? `up · ${st.gatewayMs ?? '—'} ms` : 'down', data: h.map((x) => x.ms), fmt: (v) => `${Math.round(v)} ms` },
  ]
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3" data-testid="ipfs-live">
      {tiles.map((t) => (
        <div key={t.label} className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-card-token p-4">
          <span className="font-mono text-[11px] tracking-[1px] text-faint uppercase">{t.label}</span>
          <span className="font-display text-[22px] leading-none font-bold text-ink">{s === null ? 'reading…' : s === 'error' ? 'not readable' : t.value}</span>
          <MiniSpark data={t.data} labels={labels} label={`Gully IPFS ${t.label.toLowerCase()}, last hour`} fmt={t.fmt} height={44} />
        </div>
      ))}
    </div>
  )
}

export function IpfsDocs() {
  return (
    <DocPage
      slug="ipfs"
      eyebrow="PRODUCTS · GULLY IPFS"
      title="Gully IPFS"
      description="Gully IPFS: our Kubo node and read-only gateway at ipfs.gullylabs.xyz. It serves only content Gully pins: token images, metadata, NFT art and .gully sites."
      lead={
        <>
          Gully IPFS is the IPFS node Gully Labs runs for its own content, with a read-only public gateway. Anything we pin is reachable at <C>ipfs.gullylabs.xyz/ipfs/&lt;CID&gt;</C> and from any other IPFS node.
        </>
      }
      sections={sections}
    >
      <Section id="what" title="What Gully IPFS is">
        <P>
          A <Ext href="https://github.com/ipfs/kubo">Kubo</Ext> node on Gully infrastructure. It pins Gully content so it stays available, announces those pins to the IPFS network, and serves them through its own gateway. Kubo is
          open source (MIT and Apache-2.0).
        </P>
        <Callout label="Gully content only">
          The gateway runs with <C>Gateway.NoFetch</C>: it answers only for blocks this node already holds and never fetches other content from the network. It is not a general public gateway, and nobody outside Gully Labs can pin to it.
        </Callout>
      </Section>

      <Section id="live" title="Live figures">
        <P>Read from the node every minute by our server (the node&apos;s own API is never public). A figure that cannot be read says so, it is never shown as zero.</P>
        <IpfsLive />
      </Section>

      <Section id="gateway" title="The gateway">
        <P>Address a pinned file, or a file inside a pinned folder, by its CID:</P>
        <CodeBlock code={URLS} lang="text" />
        <List>
          <li>Read-only: GET and HEAD only. There is no upload or pin endpoint.</li>
          <li>The same CID works on any IPFS gateway or node, because the content is announced to the network.</li>
          <li>CIDs are content hashes: a file at a CID never changes.</li>
        </List>
      </Section>

      <Section id="uses" title="What we pin">
        <List>
          <li>DeepCore token images and metadata, so launch pages and wallets always find them.</li>
          <li>NFT art, such as Gully passes.</li>
          <li>Sites behind <C>.gully</C> names: a name&apos;s contenthash points at a CID served here.</li>
          <li>Snapshots of public Gully docs.</li>
        </List>
        <P>We never pin licensed third-party assets (Unity Asset Store content included) or anything that is not ours.</P>
      </Section>

      <Section id="api" title="GET /api/ipfs/stats">
        <P>Public, cached for 60 seconds, open CORS. The same path answers on gullylabs.xyz and api.gullylabs.xyz.</P>
        <CodeBlock code={CURL} lang="bash" />
        <Fields
          rows={[
            [<C>source</C>, 'string', "'kubo' when the node answered; 'gateway-internal' or 'gateway-public' when only the gateway did; 'none' otherwise"],
            [<C>pinned</C>, 'number | null', 'recursive pins on the node'],
            [<C>repoBytes</C>, 'number | null', 'size of the node’s repository'],
            [<C>storageMaxBytes</C>, 'number | null', 'the garbage-collection target; pinned content is never collected'],
            [<C>gatewayUp</C>, 'boolean | null', 'whether the gateway answered; null when it could not be reached at all'],
            [<C>gatewayMs</C>, 'number | null', 'its response time'],
            [<C>history</C>, 'array', 'one point a minute for the last hour: t, pinned, repoBytes, up, ms'],
          ]}
        />
      </Section>
    </DocPage>
  )
}
