export type NamingMode = "timestamp" | "uuid" | "keep" | "prefix";

export interface NamingSettings {
  mode: NamingMode;
  prefix: string;
}

export const NAMING_VARIABLES = [
  { label: "日期", value: "{date}" },
  { label: "时间", value: "{time}" },
  { label: "日期时间", value: "{datetime}" },
  { label: "原文件名", value: "{original}" },
  { label: "UUID", value: "{uuid}" },
] as const;

export const defaultNamingSettings: NamingSettings = {
  mode: "timestamp",
  prefix: "image",
};

function sanitizeBaseName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "") || "image";
}

function splitName(name: string) {
  const extensionIndex = name.lastIndexOf(".");
  const extension = extensionIndex > -1 ? name.slice(extensionIndex).toLowerCase() : "";
  const baseName = extensionIndex > -1 ? name.slice(0, extensionIndex) : name;
  return {
    baseName: sanitizeBaseName(baseName),
    extension,
  };
}

function buildTimestampPrefix() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const min = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function buildDatePart() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function buildTimePart() {
  const date = new Date();
  const hh = `${date.getHours()}`.padStart(2, "0");
  const min = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${hh}${min}${ss}`;
}

function resolvePrefixTemplate(template: string, originalName: string) {
  const { baseName } = splitName(originalName);
  const resolved = template
    .replaceAll("{date}", buildDatePart())
    .replaceAll("{time}", buildTimePart())
    .replaceAll("{datetime}", buildTimestampPrefix())
    .replaceAll("{original}", baseName)
    .replaceAll("{uuid}", crypto.randomUUID());

  return sanitizeBaseName(resolved);
}

export function generateUploadFilename(originalName: string, settings: NamingSettings) {
  const { baseName, extension } = splitName(originalName);

  switch (settings.mode) {
    case "keep":
      return `${baseName}${extension}`;
    case "uuid":
      return `${crypto.randomUUID()}${extension}`;
    case "prefix":
      return `${resolvePrefixTemplate(settings.prefix, originalName)}${extension}`;
    case "timestamp":
    default:
      return `${buildTimestampPrefix()}-${crypto.randomUUID().slice(0, 8)}-${baseName}${extension}`;
  }
}
