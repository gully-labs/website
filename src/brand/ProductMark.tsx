import { PRODUCT_BRANDS, type ProductBrandKey } from './products'

/** A product's mark (the logo's own mark, cut from its kit logo on the logo's backdrop colour; src/brand/products.ts),
    as a small rounded tile. */
export function ProductMark({ product, size = 32, label, decorative = false, className = '' }: { product: ProductBrandKey; size?: number; label?: string; decorative?: boolean; className?: string }) {
  const b = PRODUCT_BRANDS[product]
  return (
    <img
      src={b.mark}
      width={size}
      height={size}
      alt={decorative ? '' : (label ?? b.name)}
      aria-hidden={decorative || undefined}
      decoding="async"
      draggable={false}
      data-product-mark={product}
      className={`block shrink-0 ${className.includes('rounded-') ? '' : 'rounded-md'} ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
