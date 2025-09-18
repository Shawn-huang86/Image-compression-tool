interface ImageProcessingOptions {
    quality: number;
    maxWidth: number;
    maxHeight: number;
    format: string;
}

interface ProcessImageMessage {
    id: string;
    imageData: ArrayBuffer;
    filename: string;
    options: ImageProcessingOptions;
}

interface ProcessImageResult {
    id: string;
    success: boolean;
    originalSize: number;
    compressedSize: number;
    originalDimensions: { width: number; height: number };
    compressedDimensions: { width: number; height: number };
    compressedData?: ArrayBuffer;
    filename: string;
    error?: string;
}

function getImageOrientation(buffer: ArrayBuffer): number {
    const view = new DataView(buffer);
    
    if (view.getUint16(0, false) !== 0xFFD8) {
        return 1;
    }
    
    const length = view.byteLength;
    let offset = 2;
    
    while (offset < length) {
        const marker = view.getUint16(offset, false);
        offset += 2;
        
        if (marker === 0xFFE1) {
            offset += 2;
            
            if (view.getUint32(offset, false) === 0x45786966) {
                const tiffOffset = offset + 6;
                const littleEndian = view.getUint16(tiffOffset, false) === 0x4949;
                
                const ifdOffset = view.getUint32(tiffOffset + 4, littleEndian);
                const tagCount = view.getUint16(tiffOffset + ifdOffset, littleEndian);
                
                for (let i = 0; i < tagCount; i++) {
                    const tagOffset = tiffOffset + ifdOffset + 2 + (i * 12);
                    const tag = view.getUint16(tagOffset, littleEndian);
                    
                    if (tag === 0x0112) {
                        return view.getUint16(tagOffset + 8, littleEndian);
                    }
                }
            }
            break;
        } else if ((marker & 0xFF00) !== 0xFF00) {
            break;
        } else {
            offset += view.getUint16(offset, false);
        }
    }
    
    return 1;
}

function applyOrientation(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, orientation: number): void {
    const { width, height } = canvas;
    
    switch (orientation) {
        case 2:
            ctx.transform(-1, 0, 0, 1, width, 0);
            break;
        case 3:
            ctx.transform(-1, 0, 0, -1, width, height);
            break;
        case 4:
            ctx.transform(1, 0, 0, -1, 0, height);
            break;
        case 5:
            canvas.width = height;
            canvas.height = width;
            ctx.transform(0, 1, 1, 0, 0, 0);
            break;
        case 6:
            canvas.width = height;
            canvas.height = width;
            ctx.transform(0, 1, -1, 0, height, 0);
            break;
        case 7:
            canvas.width = height;
            canvas.height = width;
            ctx.transform(0, -1, -1, 0, height, width);
            break;
        case 8:
            canvas.width = height;
            canvas.height = width;
            ctx.transform(0, -1, 1, 0, 0, width);
            break;
    }
}

async function processImage(data: ProcessImageMessage): Promise<ProcessImageResult> {
    try {
        const { id, imageData, filename, options } = data;
        const { quality, maxWidth, maxHeight, format } = options;
        
        const blob = new Blob([imageData]);
        const bitmap = await createImageBitmap(blob);
        
        const orientation = getImageOrientation(imageData);
        
        let { width, height } = bitmap;
        const originalWidth = width;
        const originalHeight = height;
        
        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }
        
        const needsRotation = orientation > 4;
        const displayWidth = needsRotation ? height : width;
        const displayHeight = needsRotation ? width : height;
        
        const canvas = new OffscreenCanvas(displayWidth, displayHeight);
        const ctx = canvas.getContext('2d')!;
        
        applyOrientation(canvas as unknown as HTMLCanvasElement, ctx as unknown as CanvasRenderingContext2D, orientation);
        
        ctx.drawImage(bitmap, 0, 0, width, height);
        
        const mimeType = format === 'png' ? 'image/png' : 
                        format === 'webp' ? 'image/webp' : 'image/jpeg';
        
        const compressedBlob = await canvas.convertToBlob({
            type: mimeType,
            quality: format === 'png' ? undefined : quality
        });
        
        const compressedData = await compressedBlob.arrayBuffer();
        
        return {
            id,
            success: true,
            originalSize: imageData.byteLength,
            compressedSize: compressedData.byteLength,
            originalDimensions: { width: originalWidth, height: originalHeight },
            compressedDimensions: { width: displayWidth, height: displayHeight },
            compressedData,
            filename
        };
        
    } catch (error) {
        return {
            id: data.id,
            success: false,
            originalSize: 0,
            compressedSize: 0,
            originalDimensions: { width: 0, height: 0 },
            compressedDimensions: { width: 0, height: 0 },
            filename: data.filename,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

self.onmessage = async (event: MessageEvent<ProcessImageMessage>) => {
    const result = await processImage(event.data);
    self.postMessage(result);
};