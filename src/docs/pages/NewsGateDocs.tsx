import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'

const sections = [
  { id: 'rule', title: 'The rule' },
  { id: 'check', title: 'How membership is checked' },
  { id: 'never', title: 'What is never gated' },
  { id: 'groups', title: 'In groups' },
  { id: 'miniapp', title: 'In the Mini App' },
  { id: 'fail-open', title: 'When the check cannot run' },
]

export function NewsGateDocs() {
  return (
    <DocPage
      slug="news-gate"
      eyebrow="PRODUCTS · TELEGRAM NEWS GATE"
      title="News channel gate"
      description="Why the Gully Labs Telegram bot and Mini App ask you to follow @GullyLabsNews, how membership is checked and cached, and everything that stays open without it: alerts, Mute, pausing, deleting and unlinking."
      lead={
        <>
          To use the bot’s features you follow <Ext href="https://t.me/GullyLabsNews">@GullyLabsNews</Ext>, our news channel. The gate only guards new feature use. Anything that stops, mutes or removes something you already set up stays open.
        </>
      }
      sections={sections}
    >
      <Section id="rule" title="The rule">
        <P>
          Menus, commands, Gully AI and the <DocLink to="telegram-mini-app">Mini App</DocLink> need you to follow the channel. If you do not, the bot answers with “Follow Gully Labs News to use this bot” and two buttons: Join the channel, and “✅ I’ve joined”, which checks again straight away. When the check passes, the main menu opens.
        </P>
        <P>
          The channel is set on the server by <C>TELEGRAM_REQUIRED_CHANNEL</C>: <C>@GullyLabsNews</C> by default, and the value <C>off</C> disables the gate.
        </P>
      </Section>

      <Section id="check" title="How membership is checked">
        <P>
          The bot asks Telegram (<C>getChatMember</C>) whether you are the channel’s creator, an administrator or a member, or a restricted user who is still a member. Anything else counts as not following.
        </P>
        <Fields
          head={['Case', 'Remembered for', 'Why']}
          rows={[
            ['You follow', '30 minutes', 'So every tap is not a call to Telegram.'],
            ['You do not follow', '20 seconds', 'So joining takes effect almost at once.'],
            ['You tap “I’ve joined”', 'checked fresh', 'The remembered answer is skipped for that check.'],
          ]}
        />
        <P>
          The result is also kept with your bot-user record (whether you follow, as last read), as described in the privacy section of the <DocLink to="telegram" hash="privacy">Telegram bot</DocLink> page.
        </P>
      </Section>

      <Section id="never" title="What is never gated">
        <Callout label="ALERTS ARE NEVER GATED">
          Alert deliveries and their Mute buttons always work, followed or not. Alerts are part of a service you may have paid for, and someone who leaves the channel must still be able to stop what they set up.
        </Callout>
        <P>Also open without the channel:</P>
        <List>
          <li>
            listing your alerts (<C>/alerts</C>) and pausing, resuming, muting, testing or deleting them, and muting all of them;
          </li>
          <li>
            Gully Security monitor alerts and their Mute buttons (<C>/monitors</C>);
          </li>
          <li>
            Settings: unlinking a chat, and switching announcements or usage notices off; <C>/stop</C>;
          </li>
          <li>
            linking a chat with <C>/start</C> and a code from the app.
          </li>
        </List>
        <P>
          Creating a new alert, opening a stock, the top gaps, launches and Gully AI wait for the channel. A first <C>/start</C> in a private chat is still recorded before the gate answers.
        </P>
      </Section>

      <Section id="groups" title="In groups">
        <P>
          In a group the bot ignores ordinary chatter and only reacts to its own commands. A member who does not follow gets the join screen at most once every 30 minutes, so one person’s commands do not fill the group; their other commands are dropped quietly in between. Pressing a button in a group gets a short “Follow Gully Labs News first” notice instead of a message.
        </P>
      </Section>

      <Section id="miniapp" title="In the Mini App">
        <P>
          The Mini App applies the same gate on the server. <C>GET /api/tg/me</C> reports whether you follow, and the app shows the join screen with Join and “I’ve joined” (which re-reads membership fresh). Every feature route answers <C>403</C> with the gate details until you follow.
        </P>
        <P>
          The exits stay open: <C>GET /api/tg/alerts</C>, pausing and deleting an alert, and the announcements switch. If your chat is linked, the join screen lists your alerts with pause and delete so you can stop them without joining.
        </P>
      </Section>

      <Section id="fail-open" title="When the check cannot run">
        <P>
          Telegram only answers membership questions for a channel when the bot is an administrator there. If the check itself fails (which is not the same as “not a member”), the bot lets people through rather than locking everyone out, and logs a warning for us, at most once every ten minutes. A broken gate never blocks you.
        </P>
        <P>
          See <DocLink to="telegram">Telegram bot</DocLink> for commands and menus, and the live webhook check on <DocLink to="status">Status</DocLink>.
        </P>
      </Section>
    </DocPage>
  )
}
