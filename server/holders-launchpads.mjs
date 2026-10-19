// Other launchpads' tokens for the Holder Map (stub on this branch; feat/holder-map-launchpads has the real one).
//
//   knownLaunch(chainKey, token) -> null | { venue, chainId, token, creationBlock, deployer, pool? }
//
// A non-null answer makes the Holder Map run the launch forensics (bundled first-block buys, snipers, the deployer's
// share and funding) for that token, with `venue` named in the words. null means "not a launch we know of": the
// token is then mapped as a plain token. Must never throw and must be cheap; the map wraps it in a timeout anyway.
export async function knownLaunch(chainKey, token) {
  void chainKey
  void token
  return null
}
