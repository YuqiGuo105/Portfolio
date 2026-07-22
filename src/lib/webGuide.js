const PENDING_GUIDE_KEY = "__pending_web_guide_v1"

const GUIDE_TARGETS = Object.freeze({
  "home.about": { route: "/", targetId: "tour-about" },
  "home.background": { route: "/", targetId: "tour-background" },
  "home.projects": { route: "/", targetId: "tour-projects" },
  "home.techBlogs": { route: "/", targetId: "tour-techblogs" },
  "home.lifeBlogs": { route: "/", targetId: "tour-life" },
  "home.dashboard": { route: "/", targetId: "tour-real-time-data" },
  "home.contact": { route: "/", targetId: "tour-contact" },
})

const DEFAULT_CONTROLS = Object.freeze({
  start: "Start web guide",
  previous: "Previous",
  next: "Next",
  done: "Done",
  close: "Close",
})

function cleanText(value, maxLength = 320) {
  if (typeof value !== "string") return ""
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, maxLength)
}

function normalizeControls(raw, language) {
  const fallback = language === "zh"
    ? { start: "开始网页导览", previous: "上一步", next: "下一步", done: "完成", close: "关闭" }
    : DEFAULT_CONTROLS
  return Object.fromEntries(
    Object.entries(fallback).map(([key, value]) => [key, cleanText(raw?.[key], 40) || value]),
  )
}

export function normalizeWebGuidePlan(raw) {
  if (!raw || typeof raw !== "object") return null
  const language = String(raw.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en"
  const seen = new Set()
  const steps = []

  for (const candidate of Array.isArray(raw.steps) ? raw.steps : []) {
    const targetKey = cleanText(candidate?.targetKey, 64)
    const target = GUIDE_TARGETS[targetKey]
    if (!target || seen.has(targetKey)) continue
    seen.add(targetKey)
    const title = cleanText(candidate?.title || candidate?.card?.title, 100)
    const content = cleanText(candidate?.content || candidate?.card?.content, 360)
    if (!title || !content) continue
    steps.push({
      id: cleanText(candidate?.id, 80) || targetKey.replace(/\./g, "-"),
      targetKey,
      route: target.route,
      targetId: target.targetId,
      title,
      content,
      card: {
        title,
        content,
        action: cleanText(candidate?.card?.action, 60)
          || (language === "zh" ? "查看此区域" : "View this section"),
      },
    })
    if (steps.length >= 7) break
  }

  if (!steps.length) return null
  return {
    schemaVersion: 1,
    language,
    autoStart: raw.autoStart === true,
    startMode: raw.startMode === "START_NOW" ? "START_NOW" : "OFFER",
    responseMessage: cleanText(raw.responseMessage, 240),
    controls: normalizeControls(raw.controls, language),
    steps,
    highlights: steps,
  }
}

export function applyWebGuidePlan(rawPlan, { start = false } = {}) {
  if (typeof window === "undefined") return false
  const plan = normalizeWebGuidePlan(rawPlan)
  if (!plan) {
    if (start) window.dispatchEvent(new CustomEvent("cw:site-tour:start"))
    return false
  }

  const firstRoute = plan.steps[0]?.route || "/"
  if (start && window.location.pathname !== firstRoute) {
    try {
      sessionStorage.setItem(PENDING_GUIDE_KEY, JSON.stringify({ plan, start: true }))
    } catch {}
    window.location.assign(firstRoute)
    return true
  }

  window.dispatchEvent(new CustomEvent("cw:guide:highlights", { detail: plan }))
  if (start) {
    window.dispatchEvent(new CustomEvent("cw:site-tour:dynamic", { detail: plan }))
  }
  return true
}

export function consumePendingWebGuide() {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(PENDING_GUIDE_KEY)
    if (!raw) return null
    sessionStorage.removeItem(PENDING_GUIDE_KEY)
    const parsed = JSON.parse(raw)
    const plan = normalizeWebGuidePlan(parsed?.plan)
    return plan ? { plan, start: parsed?.start === true } : null
  } catch {
    return null
  }
}
