/* The product brand registry: the one place the site takes a product's icon or logo from (owner rule: official kit
   files, byte-identical, never redrawn; products with their own kit keep it). Owner, 2026-11-10, on the landing showing
   the Gully Chain G for Gully Core: "thats not gullycore branding gullylabs not in sync?".

   Every file is a byte-exact copy of `source` (a path under the owner's home folder, C:\Users\Admin) in public/, and
   `sha256` is the source file's hash. scripts/test-product-brands.mjs fails when a served file differs from its hash
   (a redrawn, re-exported or swapped icon), when any page draws a product icon that is not from here, or when a
   product icon path is written anywhere outside this file.

   Readers: the React pages (this module), the server-drawn landing and product pages (server/data/page-content.json
   `brands`, written from this file by scripts/build-page-content.mjs), and any other site: GET /api/brands.

   `icon`     the square mark for discs, tiles and headings. `ground: true` when the file is drawn on its own ground
              (an app tile, it fills the disc); false when the mark is transparent (it sits inset on our dark disc).
   `logo`     the lockup or wordmark for a dark page, when the kit has one (w x h: the file's intrinsic size).
   `ownKit`   false when the product has no kit of its own and borrows its parent's mark (said here, not hidden).
   No imports: Node reads this file itself (type stripping) in scripts/build-page-content.mjs. */

export type BrandKey = 'labs' | 'core' | 'chain' | 'kre8' | 'multisig' | 'id' | 'pay' | 'rpc' | 'holdermaps' | 'security' | 'studio' | 'ai'

export interface BrandFile {
  src: string
  /** Where the kit file is, under C:\Users\Admin (null: no kit file, a derived web copy; said in `note`). */
  source: string | null
  sha256: string
  w?: number
  h?: number
}
export interface ProductBrand {
  name: string
  kit: string
  ownKit: boolean
  icon: BrandFile & { ground: boolean }
  logo?: BrandFile & { src2x?: BrandFile }
  /** Other kit files the site draws (Gully Pay's shield mark, Gully Security's light-ground logo). */
  extra?: Record<string, BrandFile>
  note?: string
}

const GCK = 'Downloads/Gully Core brand kit/Gully Core Graphics'
const GLG = 'Desktop/GULLY LABS GRAPHICS'

export const PRODUCT_BRANDS: Record<BrandKey, ProductBrand> = {
  labs: {
    name: 'Gully Labs',
    kit: 'Gully Labs kit (2026-11-06)',
    ownKit: true,
    icon: { src: '/brand/kit/mark-reversed.svg', source: 'Desktop/GRAPHICS/Gully Labs branding kit (1)/kit/logo/mark-reversed.svg', sha256: 'fb8954c41543fc9eeb6e365e693ebe16a5baf57cd216ee692baac32fe0392ff3', w: 100, h: 96, ground: false },
  },
  core: {
    name: 'Gully Core',
    kit: 'Gully Core brand kit (2026-11-08): orange #FD7716, ink #0F0E0B, cream #FEF4E3',
    ownKit: true,
    icon: { src: '/brand/products/gully-core-icon-ink.svg', source: `${GCK}/02-icon/gully-core-icon-ink.svg`, sha256: '0b432a662bf3edc24b9ffc6c08c4b11ec96abf59ea7f9bcfa9bf8115ab7001dd', w: 1024, h: 1024, ground: true },
    logo: { src: '/brand/products/gully-core-logo-transparent-light.svg', source: `${GCK}/01-logo/gully-core-logo-transparent-light.svg`, sha256: 'b484ec8123382837c1ce826098bfc957fefc24df915a954d0fc81f230d06582f', w: 856, h: 210 },
  },
  chain: {
    name: 'Gully Chain',
    kit: 'Gully Chain kit v4 (2026-10-30), icon-only: the name comes from its badge',
    ownKit: true,
    icon: { src: '/brand/web/logos/gc-icon.svg', source: `${GLG}/Gully Chain/brand-kit-v4/logo/gc-icon.svg`, sha256: '4f86d2a0c2bb1afda317f21ae7c2198564ca61241f2c48cc75df1cb87033739b', w: 220, h: 220, ground: false },
    logo: { src: '/brand/products/gc-badge-dark.png', source: `${GLG}/Gully Chain/brand-kit-v4/badge-dark.png`, sha256: '8ca009ecda8e77d99376532634d06e67815b971119edb3f4f97f4467aa7863e9', w: 960, h: 256 },
  },
  kre8: {
    name: 'kre8',
    kit: 'kre8.fun kit (2026-10-30)',
    ownKit: true,
    icon: { src: '/brand/products/kre8-icon-192.png', source: 'Desktop/GRAPHICS/kre8_brand_kit/png/transparent/kre8-icon-192.png', sha256: 'ea19d53a81352ff4853bf741671918c3cc73e929e7b256f1ea3ef5536a383c24', w: 192, h: 192, ground: true },
    logo: { src: '/brand/products/kre8-wordmark-128h.png', source: 'Desktop/GRAPHICS/kre8_brand_kit/png/transparent/kre8-wordmark-128h.png', sha256: 'd6ac79539b3ba0347cdb4f9e202ec14b8952d20bd4ef2af479d2ca5eddf34f5a', w: 413, h: 128 },
  },
  multisig: {
    name: 'Gully Multisig',
    kit: 'none of its own: the Gully Chain kit v4 mark',
    ownKit: false,
    icon: { src: '/brand/web/logos/gc-icon.svg', source: `${GLG}/Gully Chain/brand-kit-v4/logo/gc-icon.svg`, sha256: '4f86d2a0c2bb1afda317f21ae7c2198564ca61241f2c48cc75df1cb87033739b', w: 220, h: 220, ground: false },
    note: 'No Gully Multisig kit exists on the owner laptop (2026-11-10); it keeps the Gully Chain mark until one is supplied.',
  },
  id: {
    name: 'Gully ID',
    kit: 'Gully ID brand kit v1 (2026-10-28), cyan lynx',
    ownKit: true,
    icon: { src: '/brand/hub/icons/gully-id.svg', source: `${GLG}/Gully ID/brand-kit/icon/gullyid-app-icon.svg`, sha256: '620228e8ee1ca88103ec731334144ef955ebf453e03c2c23bf0c5454d8e86f34', w: 1024, h: 1024, ground: false },
    logo: { src: '/brand/gullyid/gullyid-lockup-on-dark.svg', source: `${GLG}/Gully ID/brand-kit/logo/gullyid-lockup-on-dark.svg`, sha256: 'f21e59f3690c25c3a10a4fc78d39c97e57a13c21a4d7b034d4ad9a32f3212c63', w: 1661.47, h: 491.14 },
  },
  pay: {
    name: 'Gully Pay',
    kit: 'Gully Pay brand kit',
    ownKit: true,
    icon: { src: '/brand/hub/icons/pay.png', source: `${GLG}/Gully Pay/brand-kit/icon/png/gullypay-app-icon-192.png`, sha256: '2920f2f95a4802703574d6c1b1c21248017f7f621282ef0d377a1c45e4ba971e', w: 192, h: 192, ground: true },
    logo: { src: '/brand/products/gullypay-logo-ondark.svg', source: `${GLG}/Gully Pay/brand-kit/logo/gullypay-logo-ondark.svg`, sha256: '7a2b2e2d6fb99b039779c16b1e2a77461db6a69d30bcca4b4a3a99c536b40148', w: 895.23, h: 230.4 },
    extra: { mark: { src: '/brand/products/gullypay-mark.svg', source: `${GLG}/Gully Pay/brand-kit/logo/gullypay-mark.svg`, sha256: '995f377bf942a05c2711ee097847bcb7f396ed5ceea5c52c25bfacff6e666961' } },
  },
  rpc: {
    name: 'Gully RPC',
    kit: 'Gully RPC brand kit',
    ownKit: true,
    icon: { src: '/brand/hub/icons/rpc.png', source: `${GLG}/GullyRPC/brand-kit/icon/gullyrpc-icon-192.png`, sha256: 'b683fff13eefbbbe7c58c8410b1767731cb2c079af8ab289f30499dabc2d11e4', w: 192, h: 192, ground: true },
    logo: { src: '/brand/products/gullyrpc-logo-transparent.png', source: `${GLG}/GullyRPC/brand-kit/logo/gullyrpc-logo-transparent.png`, sha256: '3882a296f67b03a12f7dec614f7f67596173de41a527e69e3229b9275df8ee7f', w: 860, h: 247 },
  },
  holdermaps: {
    name: 'HolderMaps',
    kit: 'HolderMaps brand kit',
    ownKit: true,
    icon: { src: '/brand/hub/icons/holdermaps.png', source: `${GLG}/HolderMaps/brand-kit/icon/icon-192.png`, sha256: 'b0f40e690b909d6d3a4a41cc14148ec09b28e0fc1c5454ea74ac34d529536126', w: 192, h: 192, ground: true },
    logo: {
      src: '/brand/holdermaps/holdermaps-logo-on-dark-sm.png', source: `${GLG}/HolderMaps/brand-kit/logo/holdermaps-logo-on-dark-sm.png`, sha256: 'c16ab89fbb703964e5e850ac04252866f349ad1258fc5b5ef019c23ee267d23e', w: 744, h: 154,
      src2x: { src: '/brand/holdermaps/holdermaps-logo-on-dark.png', source: `${GLG}/HolderMaps/brand-kit/logo/holdermaps-logo-on-dark.png`, sha256: '1b60b5742b761cefad63b7b0123f920612e3a0ac2555bbcb1cd0a27243c012e7', w: 1486, h: 306 },
    },
  },
  security: {
    name: 'Gully Security',
    kit: 'Gully Security brand kit',
    ownKit: true,
    icon: { src: '/brand/hub/icons/security.png', source: `${GLG}/Gully Security/GullySecurity-Brand-Kit/icon/icon-gold-512.png`, sha256: '55539e3cea0b9ddb4ce636f374756b05f7a2c69234a4ef2efcdc345387f81f8b', w: 453, h: 512, ground: false },
    logo: { src: '/brand/products/gullysecurity-logo-primary.svg', source: `${GLG}/Gully Security/GullySecurity-Brand-Kit/logo/logo-primary.svg`, sha256: '7c57ab95e38cc12a43bf3778bbda01327651a1778cecc5a0243e2a76a03b3a50', w: 627, h: 104 },
    extra: { logoOnLight: { src: '/brand/products/gullysecurity-logo-on-light.svg', source: `${GLG}/Gully Security/GullySecurity-Brand-Kit/logo/logo-on-light.svg`, sha256: 'b32fceed37521c009d0f0a8ad6ba027c2b3e37dcce3748a85e753a8b9db37353' } },
  },
  studio: {
    name: 'Gully Studio',
    kit: 'Gully Studio brand kit',
    ownKit: true,
    icon: { src: '/brand/hub/icons/studio.png', source: `${GLG}/Gully Studio/brand-kit/icon/gullystudio-icon-128.png`, sha256: '99b76311fec96cd73102a9758eb59ec05ade20b33ee1bca1148d44e89d007db2', w: 128, h: 128, ground: true },
    logo: { src: '/brand/products/gullystudio-logo-transparent.png', source: `${GLG}/Gully Studio/brand-kit/logo/gullystudio-logo-transparent.png`, sha256: '9ce0e64869cb4f7294917a7ca56a585329b2e1b51e671e0fba1d0d2fe5c0141a', w: 2070, h: 593 },
  },
  ai: {
    name: 'Gully AI',
    kit: 'GullyAI kit (Neon Robot)',
    ownKit: true,
    icon: { src: '/brand/hub/icons/ai.png', source: `${GLG}/GullyAI/kit/favicon/android-chrome-192.png`, sha256: 'f0fa62d127b3a6aa245c73537aaedcb8b9f45af8391301d54360c6c052c1dbd0', w: 192, h: 192, ground: true },
    logo: { src: '/brand/web/logos/gullyai-logo.png', source: null, sha256: 'b88113644ce3833607d2dd474a561e4bdec8d811e09834494c9b02dc9346c377', w: 267, h: 96 },
    note: 'The Gully AI kit has no web-size lockup (gullyai-logo-transparent.png is 1778 x 640, 0.8 MB): the product page draws a resize of it until the owner supplies one.',
  },
}

/** The icon of a product key, or of a Gully Chain feature (bridge, faucet, explorer, quests...: the chain's mark). */
export const brandIcon = (key: BrandKey) => PRODUCT_BRANDS[key].icon
