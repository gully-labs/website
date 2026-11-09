/* The fixed copy of a tracked stock token's page (src/pages/StockPage.tsx), kept apart so the server can serve the
   same sentences before scripts run (scripts/build-page-content.mjs copies them into server/data/page-content.json).
   {ticker} and {chain} are filled in per page with fillCopy. No figure lives here: every number on the page is read
   live. This file imports nothing at runtime. */

export const STOCK_COPY = {
  headings: {
    gap: 'Gap to fair price',
    depth: 'Pool depth',
    contracts: 'Contracts',
    holders: 'Who holds {ticker}?',
    swaps: 'How swaps work',
    more: 'More on {chain}',
  },
  /** The labels of the two addresses every stock has in its Contracts card. */
  labels: { token: 'TOKEN', feed: 'CHAINLINK FEED' },
  /** The two answers that are the same for every stock and chain (the page adds who runs the swap and what it costs). */
  faq: [
    { q: 'Does Gully Labs hold my funds?', a: 'No. Your wallet signs each transaction and tokens move straight between your wallet and the exchange contracts. Gully Labs never has custody and cannot reverse a swap.' },
    { q: 'Who can use it?', a: 'Not US persons, and not in sanctioned regions; the card stays closed there. {ticker} is issued by a third party whose own terms apply and who can pause or block the token.' },
  ],
  disclaimer: 'Information only, not investment advice. Gaps can close or widen before a trade lands, and pools carry fees and slippage. Stock tokens are issued by third parties who can pause, block or change them, and may not be available where you live.',
}

export const fillCopy = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '')
