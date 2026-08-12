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
  const detectedType = await detectImageType(file, extension);

  if (HEIC_TYPES.has(mimeType) || HEIC_TYPES.has(detectedType) || HEIC_EXTENSIONS.has(extension)) {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const jpeg = Array.isArray(converted) ? converted[0] : converted;
    return new File([jpeg], replaceExtension(file.name, "jpg"), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  }

  if (DISPLAY_TYPES.has(mimeType) && mimeType === detectedType) return file;

  if (DISPLAY_TYPES.has(detectedType)) {
    return new File([file], normalizeFileName(file.name, detectedType), {
      type: detectedType,
      lastModified: file.lastModified,
    });
  }

  throw new Error(`${file?.name || "This file"} is not a supported photo.`);
}

export function storyImageContentType(file) {
  const extension = fileExtension(file?.name);
  const fromExtension = MIME_BY_EXTENSION.get(extension);
  if (fromExtension) return fromExtension;
  const declaredType = String(file?.type || "").toLowerCase();
  return DISPLAY_TYPES.has(declaredType) ? declaredType : "";
}

async function detectImageType(file, extension) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";

  const brand = ascii(bytes, 4, 12).toLowerCase();
  if (brand.startsWith("ftyp") && ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].some((value) => brand.includes(value))) {
    return "image/heic";
  }

  const declaredType = String(file?.type || "").toLowerCase();
  if (DISPLAY_TYPES.has(declaredType) || HEIC_TYPES.has(declaredType)) return declaredType;
  return "";
}

function matches(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function normalizeFileName(name, mimeType) {
  if (mimeType === "image/jpeg") return replaceExtension(name, "jpg");
  if (mimeType === "image/png") return replaceExtension(name, "png");
  if (mimeType === "image/webp") return replaceExtension(name, "webp");
  return name;
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
