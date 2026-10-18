/* Links that open in a new tab say so: a visible ↗ (ArrowMark) and, for screen readers, NewTabNote. */

export function NewTabNote() {
  return <span className="sr-only"> (opens in a new tab)</span>
}

/** ↗ plus the screen-reader note, for text links. */
export function ArrowMark() {
  return (
    <>
      <span aria-hidden> ↗</span>
      <NewTabNote />
    </>
  )
}
