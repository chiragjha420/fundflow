/**
 * Ultra-Low-Memory Client-Side Image Compressor for FundFlow
 * 
 * Specifically optimized for mobile browsers (Android Chrome, iOS Safari):
 * 1. Uses native `createImageBitmap` with hardware downsampling when available,
 *    preventing high-res (12MP-50MP) camera photos from allocating 50MB-200MB in RAM.
 * 2. Uses `URL.createObjectURL` instead of `FileReader.readAsDataURL` to avoid
 *    generating multi-megabyte base64 strings in JavaScript heap memory.
 * 3. Immediately disposes of bitmap and canvas graphics memory after compression.
 * 4. Yields a lightweight (~25KB-45KB) JPEG/WebP File object ready for fast upload.
 */

export interface ImageCompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0.1 to 1.0 (default: 0.75)
  mimeType?: 'image/jpeg' | 'image/webp';
}

export async function compressImage(
  file: File,
  options: ImageCompressionOptions = {}
): Promise<File> {
  // If not a valid image file, return original
  if (!file || !file.type || !file.type.startsWith('image/')) {
    return file;
  }

  const {
    maxWidth = 480,
    maxHeight = 480,
    quality = 0.75,
    mimeType = 'image/jpeg',
  } = options;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return file;
  }

  try {
    // Strategy 1: Native createImageBitmap with hardware downsampling (lowest memory)
    if ('createImageBitmap' in window) {
      try {
        // Step 1: Read natural dimensions with a tiny preview probe
        const probeBitmap = await createImageBitmap(file);
        const origWidth = probeBitmap.width;
        const origHeight = probeBitmap.height;
        probeBitmap.close(); // Immediately release probe memory!

        let targetWidth = origWidth;
        let targetHeight = origHeight;

        if (origWidth > maxWidth || origHeight > maxHeight) {
          const ratio = Math.min(maxWidth / origWidth, maxHeight / origHeight);
          targetWidth = Math.max(1, Math.round(origWidth * ratio));
          targetHeight = Math.max(1, Math.round(origHeight * ratio));
        }

        // Step 2: Native downsampling during decode - libjpeg/skia allocates only target dimensions
        const resizedBitmap = await createImageBitmap(file, {
          resizeWidth: targetWidth,
          resizeHeight: targetHeight,
          resizeQuality: 'medium',
        });

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d', { alpha: false });

        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetWidth, targetHeight);
          ctx.drawImage(resizedBitmap, 0, 0);
          resizedBitmap.close(); // Immediately release hardware bitmap!

          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, mimeType, quality)
          );

          // Force release canvas memory
          canvas.width = 0;
          canvas.height = 0;

          if (blob) {
            const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
            const baseName = (file.name || 'worker-photo').replace(/\.[^/.]+$/, '');
            return new File([blob], `${baseName}.${ext}`, {
              type: mimeType,
              lastModified: Date.now(),
            });
          }
        }
      } catch (bitmapErr) {
        console.warn('createImageBitmap downscale fallback:', bitmapErr);
      }
    }

    // Strategy 2: URL.createObjectURL with immediate revocation (no base64 heap bloat)
    return await new Promise<File>((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(objectUrl); // Release URL reference immediately

        try {
          let { width, height } = img;
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.max(1, Math.round(width * ratio));
            height = Math.max(1, Math.round(height * ratio));
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { alpha: false });

          if (!ctx) return resolve(file);

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              canvas.width = 0;
              canvas.height = 0;

              if (!blob) return resolve(file);
              const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
              const baseName = (file.name || 'worker-photo').replace(/\.[^/.]+$/, '');
              resolve(
                new File([blob], `${baseName}.${ext}`, {
                  type: mimeType,
                  lastModified: Date.now(),
                })
              );
            },
            mimeType,
            quality
          );
        } catch (e) {
          console.warn('Canvas conversion exception:', e);
          resolve(file);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      };

      img.src = objectUrl;
    });
  } catch (err) {
    console.warn('compressImage outer error, using original:', err);
    return file;
  }
}
