import { TZ } from '../../lib/time'
import { MiniSpark } from '../../components/charts/MiniSpark'
import type { IpfsStats } from '../../console/live'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { useApi } from '../useApi'

const sections = [
  { id: 'what', title: 'What Gully IPFS is' },
  { id: 'start', title: 'Pin in two minutes' },
  { id: 'psa', title: 'Pinning Service API' },
  { id: 'upload', title: 'Uploads' },
  { id: 'limits', title: 'Plans and limits' },
  { id: 'policy', title: 'Content policy' },
  { id: 'gateway', title: 'The gateway' },
  { id: 'live', title: 'Live figures' },
  { id: 'uses', title: 'What we pin' },
  { id: 'api', title: 'GET /api/ipfs/stats' },
]

const URLS = `https://ipfs.gullylabs.xyz/ipfs/<CID>
https://ipfs.gullylabs.xyz/ipfs/<CID>/path/inside/a/folder.json`

const BASE = 'https://api.gullylabs.xyz/api/ipfs/psa'
const KUBO = `# once: add Gully IPFS as a remote pinning service (a hub key with the ipfs:pin scope)
ipfs pin remote service add gully ${BASE} gl_live_YOUR_KEY

# pin a CID you already have (your node keeps serving it until Gully holds it)
ipfs pin remote add --service=gully --name=site-v1 bafybei...

# list and remove
ipfs pin remote ls --service=gully --status=queued,pinning,pinned,failed
ipfs pin remote rm --service=gully --cid=bafybei...`
const PSA_CURL = `KEY=gl_live_YOUR_KEY
# pin a CID (202: queued; the status moves to pinning, then pinned or failed)
curl -s -X POST ${BASE}/pins -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \\
  -d '{"cid":"bafybei...","name":"site-v1","meta":{"app":"my-app"}}'

# list (default status pinned; also cid, name + match, status, before, after, limit, meta)
curl -s "${BASE}/pins?status=queued,pinning,pinned,failed&limit=50" -H "Authorization: Bearer $KEY"

# one pin, replace it, remove it
curl -s ${BASE}/pins/REQUEST_ID -H "Authorization: Bearer $KEY"
curl -s -X POST ${BASE}/pins/REQUEST_ID -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"cid":"bafybei...new"}'
curl -s -X DELETE ${BASE}/pins/REQUEST_ID -H "Authorization: Bearer $KEY" -o /dev/null -w '%{http_code}\\n'   # 202`
const UPLOAD_CURL = `# a file: added and pinned at once; the answer is a PinStatus with the CID
curl -s -X POST "https://api.gullylabs.xyz/api/ipfs/upload?name=logo.png" \\
  -H "Authorization: Bearer $KEY" --data-binary @logo.png

# a CAR with one root (a whole folder or site, built with ipfs dag export or ipfs-car)
curl -s -X POST https://api.gullylabs.xyz/api/ipfs/upload -H "Authorization: Bearer $KEY" \\
  -H 'Content-Type: application/vnd.ipld.car' --data-binary @site.car`

interface PlansIpfs {
  ipfs?: { plans: { id: string; name: string; storageBytes: number; maxFileBytes: number; maxPins: number; copies: number }[]; paid: { priceUsdPerGbMonth: number | null; checkout: boolean; reason: string } }
}
const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(b % 1024 ** 3 ? 1 : 0)} GB` : `${Math.round(b / 1024 ** 2)} MB`)

/** The plans as the server enforces them (GET /api/plans, field ipfs): nothing typed here. */
function IpfsPlans() {
  const p = useApi<PlansIpfs>('/api/plans', 300_000)
  const free = p && p !== 'error' ? p.ipfs?.plans.find((x) => x.id === 'free') : null
  if (!free) return <P>{p === 'error' ? 'The plans could not be read right now.' : 'Reading the plans…'}</P>
  return (
    <Fields
      rows={[
        [<C>Early access</C>, mb(free.storageBytes), `stored, up to ${free.maxPins} pins, files up to ${mb(free.maxFileBytes)}, every pin on ${free.copies} nodes. Limits during early access, not a plan.`],
        [<C>Plans and prices</C>, 'not set yet', 'The free tier and the price per GB are not set yet. When they are, storage is bought with Gully Pay in the hub.'],
      ]}
    />
  )
}

const CURL = `curl -s https://api.gullylabs.xyz/api/ipfs/stats | jq '{source, pinned, gatewayUp}'`

/** The node's public figures, read every minute: pinned CIDs and gateway response time, each with its line. */
function IpfsLive() {
  const s = useApi<IpfsStats>('/api/ipfs/stats', 60_000)
  const st = s && s !== 'error' ? s : null
  const h = st?.history ?? []
  const labels = h.map((x) => new Date(x.t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }))
  const tiles: { label: string; value: string; data: (number | null)[]; fmt?: (v: number) => string }[] = [
    { label: 'CIDs pinned', value: st?.pinned == null ? 'not readable' : st.pinned.toLocaleString('en-US'), data: h.map((x) => x.pinned) },
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
          The gateway runs with <C>Gateway.NoFetch</C>: it answers only for blocks this node already holds and never fetches other content from the network. It is not a general public gateway: it serves what Gully and its customers pin.
        </Callout>
      </Section>

      <Section id="start" title="Pin in two minutes">
        <List>
          <li>
            Sign in at <Ext href="https://app.gullylabs.xyz/#ipfs">app.gullylabs.xyz</Ext>, open Gully IPFS and press <b>Create a pinning key</b> (or tick <C>ipfs:pin</C> when you create a key on the Keys page). The secret is shown once.
          </li>
          <li>Drop a file in the upload area, or point any Pinning Service API client at the base URL below.</li>
          <li>Your pins, their status and your usage are on the same page. Nobody else sees them.</li>
        </List>
        <CodeBlock code={KUBO} lang="bash" />
      </Section>

      <Section id="psa" title="Pinning Service API">
        <P>
          Gully IPFS implements the <Ext href="https://ipfs.github.io/pinning-services-api-spec/">IPFS Pinning Service API</Ext> v1. Base URL <C>{BASE}</C>, auth <C>Authorization: Bearer gl_live_…</C> with a key that has the <C>ipfs:pin</C> scope.
        </P>
        <Fields
          rows={[
            [<C>GET /pins</C>, '200', 'your pins, newest first: count and results. Filters cid (up to 10), name with match exact, iexact, partial or ipartial, status (default pinned), before, after, limit (1 to 1000, default 10), meta'],
            [<C>POST /pins</C>, '202', 'a Pin object { cid, name?, origins?, meta? }: queued, then pinning, then pinned or failed (status_details says why)'],
            [<C>GET /pins/:requestid</C>, '200', 'one PinStatus'],
            [<C>POST /pins/:requestid</C>, '202', 'replace: a new pin and requestid, the old one removed'],
            [<C>DELETE /pins/:requestid</C>, '202', 'remove the pin'],
            [<C>errors</C>, '400 401 403 404 429 451', '{ error: { reason, details } }: 403 QUOTA_EXCEEDED or FORBIDDEN (no ipfs:pin scope), 451 TAKEN_DOWN, 429 RATE_LIMITED (300 requests a minute per key)'],
          ]}
        />
        <CodeBlock code={PSA_CURL} lang="bash" />
        <Callout label="Size is checked while we fetch">A CID pinned by reference is fetched from the IPFS network. Its size is counted as it arrives: past the room left on your plan the pin fails with a reason, and nothing you already pinned is touched.</Callout>
      </Section>

      <Section id="upload" title="Uploads">
        <P>
          <C>POST https://api.gullylabs.xyz/api/ipfs/upload</C> takes the file as the request body (with a Content-Length), or a CAR with <C>Content-Type: application/vnd.ipld.car</C>. It adds, pins and records it in one step and answers a PinStatus. At most 60 uploads an hour per account.
        </P>
        <CodeBlock code={UPLOAD_CURL} lang="bash" />
      </Section>

      <Section id="limits" title="Plans and limits">
        <IpfsPlans />
        <P>At a limit, new pins and uploads are refused with a reason. Nothing is ever deleted to make room.</P>
      </Section>

      <Section id="policy" title="Content policy">
        <P>
          Pin only content you have the right to publish. No illegal content, no content that sexualises minors, no malware or phishing, no other people&apos;s private data, nothing that infringes copyright. Uploaded and pinned images are scanned automatically, and video, SVG and anything the scanner flags is looked at by a person. Content that
          breaks the policy is taken down: unpinned from every Gully node and refused by the gateway, the same file is refused if it is uploaded again, and the account may be closed. Report content to <Ext href="mailto:team@gullylabs.xyz">team@gullylabs.xyz</Ext>.
        </P>
      </Section>

      <Section id="live" title="Live figures">
        <P>Read from the node every minute by our server (the node&apos;s own API is never public). A figure that cannot be read says so, it is never shown as zero.</P>
        <IpfsLive />
      </Section>

      <Section id="gateway" title="The gateway">
        <P>Address a pinned file, or a file inside a pinned folder, by its CID:</P>
        <CodeBlock code={URLS} lang="text" />
        <List>
          <li>Read-only: GET and HEAD only. Uploads and pins go through the pinning API, never the gateway.</li>
          <li>Two nodes on two servers hold every pin; when one is down, the gateway reads from the other.</li>
          <li>The same CID works on any IPFS gateway or node, because the content is announced to the network.</li>
          <li>CIDs are content hashes: a file at a CID never changes.</li>
        </List>
      </Section>

      <Section id="uses" title="What we pin">
        <List>
          <li>Launchpad token images and metadata, so launch pages and wallets always find them.</li>
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
            [<C>gatewayUp</C>, 'boolean | null', 'whether the gateway answered; null when it could not be reached at all'],
            [<C>gatewayMs</C>, 'number | null', 'its response time'],
            [<C>history</C>, 'array', 'one point a minute for the last hour: t, pinned, up, ms'],
          ]}
        />
      </Section>
    </DocPage>
  )
}
