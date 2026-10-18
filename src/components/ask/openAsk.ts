/** The window event AskLauncher listens for; openAsk() fires it (a link or button anywhere on the page). */
export const ASK_OPEN_EVENT = 'gully:ask-open'
export const openAsk = () => window.dispatchEvent(new Event(ASK_OPEN_EVENT))
