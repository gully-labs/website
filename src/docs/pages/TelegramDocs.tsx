import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { AlertChannelsPanel, StatusHistory } from '../ProductCharts'

const sections = [
  { id: 'what', title: 'What the bot does' },
  { id: 'live', title: 'Live status' },
  { id: 'channel', title: 'The News channel' },
  { id: 'commands', title: 'Commands' },
  { id: 'menus', title: 'Menus' },
  { id: 'connect', title: 'Connecting a chat' },
  { id: 'alerts', title: 'Alerts and Mute' },
  { id: 'mini-app', title: 'The Mini App' },
  { id: 'groups', title: 'Groups' },
  { id: 'privacy', title: 'Announcements and privacy' },
]

export function TelegramDocs() {
  return (
    <DocPage
      slug="telegram"
      eyebrow="PRODUCTS · TELEGRAM"
      title="Telegram bot"
      description="The @GullyLabsBot Telegram bot and its Mini App: commands, menus, gap and launch alerts with Mute, connecting a chat from the app, the @GullyLabsNews channel requirement, groups and announcements."
      lead={
        <>
          <Ext href="https://t.me/GullyLabsBot">@GullyLabsBot</Ext> puts the tracker, DeepCore launches, your alerts and Gully AI in Telegram, with a Mini App for the full screens.
        </>
      }
      sections={sections}
    >
      <Section id="what" title="What the bot does">
        <List>
          <li>Looks up any stock token the tracker follows, on Robinhood Chain, BNB Chain and Solana, with its gap to the fair price and a 24-hour sparkline.</li>
          <li>Lists the widest gaps now and the biggest gap moves over 24 hours and one hour.</li>
          <li>Shows the newest DeepCore launches, per chain, and can alert you to new ones.</li>
          <li>Delivers your gap, launch and Holder Map alerts, and lets you pause, mute, test or delete them.</li>
          <li>Answers questions through <DocLink to="gully-ai">Gully AI</DocLink>.</li>
        </List>
        <P>A figure the bot could not read is called unreadable, never shown as zero.</P>
      </Section>

      <Section id="live" title="Live status">
        <P>
          Which alert channels this server offers right now, and the server’s own check of the bot’s webhook over the last 24 hours (Telegram’s <C>getWebhookInfo</C>: updates waiting and the last delivery error). The full picture is on the{' '}
          <DocLink to="status">Status</DocLink> page.
        </P>
        <AlertChannelsPanel />
        <StatusHistory ids={['telegram']} title="TELEGRAM BOT WEBHOOK, LAST 24 H" />
      </Section>

      <Section id="channel" title="The News channel">
        <P>
          Using the bot’s menus, commands, Gully AI and the Mini App requires following <Ext href="https://t.me/GullyLabsNews">@GullyLabsNews</Ext>, our news channel. Without it the bot shows a “Join @GullyLabsNews” button and an
          “I’ve joined” button that checks again.
        </P>
        <Callout label="ALERTS ARE NEVER GATED">
          Alert deliveries and their Mute buttons always work, followed or not: alerts are part of a service you may have paid for. So do the ways out: listing, pausing and deleting your own alerts, and stopping announcements.
        </Callout>
        <P>If Telegram cannot tell the bot whether you follow the channel, the bot lets you through rather than locking you out.</P>
      </Section>

      <Section id="commands" title="Commands">
        <P>The Menu button next to the text box lists these. Each one opens the matching screen.</P>
        <Fields
          head={['Command', 'Where', 'What it does']}
          rows={[
            ['/start', 'private', 'The main menu (with a code from the app: links this chat)'],
            ['/app', 'private', 'Opens the Mini App'],
            ['/gap NVDA', 'private, groups', 'One stock token’s card'],
            ['/top', 'private, groups', 'The tokens furthest from their real share price'],
            ['/movers', 'private', 'Biggest gap moves in 24 hours'],
            ['/launches', 'private, groups', 'Newest tokens launched on DeepCore'],
            ['/alerts', 'private', 'Your alerts: pause, mute, test or delete'],
            ['/ask', 'private', 'Ask Gully AI a question'],
            ['/help', 'private, groups', 'What the bot does'],
            ['/stop', 'private', 'Stop announcements, or unlink this chat'],
          ]}
        />
        <P>
          <C>/menu</C> still works when typed; it is the same screen as <C>/start</C>.
        </P>
      </Section>

      <Section id="menus" title="Menus">
        <P>The bot is menu-driven: each screen is one message, edited in place as you tap. The main menu leads to:</P>
        <List>
          <li>
            <strong className="text-ink">Stocks</strong>: pick a chain, then a ticker (or search), then the stock card with its 24-hour sparkline and a step-by-step alert maker (threshold, then direction: premium, discount or both).
          </li>
          <li>
            <strong className="text-ink">Top gaps</strong> and <strong className="text-ink">Movers</strong> (24 h or 1 h).
          </li>
          <li>
            <strong className="text-ink">DeepCore launches</strong>: filter by chain, open a launch, set a new-launch alert, or open its Holder Map.
          </li>
          <li>
            <strong className="text-ink">My alerts</strong>: pause, resume, mute for 24 hours, send a test, or delete.
          </li>
          <li>
            <strong className="text-ink">Gully AI</strong>: type a question, or tap an example. Answers arrive as new messages so the next screen never overwrites them.
          </li>
          <li>
            <strong className="text-ink">Settings</strong>: mute every alert for 24 hours, usage notices on or off, announcements on or off, unlink this chat.
          </li>
        </List>
      </Section>

      <Section id="connect" title="Connecting a chat">
        <P>Alerts belong to a wallet account in the app. You connect a Telegram chat to it once, with no chat id to copy:</P>
        <List>
          <li>
            Open the app at <Ext href="https://app.gullylabs.xyz/#alerts">app.gullylabs.xyz</Ext>, go to Alerts and choose <strong className="text-ink">Connect Telegram</strong>.
          </li>
          <li>The app makes a one-time code (valid for 10 minutes, usable once; only its hash is stored) and opens the bot with it. Press Start.</li>
          <li>The bot confirms the link. New alerts deliver to that chat by default.</li>
        </List>
        <P>
          One chat per account: a newer link replaces the older one. <C>/stop</C> or Settings → Unlink removes it. Alerts follow the same plan limits as in the app; see <DocLink to="plans-alerts">Plans &amp; alerts</DocLink>.
        </P>
      </Section>

      <Section id="alerts" title="Alerts and Mute">
        <P>
          Gap alerts, DeepCore new-launch alerts and Holder Map alerts are created in the app, the bot or the Mini App, all through the same rules. Each delivery carries a <strong className="text-ink">Mute 24h</strong> button that silences that
          alert for a day; Settings can mute every alert at once.
        </P>
        <P>Sending respects Telegram’s own limits (about one message a second per chat), so a burst of alerts arrives spread out rather than dropped.</P>
      </Section>

      <Section id="mini-app" title="The Mini App">
        <P>
          The Mini App is the Gully app inside Telegram, at <Ext href="https://gullylabs.xyz/tg">gullylabs.xyz/tg</Ext>. Open it from the “📱 Open app” button on the main menu, from <C>/app</C>, or from the bot profile’s Open app button.
        </P>
        <List>
          <li>
            <strong className="text-ink">Gaps</strong>: every tracked token across chains with its 24-hour gap line.
          </li>
          <li>
            <strong className="text-ink">Stock</strong>: a 24-hour chart and an alert composer; Telegram’s main button creates the alert.
          </li>
          <li>
            <strong className="text-ink">Launches</strong>: DeepCore launches per chain, each with its Holder Map.
          </li>
          <li>
            <strong className="text-ink">My alerts</strong>: your linked account’s alerts, to pause, resume, test or delete.
          </li>
          <li>
            <strong className="text-ink">Holders</strong>: a token’s Holder Map, opened from the bot’s “👥 Holders” button.
          </li>
        </List>
        <P>
          It follows your Telegram theme. Every request is signed with the data Telegram gives the app, checked on our server and refused when older than 24 hours; nothing is stored as a session. The News channel requirement applies here too, with
          the same exits left open. More: <DocLink to="telegram-mini-app">Telegram Mini App</DocLink>.
        </P>
      </Section>

      <Section id="groups" title="Groups">
        <P>
          Add the bot to a group to use <C>/gap</C>, <C>/top</C>, <C>/launches</C> and <C>/help</C> there. Telegram does not allow the Mini App button in groups. A group can receive alerts: link it with a code from the app the same way. Only the
          person who linked a group can unlink it, or create, pause, mute, test or delete alerts there. Gully AI never reads a workspace from a group.
        </P>
      </Section>

      <Section id="privacy" title="Announcements and privacy">
        <P>
          When you start the bot in a private chat we record when you first and last used it, your language, whether the chat is linked, whether you follow the News channel as last read, and whether you opted out of announcements. Occasional
          announcements go to private chats only; “🔕 Stop announcements” on any of them, or <C>/stop announcements</C>, turns them off. That never stops your alerts.
        </P>
        <P>
          Details are in the privacy policy at <Ext href="https://gullylabs.xyz/legal/privacy">gullylabs.xyz/legal/privacy</Ext>.
        </P>
      </Section>
    </DocPage>
  )
}
