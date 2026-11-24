import { FileText, Image as ImageIcon, Sheet, X } from "lucide-react"
import { fileKind, fileSize } from "./fileMeta.mjs"

const ICONS = { image: ImageIcon, table: Sheet, document: FileText }

/**
 * One attached file, in the tray above the message box or inside a sent message.
 * The same card through its three states, so nothing jumps when an upload finishes:
 * uploading (a line fills along the bottom), ready (type and size), failed.
 */
export default function AttachmentChip({ name, href, status = "ready", progress = 0, sizeBytes, mimeType, onRemove }) {
  const { label, icon } = fileKind(name, mimeType)
  const Icon = ICONS[icon]
  const uploading = status === "uploading"
  const failed = status === "error"
  const percent = Math.max(0, Math.min(100, Math.round(progress || 0)))
  const facts = [label, fileSize(sizeBytes)].filter(Boolean).join(", ")
  const body = (
    <>
      <span className="cw-file-kind" aria-hidden="true"><Icon size={17} /></span>
      <span className="cw-file-text">
        <span className="cw-chip-name" title={name}>{name}</span>
        {uploading ? <span className="cw-file-facts" role="status">{`Uploading ${percent}%`}</span>
          : failed ? <span className="cw-chip-meta cw-chip-err">Upload failed</span>
            : <span className="cw-file-facts">{facts}</span>}
      </span>
    </>
  )
  return (
    // Tests and the upload flow tell the states apart by these class names: a file still uploading
    // is `cw-prog`, one that has settled (ready or failed) is `cw-chip`.
    <div className={`cw-file ${uploading ? "cw-prog" : "cw-chip"}${failed ? " is-failed" : ""}`}>
      {href ? <a className="cw-file-main" href={href} target="_blank" rel="noreferrer noopener">{body}</a> : <span className="cw-file-main">{body}</span>}
      {onRemove && !uploading ? (
        <button type="button" className="cw-chip-x" onClick={onRemove} aria-label="Remove file" title="Remove">
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
      {uploading ? <span className="cw-file-bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span> : null}
    </div>
  )
}
