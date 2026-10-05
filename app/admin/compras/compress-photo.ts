/**
 * Phone photos weigh 3-10 MB, and a server action body is capped at 1 MB by the
 * runtime (vinext's default serverActions.bodySizeLimit) — so every purchase
 * photo is shrunk IN THE BROWSER before it is sent: longest side ≤ 1600 px,
 * JPEG ~0.8, stepping quality/size down until it is under ~850 KB. The server
 * still checks type and the panel's 5 MB cap. Browser-only (canvas).
 */

const ATTEMPTS: Array<[maxSide: number, quality: number]> = [
  [1600, 0.8],
  [1600, 0.7],
  [1600, 0.6],
  [1280, 0.6],
  [1024, 0.55],
  [800, 0.5],
];

export const TARGET_PHOTO_BYTES = 850 * 1024;

type Drawable = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: File): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall back to an <img> (older Safari); it applies EXIF orientation too.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function render(image: Drawable, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("canvas"));
  context.fillStyle = "#fff"; // transparent PNGs become white, not black
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/jpeg", quality),
  );
}

export async function compressPhoto(file: File, targetBytes = TARGET_PHOTO_BYTES): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Elige una foto (imagen).");
  let image: Drawable;
  try {
    image = await decode(file);
  } catch {
    throw new Error("No pudimos leer esa foto. Intenta tomarla de nuevo o elige otra.");
  }
  try {
    let blob: Blob | null = null;
    for (const [maxSide, quality] of ATTEMPTS) {
      blob = await render(image, maxSide, quality);
      if (blob.size <= targetBytes) break;
    }
    if (!blob || blob.size > targetBytes) throw new Error("La foto sigue siendo muy pesada. Intenta con otra.");
    return new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("La foto")) throw error;
    throw new Error("No pudimos preparar esa foto. Intenta con otra.");
  } finally {
    image.close();
  }
}
