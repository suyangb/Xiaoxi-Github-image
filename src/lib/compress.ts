export type CompressionOutputFormat = "keep" | "jpeg" | "webp";

export interface CompressionSettings {
  enabled: boolean;
  maxWidth: number;
  maxHeight: number;
  quality: number;
  outputFormat: CompressionOutputFormat;
}

export const defaultCompressionSettings: CompressionSettings = {
  enabled: false,
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.82,
  outputFormat: "keep",
};

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("图片读取失败"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("压缩图片生成失败"));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

function getOutputType(file: File, outputFormat: CompressionOutputFormat) {
  if (outputFormat === "jpeg") return "image/jpeg";
  if (outputFormat === "webp") return "image/webp";
  return file.type && file.type.startsWith("image/") ? file.type : "image/png";
}

function getOutputName(name: string, type: string) {
  const dotIndex = name.lastIndexOf(".");
  const base = dotIndex > -1 ? name.slice(0, dotIndex) : name;

  if (type === "image/jpeg") return `${base}.jpg`;
  if (type === "image/webp") return `${base}.webp`;
  if (type === "image/png") return `${base}.png`;
  return name;
}

export async function compressImageFile(file: File, settings: CompressionSettings) {
  if (!settings.enabled) {
    return file;
  }

  const source = await fileToDataUrl(file);
  const image = await loadImage(source);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const scale = Math.min(
    1,
    settings.maxWidth / width || 1,
    settings.maxHeight / height || 1,
  );

  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器不支持 Canvas 图片压缩");
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const outputType = getOutputType(file, settings.outputFormat);
  const quality = outputType === "image/png" ? undefined : settings.quality;
  const blob = await canvasToBlob(canvas, outputType, quality);

  return new File([blob], getOutputName(file.name, outputType), {
    type: blob.type || outputType,
    lastModified: file.lastModified,
  });
}
