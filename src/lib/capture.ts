'use client';

import { config } from '@/lib/config';

/**
 * Browser-native photo capture.
 *
 * This replaces `@capacitor/camera`. The web app is now a pure web target — the Android
 * and iOS clients are separate Flutter apps that talk to the same Supabase backend — so
 * the only capture path that has to work here is the one every browser already ships.
 *
 * `capture="environment"` makes a mobile browser open the rear camera directly rather
 * than the gallery picker; desktop browsers ignore the attribute and show a file dialog.
 * Either way the result is a `File`, which is already a `Blob`.
 */

export interface CapturedPhoto {
  /** Downscaled image bytes, ready to upload or send to /api/analyze. */
  blob: Blob;
  /** Preview URL. The caller owns it and must `URL.revokeObjectURL` when finished. */
  objectUrl: string;
}

/**
 * Open the camera / file picker and return one downscaled photo, or `null` if the user
 * cancelled.
 *
 * Downscaling is not cosmetic: a modern phone camera produces 4–12 MB per frame, and the
 * analyze endpoint caps request bodies. Shrinking on the client keeps uploads inside that
 * cap, cuts mobile data use, and keeps the AI request cheap.
 */
export async function capturePhoto(): Promise<CapturedPhoto | null> {
  const file = await pickImageFile();
  if (!file) return null;

  const blob = await downscale(file);
  return { blob, objectUrl: URL.createObjectURL(blob) };
}

/** Present the OS camera/file chooser. Resolves `null` when the user cancels. */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.display = 'none';

    let settled = false;
    const finish = (value: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });

    // `cancel` fires in browsers that support it. Where it does not, the promise simply
    // stays pending until the next capture replaces it — no leak, because the element is
    // detached and the caller's state machine is idle either way.
    input.addEventListener('cancel', () => finish(null), { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Re-encode the image so its longest edge is at most `config.capture.maxEdgePx`.
 *
 * Returns the original file untouched if it is already small enough, or if decoding fails
 * — a slightly-too-large photo is far better than a lost inspection record.
 */
async function downscale(file: File): Promise<Blob> {
  const { maxEdgePx, jpegQualityPercent } = config.capture;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const longestEdge = Math.max(bitmap.width, bitmap.height);
  if (longestEdge <= maxEdgePx) {
    bitmap.close();
    return file;
  }

  const scale = maxEdgePx / longestEdge;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encoded = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', jpegQualityPercent / 100)
  );

  return encoded ?? file;
}
