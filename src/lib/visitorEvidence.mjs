export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function sha256(value) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Hash the captured bytes, not a fresh serialization of database jsonb.
export async function verifyEvidencePackage(bundle) {
  if (!bundle || typeof bundle.canonicalManifest !== 'string' || bundle.canonicalManifest.length > 4_000_000
    || !/^[a-f0-9]{64}$/.test(bundle.manifestSha256 || '')) throw new Error('Invalid evidence package.');
  let manifest;
  try { manifest = JSON.parse(bundle.canonicalManifest); } catch { throw new Error('Invalid manifest JSON.'); }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.receipts) || manifest.receipts.length > 500) throw new Error('Unsupported evidence schema.');
  const manifestValid = await sha256(bundle.canonicalManifest) === bundle.manifestSha256
    && canonicalJson(manifest) === canonicalJson(bundle.manifest) && bundle.batchId === manifest.batchId;
  let receiptHashesValid = true;
  const ids = new Set();
  for (const receipt of manifest.receipts) {
    if (typeof receipt.canonicalEvidence !== 'string' || receipt.canonicalEvidence.length > 32_000
      || ids.has(String(receipt.receiptId)) || !receipt.receiptId
      || await sha256(receipt.canonicalEvidence) !== receipt.evidenceSha256) receiptHashesValid = false;
    ids.add(String(receipt.receiptId));
  }
  return { batchId: manifest.batchId, status: manifestValid && receiptHashesValid ? 'verified' : 'tampered',
    manifestValid, receiptHashesValid, sourceIntegrity: 'not_checked', receiptCount: manifest.receipts.length };
}
