export function tourPetDimensions(width, height = 900) {
    const compact = width < 380 || height < 560
    const mobile = width < 640
    return { width: compact ? 88 : mobile ? 104 : 144,
        height: compact ? 104 : mobile ? 122 : 168,
        margin: mobile ? 20 : 28, minY: mobile ? 92 : 106 }
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
