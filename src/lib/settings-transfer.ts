const SETTINGS_EXPORT_VERSION = 1;

type SettingsTransferEnvelope<T> = {
  version: number;
  exportedAt: string;
  data: T;
};

function isEnvelope<T>(value: unknown): value is SettingsTransferEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    "exportedAt" in value &&
    "data" in value
  );
}

export async function parseSettingsFile<T>(file: File) {
  const text = await file.text();
  const parsed = JSON.parse(text) as T | SettingsTransferEnvelope<T>;
  return isEnvelope<T>(parsed) ? parsed.data : parsed;
}

export function downloadSettingsFile(filename: string, data: unknown) {
  const payload: SettingsTransferEnvelope<unknown> = {
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
