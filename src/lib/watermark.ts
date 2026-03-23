export type WatermarkPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center";

export interface WatermarkSettings {
  enabled: boolean;
  textEnabled: boolean;
  text: string;
  textColor: string;
  textSize: number;
  textOpacity: number;
  textPosition: WatermarkPosition;
  textRotation: number;
  imageEnabled: boolean;
  imageDataUrl: string;
  imageOpacity: number;
  imageScale: number;
  imagePosition: WatermarkPosition;
}

export const defaultWatermarkSettings: WatermarkSettings = {
  enabled: false,
  textEnabled: true,
  text: "GitHub 图床",
  textColor: "#ffffff",
  textSize: 36,
  textOpacity: 0.55,
  textPosition: "bottom-right",
  textRotation: -12,
  imageEnabled: false,
  imageDataUrl: "",
  imageOpacity: 0.45,
  imageScale: 18,
  imagePosition: "top-left",
};

export const previewBaseImage = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f6efe5" />
      <stop offset="50%" stop-color="#d7e5f8" />
      <stop offset="100%" stop-color="#f0d9cd" />
    </linearGradient>
  </defs>
  <rect width="1200" height="800" rx="40" fill="url(#bg)" />
  <circle cx="210" cy="200" r="120" fill="#ffffff" fill-opacity="0.45" />
  <circle cx="1000" cy="150" r="160" fill="#ffffff" fill-opacity="0.25" />
  <circle cx="920" cy="640" r="190" fill="#ffffff" fill-opacity="0.3" />
  <rect x="110" y="490" width="520" height="150" rx="28" fill="#ffffff" fill-opacity="0.5" />
  <text x="110" y="220" fill="#1f2937" font-size="66" font-weight="700">Watermark Preview</text>
  <text x="110" y="290" fill="#374151" font-size="30">上传前会在浏览器内完成处理，再提交到 GitHub 仓库。</text>
  <text x="150" y="560" fill="#334155" font-size="42" font-weight="700">Live Demo</text>
  <text x="150" y="610" fill="#475569" font-size="24">文字水印和图片水印会一起叠加到这里。</text>
</svg>
`)}`;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

function getPosition(
  canvasWidth: number,
  canvasHeight: number,
  itemWidth: number,
  itemHeight: number,
  position: WatermarkPosition,
  margin: number,
) {
  switch (position) {
    case "top-left":
      return { x: margin, y: margin };
    case "top-right":
      return { x: canvasWidth - itemWidth - margin, y: margin };
    case "bottom-left":
      return { x: margin, y: canvasHeight - itemHeight - margin };
    case "center":
      return {
        x: (canvasWidth - itemWidth) / 2,
        y: (canvasHeight - itemHeight) / 2,
      };
    case "bottom-right":
    default:
      return {
        x: canvasWidth - itemWidth - margin,
        y: canvasHeight - itemHeight - margin,
      };
  }
}

async function renderWatermarkCanvas(source: string, settings: WatermarkSettings) {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器不支持 Canvas 水印处理");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  if (!settings.enabled) {
    return canvas;
  }

  const margin = Math.max(24, Math.round(Math.min(canvas.width, canvas.height) * 0.04));

  if (settings.imageEnabled && settings.imageDataUrl) {
    const watermarkImage = await loadImage(settings.imageDataUrl);
    const width = Math.max(60, Math.round((canvas.width * settings.imageScale) / 100));
    const ratio = width / (watermarkImage.naturalWidth || watermarkImage.width || width);
    const height = Math.max(
      40,
      Math.round((watermarkImage.naturalHeight || watermarkImage.height || width) * ratio),
    );
    const { x, y } = getPosition(
      canvas.width,
      canvas.height,
      width,
      height,
      settings.imagePosition,
      margin,
    );

    context.save();
    context.globalAlpha = settings.imageOpacity;
    context.drawImage(watermarkImage, x, y, width, height);
    context.restore();
  }

  if (settings.textEnabled && settings.text.trim()) {
    const fontSize = Math.max(14, Math.round((settings.textSize / 1200) * canvas.width));
    context.save();
    context.font = `700 ${fontSize}px sans-serif`;
    context.textBaseline = "top";
    const metrics = context.measureText(settings.text);
    const textWidth = Math.ceil(metrics.width);
    const textHeight = Math.ceil(fontSize * 1.25);
    const { x, y } = getPosition(
      canvas.width,
      canvas.height,
      textWidth,
      textHeight,
      settings.textPosition,
      margin,
    );

    context.globalAlpha = settings.textOpacity;
    context.fillStyle = settings.textColor;
    context.shadowColor = "rgba(0, 0, 0, 0.28)";
    context.shadowBlur = Math.max(4, Math.round(fontSize * 0.18));
    context.translate(x + textWidth / 2, y + textHeight / 2);
    context.rotate((settings.textRotation * Math.PI) / 180);
    context.fillText(settings.text, -textWidth / 2, -textHeight / 2);
    context.restore();
  }

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality = 0.92) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("水印图片生成失败"));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

export async function fileToDataUrl(file: File) {
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

export async function buildWatermarkPreview(settings: WatermarkSettings) {
  const canvas = await renderWatermarkCanvas(previewBaseImage, settings);
  return canvas.toDataURL("image/png");
}

export async function applyWatermarkToFile(file: File, settings: WatermarkSettings) {
  if (!settings.enabled || (!settings.textEnabled && !(settings.imageEnabled && settings.imageDataUrl))) {
    return file;
  }

  const source = await fileToDataUrl(file);
  const canvas = await renderWatermarkCanvas(source, settings);
  const type = file.type && file.type.startsWith("image/") ? file.type : "image/png";
  const blob = await canvasToBlob(canvas, type);

  return new File([blob], file.name, {
    type: blob.type || type,
    lastModified: file.lastModified,
  });
}
