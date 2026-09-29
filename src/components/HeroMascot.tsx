/** Stacked logo with a pulsing glow and two counter-rotating orbit rings. */
export function HeroMascot() {
  return (
    <div className="relative size-[clamp(180px,20cqw,280px)] flex-none">
      <div
        className="absolute inset-[8%] animate-glow rounded-full"
        style={{ background: 'radial-gradient(circle,rgba(232,192,96,.45),transparent 65%)' }}
      />
      <div
        className="absolute inset-0 animate-spin-slow rounded-full"
        style={{ border: '1px dashed rgba(232,192,96,.45)' }}
      >
        <span className="absolute top-[-5px] left-1/2 ml-[-5px] size-[10px] rounded-full bg-gold shadow-[0_0_14px_#e8c060]" />
      </div>
      <div
        className="absolute inset-[10%] animate-spin-rev rounded-full"
        style={{ border: '1px solid rgba(111,207,106,.25)' }}
      >
        <span className="absolute bottom-[-4px] left-1/2 ml-[-4px] size-2 rounded-full bg-green shadow-[0_0_12px_#6fcf6a]" />
      </div>
      <img
        src="/assets/logo-stacked-dark.png"
        alt="Gully Labs mascot"
        width={1000}
        height={1000}
        fetchPriority="high"
        className="absolute inset-[6%] size-[88%] animate-float rounded-full object-cover object-[center_22%]"
        style={{
          WebkitMaskImage: 'radial-gradient(circle at 50% 45%,#000 52%,transparent 70%)',
          maskImage: 'radial-gradient(circle at 50% 45%,#000 52%,transparent 70%)',
        }}
      />
    </div>
  )
}
