import { useLayoutEffect, useRef } from 'react'

const DURATION_MS = 150

/**
 * FLIP layout animation for a keyed list of elements.
 *
 * Register each element with `setRef(id)`. On every render where `key` changes,
 * surviving elements (present before and after) glide from their old position to
 * their new one. New elements are skipped (no prior rect) so their CSS entrance
 * animation plays instead.
 *
 * `enabled = false` records positions without animating (for reduced motion).
 */
export function useFlip(key: string, enabled: boolean) {
  const nodes = useRef(new Map<string, HTMLElement>())
  const prevRects = useRef(new Map<string, DOMRect>())

  const setRef = (id: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el)
    else nodes.current.delete(id)
  }

  useLayoutEffect(() => {
    // 1. Measure every current node's natural position FIRST (before any
    //    transform is applied, transforms change getBoundingClientRect).
    const newRects = new Map<string, DOMRect>()
    nodes.current.forEach((el, id) => newRects.set(id, el.getBoundingClientRect()))

    if (enabled) {
      const prev = prevRects.current
      nodes.current.forEach((el, id) => {
        const oldRect = prev.get(id)
        const newRect = newRects.get(id)!
        if (!oldRect) return // new element -> let CSS entrance handle it
        const dx = oldRect.left - newRect.left
        const dy = oldRect.top - newRect.top
        if (!dx && !dy) return
        // Invert: jump back to the old spot with no transition.
        el.style.transition = 'none'
        el.style.transform = `translate(${dx}px, ${dy}px)`
        // Play: next frame, animate the transform away, then drop the inline
        // transition so a later exit uses the CSS opacity/transform transition.
        requestAnimationFrame(() => {
          el.style.transition = `transform ${DURATION_MS}ms ease-out`
          el.style.transform = ''
          el.addEventListener(
            'transitionend',
            () => {
              el.style.transition = ''
            },
            { once: true }
          )
        })
      })
    }

    // 2. Record positions for the next render.
    prevRects.current = newRects
  }, [key, enabled])

  return { setRef }
}
