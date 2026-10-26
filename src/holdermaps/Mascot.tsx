/* The HolderMaps mascot (kit: Desktop/GULLY LABS GRAPHICS/HolderMaps/Mascot_0*.png), one pose per job:
     map        the hero: reading a map
     point      empty states: "paste a token"
     laptop     loading: "mapping holders"
     hologram   errors: the map did not answer
     backpack   404 and "coming soon": somewhere we have not been yet
   Web copies by scripts/hm-mascots.py in public/brand/holdermaps/mascot/: AVIF and WebP at the master's size (lg) and
   half (sm), the PNG master as the fallback. Never in the critical path: lazy, async decode, low fetch priority, and
   width/height set so nothing shifts when it arrives. The art is opaque on the kit's dark scene, so its edges fade
   into the page (hm.css .hm-masc). Motion: a slow bob (a fade only under reduced motion). */

export type MascotPose = 'map' | 'point' | 'laptop' | 'hologram' | 'backpack'

const SIZE: Record<MascotPose, { w: number; h: number; sm: number }> = {
  point: { w: 325, h: 470, sm: 162 },
  laptop: { w: 325, h: 430, sm: 162 },
  map: { w: 340, h: 470, sm: 170 },
  hologram: { w: 370, h: 470, sm: 185 },
  backpack: { w: 345, h: 465, sm: 172 },
}
const DIR = '/brand/holdermaps/mascot'

export function Mascot({ pose, width, className = '', still = false }: { pose: MascotPose; width: number; className?: string; still?: boolean }) {
  const s = SIZE[pose]
  const set = (ext: string) => `${DIR}/${pose}-sm.${ext} ${s.sm}w, ${DIR}/${pose}-lg.${ext} ${s.w}w`
  const sizes = `${width}px`
  return (
    <picture className={`hm-masc ${still ? '' : 'hm-bob2'} ${className}`} data-pose={pose}>
      <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
      <source type="image/webp" srcSet={set('webp')} sizes={sizes} />
      <img src={`${DIR}/${pose}-lg.png`} srcSet={set('png')} sizes={sizes} width={width} height={Math.round((width * s.h) / s.w)} alt="" loading="lazy" decoding="async" fetchPriority="low" draggable={false} />
    </picture>
  )
}
