export async function uploadStoryToSignedUrl({ signedUrl, file, contentType, fetchImpl = fetch }) {
  if (!signedUrl) throw new Error("Signed upload URL is missing.");
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Prepared image is missing.");

  const response = await fetchImpl(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "max-age=3600",
      "x-upsert": "false",
    },
    body: await file.arrayBuffer(),
  });

  if (response.ok) return;

  let message = `Storage upload failed (${response.status}).`;
  try {
    const payload = await response.json();
    message = payload?.message || payload?.error || message;
  } catch {
    // Keep the status-based fallback when Storage does not return JSON.
  }
  throw new Error(message);
}
