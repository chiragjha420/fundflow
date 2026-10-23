/**
 * Client-Side Image Compression Utility for FundFlow
 * 
 * Automatically compresses high-resolution smartphone camera photos (3MB - 12MB)
 * down to tiny, highly-optimized avatars (~25KB - 45KB) before upload or offline caching.
 * Prevents bandwidth bloat, eliminates mobile lag, and saves cloud storage quota.
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
  // If not an image, return original
  if (!file || !file.type || !file.type.startsWith('image/')) {
    return file;
  }

  const {
    maxWidth = 480,
    maxHeight = 480,
    quality = 0.75,
    mimeType = 'image/jpeg',
  } = options;

  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return resolve(file);
    }

    const reader = new FileReader();

    reader.onerror = () => {
      console.warn('FileReader error during compression, using original file.');
      resolve(file);
    };

    reader.onload = () => {
      const img = new window.Image();

      img.onerror = () => {
        console.warn('Image load error during compression, using original file.');
        resolve(file);
      };

      img.onload = () => {
        try {
          let { width, height } = img;

          // Maintain aspect ratio while bounding within maxWidth & maxHeight
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) return resolve(file);

          // Fill clean background (handles transparent PNG conversions cleanly)
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);

          // Smooth high-quality scaling
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (!blob) return resolve(file);

              // Extension mapping
              const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
              const baseName = file.name.replace(/\.[^/.]+$/, '');
              const compressedFile = new File([blob], `${baseName}.${ext}`, {
                type: mimeType,
                lastModified: Date.now(),
              });

              resolve(compressedFile);
            },
            mimeType,
            quality
          );
        } catch (err) {
          console.warn('Compression exception, using original file:', err);
          resolve(file);
        }
      };

      img.src = reader.result as string;
    };

    reader.readAsDataURL(file);
  });
}
