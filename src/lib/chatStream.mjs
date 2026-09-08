export function parseSSEBlock(block) {
  let event = "message"
  const data = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim()
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
  }
  return { event, data: data.join("\n") }
}

// The application terminal event, not socket closure, determines completion.
export async function postSSE(url, body, { onEvent, signal, deviceId, timeoutMs = 90000, fetchImpl = fetch }) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal?.addEventListener("abort", abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(new DOMException("The assistant response timed out.", "TimeoutError")), timeoutMs)
  let reader
  const emit = raw => {
    const event = parseSSEBlock(raw)
    if (!event.data) return true
    if (event.data.trim() === "[DONE]") return false
    return onEvent?.(event) !== false
  }
  try {
    const response = await fetchImpl(url, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream",
        ...(deviceId ? { "X-CW-Device-Id": deviceId } : {}) },
      body: JSON.stringify(body), mode: "cors", signal: controller.signal,
    })
    if (!response.ok) throw new Error(`SSE HTTP ${response.status}`)
    if (!response.body) throw new Error("ReadableStream not supported")
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let finished = false
    while (!finished) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let boundary
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        if (!emit(block)) {
          finished = true
          break
        }
      }
      if (buffer.length > 1048576) throw new Error("SSE event exceeded the size limit")
      if (done && !finished) {
        if (buffer.trim()) emit(buffer)
        finished = true
      }
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
    controller.abort()
    if (reader) {
      void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
}
