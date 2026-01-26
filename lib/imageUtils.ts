/**
 * Image Processing Utilities
 * 
 * Handles client-side image compression to optimize storage and upload.
 */

export interface CompressionOptions {
    maxWidth: number;
    maxHeight: number;
    quality: number; // 0.0 to 1.0
    type: string;    // 'image/jpeg' or 'image/png'
}

const DEFAULT_OPTIONS: CompressionOptions = {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 0.7,
    type: 'image/jpeg'
};

/**
 * Compress an image file using HTML5 Canvas
 */
export async function compressImage(
    file: File,
    options: Partial<CompressionOptions> = {}
): Promise<File> {
    const settings = { ...DEFAULT_OPTIONS, ...options };

    // If it's not an image, return original
    if (!file.type.startsWith('image/')) {
        return file;
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            // Calculate new dimensions
            let width = img.width;
            let height = img.height;

            if (width > settings.maxWidth || height > settings.maxHeight) {
                const ratio = Math.min(
                    settings.maxWidth / width,
                    settings.maxHeight / height
                );
                width = Math.floor(width * ratio);
                height = Math.floor(height * ratio);
            }

            // Create canvas
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            // Draw to canvas
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }

            // Better quality scaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // Export to blob
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error('Compression failed'));
                        return;
                    }

                    // Create new file from blob
                    const compressedFile = new File(
                        [blob],
                        file.name.replace(/\.[^/.]+$/, ".jpg"), // Ensure .jpg extension
                        {
                            type: settings.type,
                            lastModified: Date.now()
                        }
                    );

                    console.log(`[ImageUtils] Compressed ${file.name}: ${(file.size / 1024).toFixed(2)}KB -> ${(compressedFile.size / 1024).toFixed(2)}KB`);
                    resolve(compressedFile);
                },
                settings.type,
                settings.quality
            );
        };

        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image for compression'));
        };

        img.src = url;
    });
}
