const DISPLAY_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIME_BY_EXTENSION = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);
const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

export async function prepareStoryImage(file) {
  const mimeType = String(file?.type || "").toLowerCase();
  const extension = fileExtension(file?.name);

  if (HEIC_TYPES.has(mimeType) || HEIC_EXTENSIONS.has(extension)) {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const jpeg = Array.isArray(converted) ? converted[0] : converted;
    return new File([jpeg], replaceExtension(file.name, "jpg"), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  }

  if (DISPLAY_TYPES.has(mimeType)) return file;

  const inferredType = MIME_BY_EXTENSION.get(extension);
  if ((!mimeType || mimeType === "application/octet-stream") && inferredType) {
    return new File([file], file.name, { type: inferredType, lastModified: file.lastModified });
  }

  throw new Error(`${file?.name || "This file"} is not a supported photo.`);
}

export function isIphonePhoto(file) {
  const mimeType = String(file?.type || "").toLowerCase();
  return HEIC_TYPES.has(mimeType) || HEIC_EXTENSIONS.has(fileExtension(file?.name));
}

function fileExtension(name) {
  return String(name || "").toLowerCase().split(".").pop() || "";
}

function replaceExtension(name, extension) {
  const base = String(name || "iphone-photo").replace(/\.[^.]+$/, "");
  return `${base || "iphone-photo"}.${extension}`;
}
