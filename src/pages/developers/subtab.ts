import { useCallback, useEffect, useState } from 'react'

/* The page's current sub-tab (SubTabs in ui.tsx): deep-linkable as #<page>/<sub> (e.g. #merchant/links),
   the last one remembered per page in this browser. */

const subKey = (page: string) => `gully:sub:${page}`

function subFromHash<T extends string>(page: string, ids: readonly T[]): T | null {
  const h = window.location.hash.slice(1)
  const [p, s] = h.split('/')
  return p === page && s && (ids as readonly string[]).includes(s) ? (s as T) : null
}

function subFromStore<T extends string>(page: string, ids: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(subKey(page))
    return v && (ids as readonly string[]).includes(v) ? (v as T) : null
  } catch {
    return null
  }
}

/** The page's current sub-tab: from #<page>/<sub>, else the one last used here, else `fallback`. Setting it
    writes both the hash (replaceState, so Back leaves the page) and the remembered choice. */
export function useSubTab<T extends string>(page: string, ids: readonly T[], fallback: T, { hashOnOpen = true }: { hashOnOpen?: boolean } = {}): [T, (s: T) => void] {
  const [sub, setSub] = useState<T>(() => subFromHash(page, ids) ?? subFromStore(page, ids) ?? fallback)
  useEffect(() => {
    const on = () => {
      const s = subFromHash(page, ids)
      if (s) setSub(s)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [page, ids])
  // Show the sub-tab in the address bar from the start, so the URL can be copied as is.
  // (hashOnOpen false: only once the user picks a sub-tab, for the home page whose URL has no hash.)
  const [picked, setPicked] = useState(false)
  useEffect(() => {
    if (!hashOnOpen && !picked) return
    if (window.location.hash.slice(1) !== `${page}/${sub}`) history.replaceState(null, '', `#${page}/${sub}`)
  }, [page, sub, hashOnOpen, picked])
  const set = useCallback(
    (s: T) => {
      setSub(s)
      setPicked(true)
      try {
        localStorage.setItem(subKey(page), s)
      } catch {
        /* private mode: not remembered */
      }
    },
    [page],
  )
  return [sub, set]
}

