/** The window event AskLauncher listens for; openAsk() fires it (a link or button anywhere on the page). */
export const ASK_OPEN_EVENT = 'gully:ask-open'
export const openAsk = () => window.dispatchEvent(new Event(ASK_OPEN_EVENT))
/** Fired by a result inside the panel that navigates away (the Holder Map hit): the launcher closes the panel. */
export const ASK_CLOSE_EVENT = 'gully:ask-close'
