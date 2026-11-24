// What the "how this was answered" panel shows for one assistant turn.
// Only fields the widget already holds are read; nothing here is estimated or invented.

const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null

/**
 * The steps of a turn, in order. The backend's public execution record is preferred; a turn
 * without one falls back to the stages the browser saw, then lists the tools that were called.
 * `stageLabel(stage, title)` names a browser-side stage.
 */
export function runSteps(message, stageLabel = (stage, title) => title || stage) {
  const steps = []
  const record = Array.isArray(message?.publicRunEvents) ? message.publicRunEvents : []
  if (record.length) {
    for (const event of record) {
      steps.push({ key: `run-${event.stage}`, label: event.label,
        status: event.status === "started" ? (message.streaming ? "running" : "incomplete") : event.status,
        durationMs: finite(event.durationMs), inputTokens: finite(event.inputTokens),
        outputTokens: finite(event.outputTokens), costUsd: finite(event.costUsd) })
    }
  } else {
    for (const stage of Array.isArray(message?.executionStages) ? message.executionStages : []) {
      if (stage?.stage === "connecting") continue
      const ended = stage.tsEnd || ["completed", "failed"].includes(stage.status)
      steps.push({ key: `stage-${stage.id}`, label: stageLabel(stage.stage, stage.title),
        status: stage.status === "failed" ? "failed" : ended ? "completed" : message.streaming ? "running" : "incomplete",
        durationMs: finite(stage.durationMs) ?? (stage.ts && stage.tsEnd ? finite(stage.tsEnd - stage.ts) : null),
        inputTokens: null, outputTokens: null, costUsd: null })
    }
  }
  for (const tool of Array.isArray(message?.toolCards) ? message.toolCards : []) {
    steps.push({ key: `tool-${tool.id}`, label: tool.toolName || tool.title || "Tool", tool: true,
      status: tool.tsEnd ? "completed" : message.streaming ? "running" : "incomplete",
      durationMs: finite(tool.durationMs), inputTokens: null, outputTokens: null, costUsd: null })
  }
  return steps
}

/**
 * Totals for the summary line. `wallMs` is the time the browser waited, first stage to last;
 * step durations are not added up because the backend runs some of them side by side.
 */
export function runTotals(message, steps) {
  const stages = Array.isArray(message?.executionStages) ? message.executionStages : []
  const starts = stages.map(stage => stage?.ts).filter(Number.isFinite)
  const ends = stages.map(stage => stage?.tsEnd).filter(Number.isFinite)
  const wallMs = starts.length && ends.length ? finite(Math.max(...ends) - Math.min(...starts)) : null
  const sum = key => {
    const values = steps.map(step => step[key]).filter(value => value != null)
    return values.length ? values.reduce((total, value) => total + value, 0) : null
  }
  return { wallMs, inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), costUsd: sum("costUsd"),
    failed: Boolean(message?.errorCode) || steps.some(step => step.status === "failed") }
}

export function formatMs(ms) {
  if (ms == null) return ""
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`
}

export function formatCost(usd) {
  if (usd == null) return ""
  if (usd === 0) return "$0"
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

export const formatCount = value => value == null ? "" : new Intl.NumberFormat("en-US").format(value)

const words = value => (typeof value === "string" ? value.trim() : "")

/**
 * What a Deep answer did before it was written: the steps it reported, and the plan it made.
 * While the answer is being prepared this is the list on screen; afterwards it is part of the
 * record under the answer. A turn that reported neither returns null.
 */
export function researchRecord(message) {
  const steps = (Array.isArray(message?.reasoningSteps) ? message.reasoningSteps : [])
    .map(step => ({ label: words(step?.label), detail: words(step?.detail), done: step?.completed === true }))
    .filter(step => step.label)
  const plan = (Array.isArray(message?.planPayload?.subtasks) ? message.planPayload.subtasks : [])
    .map(task => (typeof task === "string"
      ? { label: words(task), detail: "", done: false }
      : { label: words(task?.text) || words(task?.name), detail: "", done: task?.status === "complete" }))
    .filter(task => task.label)
  if (!steps.length && !plan.length) return null
  // The step in hand is the last one that has not reported back; nothing is in hand once the turn ends.
  const open = message?.streaming ? steps.findLastIndex(step => !step.done) : -1
  return { steps: steps.map((step, index) => ({ ...step, active: index === open })), plan, current: open >= 0 ? steps[open].label : "" }
}
