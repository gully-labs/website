/** "GULLY" in ink + "LABS" in gold. The header version shimmers. */
export function Wordmark({ size, shimmer = false }: { size: number; shimmer?: boolean }) {
  return (
    <span
      className="flex gap-2 font-display font-extrabold tracking-[1px]"
      style={{ fontSize: size }}
    >
      <span>GULLY</span>
      {shimmer ? (
        <span
          className="animate-shimmer bg-clip-text text-transparent"
          style={{
            backgroundImage: 'linear-gradient(100deg,#b88f3a 20%,#fff1c2 40%,#f0c865 50%,#7c8a3f 80%)',
            backgroundSize: '200% 100%',
          }}
        >
          LABS
        </span>
      ) : (
        <span className="text-gold">LABS</span>
      )}
    </span>
  )
}
