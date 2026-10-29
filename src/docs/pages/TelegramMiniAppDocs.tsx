import { GapIndexChart } from '../LiveCharts'
import { StatusHistory } from '../ProductCharts'
import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'

const sections = [
  { id: 'open', title: 'Opening the app' },
  { id: 'screens', title: 'Screens' },
  { id: 'alerts', title: 'Alerts from the app' },
  { id: 'auth', title: 'How requests are signed' },
  { id: 'api', title: 'The /api/tg routes' },
  { id: 'limits', title: 'Limits and errors' },
  { id: 'gate', title: 'The News channel here' },
]

export function TelegramMiniAppDocs() {
  return (
    <DocPage
      slug="telegram-mini-app"
      eyebrow="PRODUCTS · TELEGRAM MINI APP"
      title="Telegram Mini App"
      description="The Gully Labs Telegram Mini App at gullylabs.xyz/tg: how it opens, its screens, how each request is signed with Telegram's initData, the /api/tg routes, rate limits and errors."
      lead={
        <>
          The Mini App is the Gully app inside Telegram: the gap list, one stock with an alert composer, a token’s Holder Map and your alerts. It belongs to <DocLink to="telegram">@GullyLabsBot</DocLink>.
        </>
      }
      sections={sections}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3">
        <GapIndexChart />
        <StatusHistory groups={['telegram']} title="TELEGRAM BOT CHECKS, LAST 24 H" />
      </div>

      <Section id="open" title="Opening the app">
        <P>
          The app is served at <Ext href="https://gullylabs.xyz/tg">gullylabs.xyz/tg</Ext> and only works inside Telegram. In a normal browser it shows “Open this inside Telegram” with a link to the bot and to the tracker. Inside Telegram it opens from:
        </P>
        <List>
          <li>the “📱 Open app” button on the bot’s main menu (private chats only: Telegram does not allow this button type in groups);</li>
          <li>
            the <C>/app</C> command in a private chat;
          </li>
          <li>the “👥 Holders” button under a token, which opens that token’s Holder Map screen directly.</li>
        </List>
        <P>
          A Holder Map screen can also be opened with <C>/tg?holders=&lt;chain&gt;:&lt;token&gt;</C>, or with a Telegram start parameter of the form <C>h_&lt;chain&gt;_&lt;token&gt;</C>. Anything malformed is ignored and the app opens on its home screen.
        </P>
        <P>
          The app expands to full height, follows your Telegram theme (colours are mapped onto the site’s tokens and change live when you switch day and night mode), uses Telegram’s Back button to leave a stock or Holder Map screen, and gives haptic feedback on taps where the device supports it.
        </P>
      </Section>

      <Section id="screens" title="Screens">
        <Fields
          head={['Screen', 'Where', 'What it shows']}
          rows={[
            ['Gaps', 'home tab', 'Every tracked stock token across chains, filterable by chain, each with a 24-hour gap line. Tap one to open it.'],
            ['Stock', 'from Gaps', 'A 24-hour gap chart for the token, its status in plain words, and an alert composer. A Holder Map shortcut shows only on chains where the Holder Map has data.'],
            ['My alerts', 'home tab', 'The linked account’s alerts with the plan limit, to pause, resume, test or delete. Also the switch for Gully Labs announcements in your private chat.'],
            ['Holders', 'from a stock or the bot', 'The token’s Holder Map in compact form, and an alert for when its largest connected cluster reaches 10%, 20% or 30%.'],
          ]}
        />
        <P>
          Gaps and statuses come from the same data as the <Ext href="https://gullylabs.xyz/tracker">tracker</Ext>. A token without enough trading says so in words rather than showing a gap. The 24-hour lines come from <C>GET /api/tg/sparks</C>.
        </P>
      </Section>

      <Section id="alerts" title="Alerts from the app">
        <P>
          Alerts belong to a wallet account in the main app. A Telegram user is mapped to the account linked to their private chat with the bot (or, failing that, a group they linked). Until a chat is linked the app shows “not linked”, and creating an alert opens the app dashboard instead; see{' '}
          <DocLink to="telegram" hash="connect">connecting a chat</DocLink>.
        </P>
        <List>
          <li>
            <strong className="text-ink">Gap alert</strong>: on a stock screen, pick a threshold from 0.1 to 100 percent and a direction (above, below or both). Telegram’s main button at the bottom creates it, and it delivers to your linked chat.
          </li>
          <li>
            <strong className="text-ink">Holder Map alert</strong>: on a Holders screen, when the largest connected cluster holds at least the chosen share.
          </li>
        </List>
        <P>
          Alerts are created through the same code as the dashboard, so its validation and your plan’s limits apply, and the app shows the server’s own sentence when it refuses. See <DocLink to="plans-alerts">Plans &amp; alerts</DocLink>. An account blocked from the developer programme cannot create or change alerts.
        </P>
      </Section>

      <Section id="auth" title="How requests are signed">
        <P>
          Every call to <C>/api/tg/*</C> carries the raw <C>initData</C> string Telegram gives the app, in the header <C>Authorization: tma &lt;initData&gt;</C>. The server checks it the way{' '}
          <Ext href="https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app">Telegram’s documentation</Ext> describes: an HMAC-SHA256 over the sorted fields, keyed from the bot token, compared in constant time.
        </P>
        <List>
          <li>
            It is refused when it is missing, longer than 4,096 characters, has no valid <C>hash</C>, repeats a field, has no user, or belongs to a bot.
          </li>
          <li>
            It is refused when its <C>auth_date</C> is older than 24 hours or more than five minutes in the future. An expired session shows “This session has expired”: close the app and open it again.
          </li>
          <li>Nothing is stored as a session and no cookie is set, so there is nothing to carry across sites.</li>
        </List>
      </Section>

      <Section id="api" title="The /api/tg routes">
        <P>These routes exist for the Mini App and need Telegram’s signed <C>initData</C>, so they cannot be called from a script of your own. They are listed so you can see what the app does.</P>
        <Fields
          variant="routes"
          head={['Route', 'What it does', 'Notes']}
          rows={[
            ['GET /api/tg/me', 'Your Telegram user, the News channel status (gate), the linked account (shortened), the dashboard link, whether announcements are on, and the chains that have Holder Map data.', '?fresh=1 re-reads channel membership'],
            ['POST /api/tg/announcements', 'Body { on: boolean }. Turns Gully Labs announcements in your private chat on or off.', '20 a minute; never gated'],
            ['GET /api/tg/sparks', 'Each tracked token’s last 24 hours of gap, thinned to about 24 points, keyed chain:TICKER.', 'cached a minute'],
            ['GET /api/tg/launches', 'Retired on 2026-10-29 with the launches screen.', '410 Gone'],
            ['GET /api/tg/alerts', 'The linked account’s alerts and plan limits, each alert with its last three deliveries.', 'never gated'],
            ['POST /api/tg/alerts', 'Creates a gap alert or a Holder Map alert (kind: holders), both delivered to Telegram.', '30 changes a minute'],
            ['POST /api/tg/alerts/:id/(pause|resume|test|delete)', 'Changes one alert.', 'pause and delete never gated'],
          ]}
        />
      </Section>

      <Section id="limits" title="Limits and errors">
        <Fields
          head={['Status', 'When', 'Meaning']}
          rows={[
            ['401', 'initData missing, invalid or expired', 'The body carries the reason. Reopen the app.'],
            ['403', 'You do not follow the News channel, or the account is blocked from the developer programme', 'For the channel the body also carries gate.'],
            ['404', 'The Mini App is not configured on this server, or an unknown route', 'Nothing to retry.'],
            ['409', 'Alerts without a linked chat', 'The body has linkNeeded and the dashboard link.'],
            ['429', 'Over 120 requests a minute per Telegram user, 30 alert changes, or 20 announcement changes', 'Wait a moment and try again.'],
          ]}
        />
      </Section>

      <Section id="gate" title="The News channel here">
        <Callout label="SAME RULE AS THE BOT">
          Following <Ext href="https://t.me/GullyLabsNews">@GullyLabsNews</Ext> is required to use the app. Without it you get a join screen with a Join button and an “I’ve joined” button. Listing, pausing and deleting your alerts, and the announcements switch, keep working. The details are on the{' '}
          <DocLink to="news-gate">News channel gate</DocLink> page.
        </Callout>
      </Section>
    </DocPage>
  )
}
