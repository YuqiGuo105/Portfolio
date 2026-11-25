export function tourPetDimensions(width, height = 900) {
    const compact = width < 380 || height < 560
    const mobile = width < 640
    return { width: compact ? 88 : mobile ? 104 : 144,
        height: compact ? 104 : mobile ? 122 : 168,
        margin: mobile ? 20 : 28, minY: mobile ? 92 : 106 }
}

// How far down his box his feet are. The figure is fitted to the box's width and centred in its
// height, so this is not a fixed share of the height.
export function tourPetGround(width, height) {
    return height / 2 + width * 0.4146
}

export function frameTourTarget(rect, width, height, dockTop) {
    if (!rect || width <= 0 || height <= 0) return null
    const topLimit = Math.min(96, height * 0.2)
    const bottomLimit = Math.max(topLimit, Math.min(height - 16, dockTop - 16))
    const left = Math.max(12, rect.left - 10)
    const top = Math.max(topLimit, rect.top - 10)
    const right = Math.min(width - 12, rect.left + rect.width + 10)
    const bottom = Math.min(bottomLimit, rect.top + rect.height + 10)
    if (right - left < 16 || bottom - top < 16) return null
    return { left, top, width: right - left, height: bottom - top }
}

const overlaps = (a, b, padding = 0) => !(a.right + padding < b.left || a.left - padding > b.right || a.bottom + padding < b.top || a.top - padding > b.bottom)

// Where Mr. Pot stands for a chapter: on the frame round the section if there is room, otherwise in a
// free corner. Never under the dock.
export function placeTourPet({ target, dock, viewport, pet }) {
    const { width: viewWidth, height: viewHeight } = viewport
    const { width, height, margin } = pet
    const top = viewWidth < 640 ? 82 : 96
    const lowest = viewHeight - height - margin, rightmost = viewWidth - width - margin
    const spots = []
    if (target) {
        const right = target.left + target.width, bottom = target.top + target.height, side = target.top + Math.min(72, target.height * 0.25)
        spots.push({ x: right - width - 24, y: target.top - height - 16 }, { x: target.left + 24, y: target.top - height - 16 },
            { x: right + 16, y: side }, { x: target.left - width - 16, y: side },
            { x: right - width - 24, y: bottom + 16 }, { x: target.left + 24, y: bottom + 16 })
    }
    spots.push({ x: margin, y: lowest }, { x: rightmost, y: lowest }, { x: margin, y: viewWidth < 640 ? 92 : 120 }, { x: rightmost, y: viewWidth < 640 ? 92 : 120 })
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
    return spots
        .map(spot => ({ x: clamp(spot.x, margin, rightmost), y: clamp(spot.y, top, lowest) }))
        .find(spot => !dock || !overlaps({ left: spot.x, top: spot.y, right: spot.x + width, bottom: spot.y + height }, dock, 14))
        || { x: margin, y: lowest }
}

// Only expose links already present in this public section, never invent evidence.
export function collectTourDiscoveries(section, origin) {
    if (!section) return []
    const seen = new Set()
    const results = []
    for (const link of Array.from(section.querySelectorAll('a[href]')).slice(0, 60)) {
        let url
        try { url = new URL(link.getAttribute('href'), origin) } catch { continue }
        if (url.origin !== origin || !/^\/(work-single|blog-single|life-blog)\//.test(url.pathname)) continue
        if (seen.has(url.pathname) || link.closest('[aria-hidden="true"]')) continue
        const item = link.closest('.archive-item') || link
        const title = (item.querySelector('h3, h4')?.textContent || link.querySelector('img')?.alt || '').trim()
        if (!title) continue
        seen.add(url.pathname)
        results.push({ href: url.pathname, title: title.slice(0, 160),
            excerpt: (item.querySelector('p')?.textContent || Array.from(item.querySelectorAll('.proj-tech-tag')).map(tag => tag.textContent.trim()).join(' / ')).trim().slice(0, 300),
            image: item.querySelector('img')?.currentSrc || item.querySelector('img')?.src || '', element: item })
        if (results.length === 3) break
    }
    return results
}
