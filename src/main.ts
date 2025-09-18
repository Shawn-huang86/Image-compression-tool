import JSZip from 'jszip';
import heic2any from 'heic2any';

interface ImageFile {
    id: string;
    file: File;
    originalData: ArrayBuffer;
    compressedData?: ArrayBuffer;
    originalSize: number;
    compressedSize?: number;
    originalDimensions?: { width: number; height: number };
    compressedDimensions?: { width: number; height: number };
    processed: boolean;
    selected: boolean;
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

class ImageCompressionTool {
    private files: Map<string, ImageFile> = new Map();
    private workers: Worker[] = [];
    private workerStatus: Map<Worker, boolean> = new Map(); // true = busy, false = idle
    private maxWorkers = navigator.hardwareConcurrency || 4;
    private processingQueue: string[] = [];
    private processing = false;
    private urlCleanupMap: Map<string, string[]> = new Map(); // Store URLs for cleanup

    private elements = {
        uploadArea: document.getElementById('uploadArea')!,
        fileInput: document.getElementById('fileInput')! as HTMLInputElement,
        selectBtn: document.getElementById('selectBtn')!,
        controlsSection: document.getElementById('controlsSection')!,
        progressSection: document.getElementById('progressSection')!,
        qualitySlider: document.getElementById('qualitySlider')! as HTMLInputElement,
        qualityValue: document.getElementById('qualityValue')!,
        maxWidthInput: document.getElementById('maxWidthInput')! as HTMLInputElement,
        maxHeightInput: document.getElementById('maxHeightInput')! as HTMLInputElement,
        formatSelect: document.getElementById('formatSelect')! as HTMLSelectElement,
        compressBtn: document.getElementById('compressBtn')!,
        clearBtn: document.getElementById('clearBtn')!,
        progressFill: document.getElementById('progressFill')!,
        progressText: document.getElementById('progressText')!,
        resultsGrid: document.getElementById('resultsGrid')!,
        downloadAllBtn: document.getElementById('downloadAllBtn')!,
        downloadSelectedBtn: document.getElementById('downloadSelectedBtn')!,
        themeToggle: document.getElementById('themeToggle')!,
        uploadStatus: document.getElementById('uploadStatus')!,
        fileCount: document.getElementById('fileCount')!
    };

    constructor() {
        // 检查所有必需的元素是否存在
        this.validateElements();
        this.initializeEventListeners();
        this.initializeTheme();
        this.initializeWorkers();
        this.initializeView();
    }

    private validateElements(): void {
        const requiredElements = [
            'uploadArea', 'fileInput', 'selectBtn', 'controlsSection', 'progressSection',
            'qualitySlider', 'qualityValue', 'maxWidthInput', 'maxHeightInput', 'formatSelect',
            'compressBtn', 'clearBtn', 'progressFill', 'progressText', 'resultsGrid',
            'downloadAllBtn', 'downloadSelectedBtn', 'themeToggle', 'uploadStatus', 'fileCount'
        ];

        for (const elementName of requiredElements) {
            const element = this.elements[elementName as keyof typeof this.elements];
            if (!element) {
                console.error(`Element not found: ${elementName}`);
            }
        }
    }

    private initializeEventListeners(): void {
        this.elements.uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
        this.elements.uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
        this.elements.uploadArea.addEventListener('drop', this.handleDrop.bind(this));
        
        this.elements.selectBtn.addEventListener('click', () => {
            console.log('Select button clicked');
            this.elements.fileInput.click();
        });
        this.elements.fileInput.addEventListener('change', (e) => {
            console.log('File input changed', e);
            this.handleFileSelect(e);
        });
        
        this.elements.qualitySlider.addEventListener('input', this.updateQualityValue.bind(this));
        this.elements.compressBtn.addEventListener('click', this.startCompression.bind(this));
        this.elements.clearBtn.addEventListener('click', this.clearAll.bind(this));
        
        this.elements.downloadAllBtn.addEventListener('click', this.downloadAll.bind(this));
        this.elements.downloadSelectedBtn.addEventListener('click', this.downloadSelected.bind(this));
        
        this.elements.themeToggle.addEventListener('click', this.toggleTheme.bind(this));
    }

    private initializeTheme(): void {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    private initializeView(): void {
        this.elements.resultsGrid.className = 'results-grid';
    }

    private toggleTheme(): void {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    }



    private initializeWorkers(): void {
        try {
            for (let i = 0; i < this.maxWorkers; i++) {
                const worker = new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' });
                worker.onmessage = this.handleWorkerMessage.bind(this);
                worker.onerror = (error) => {
                    console.error('Worker error:', error);
                    this.showErrorToUser('图片处理出错，请重试');
                    // Mark worker as idle on error
                    this.workerStatus.set(worker, false);
                };
                this.workers.push(worker);
                this.workerStatus.set(worker, false); // Initially idle
            }
            console.log(`Initialized ${this.workers.length} workers`);
        } catch (error) {
            console.error('Failed to initialize workers:', error);
            this.showErrorToUser('初始化图片处理器失败，请刷新页面重试');
        }
    }

    private showErrorToUser(message: string): void {
        // Create a toast notification for errors
        const toast = document.createElement('div');
        toast.className = 'error-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    private handleDragOver(e: DragEvent): void {
        e.preventDefault();
        this.elements.uploadArea.classList.add('dragover');
    }

    private handleDragLeave(e: DragEvent): void {
        e.preventDefault();
        this.elements.uploadArea.classList.remove('dragover');
    }

    private handleDrop(e: DragEvent): void {
        e.preventDefault();
        this.elements.uploadArea.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer?.files || []);
        this.addFiles(files);
    }

    private handleFileSelect(e: Event): void {
        const input = e.target as HTMLInputElement;
        const files = Array.from(input.files || []);
        if (!files.length) return;
        
        // 立即重置文件输入框，确保下次选择相同文件也能触发 change 事件
        input.value = '';
        
        this.addFiles(files);
    }

    private async addFiles(files: File[]): Promise<void> {
        const validFiles = files.filter(file => 
            file.type.startsWith('image/') || 
            file.name.toLowerCase().endsWith('.heic') || 
            file.name.toLowerCase().endsWith('.heif')
        );
        
        if (validFiles.length === 0) {
            alert('请选择有效的图片文件！支持 JPEG、PNG、WebP、HEIC 格式');
            return;
        }

        // 检查是否有 HEIC 文件需要转换
        const hasHeicFiles = validFiles.some(file => 
            file.name.toLowerCase().endsWith('.heic') || 
            file.name.toLowerCase().endsWith('.heif') || 
            file.type === 'image/heic' || 
            file.type === 'image/heif'
        );

        if (hasHeicFiles) {
            this.elements.progressSection.style.display = 'block';
            this.elements.progressText.textContent = '正在处理 HEIC 格式...';
            this.elements.progressFill.style.width = '0%';
        }

        let processed = 0;
        for (const file of validFiles) {
            try {
                const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                let originalData: ArrayBuffer;
                let processedFile = file;

                // 检查是否为 HEIC/HEIF 格式
                if (file.name.toLowerCase().endsWith('.heic') || 
                    file.name.toLowerCase().endsWith('.heif') || 
                    file.type === 'image/heic' || 
                    file.type === 'image/heif') {
                    
                    try {
                        // 转换 HEIC 为 JPEG
                        const convertedBlob = await heic2any({
                            blob: file,
                            toType: 'image/jpeg',
                            quality: 0.9
                        }) as Blob;
                        
                        originalData = await convertedBlob.arrayBuffer();
                        // 创建新的 File 对象，保持原文件名但改变类型
                        processedFile = new File([convertedBlob], 
                            file.name.replace(/\.(heic|heif)$/i, '.jpg'), 
                            { type: 'image/jpeg' }
                        );
                    } catch (heicError) {
                        console.error('HEIC 转换失败:', heicError);
                        alert(`HEIC 文件 "${file.name}" 转换失败，请检查文件是否损坏`);
                        continue;
                    }
                } else {
                    originalData = await file.arrayBuffer();
                }
                
                const imageFile: ImageFile = {
                    id,
                    file: processedFile,
                    originalData,
                    originalSize: originalData.byteLength,
                    processed: false,
                    selected: true
                };
                
                this.files.set(id, imageFile);
                
                processed++;
                
                if (hasHeicFiles) {
                    const progress = (processed / validFiles.length) * 100;
                    this.elements.progressFill.style.width = `${progress}%`;
                    this.elements.progressText.textContent = `处理文件 ${processed}/${validFiles.length}`;
                    
                    // 给 UI 一点时间更新
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                
            } catch (error) {
                console.error('处理文件失败:', error);
                alert(`处理文件 "${file.name}" 时出错`);
            }
        }

        if (hasHeicFiles) {
            this.elements.progressSection.style.display = 'none';
        }
        this.updateUI();
    }

    private updateQualityValue(): void {
        this.elements.qualityValue.textContent = this.elements.qualitySlider.value;
    }

    private updateUI(): void {
        const fileCount = this.files.size;
        const hasResults = Array.from(this.files.values()).some(f => f.processed);
        
        // 更新文件计数显示
        this.elements.fileCount.textContent = fileCount.toString();
        this.elements.uploadStatus.style.display = fileCount > 0 ? 'block' : 'none';
        
        // 显示/隐藏占位符
        const placeholder = document.getElementById('resultsPlaceholder');
        if (placeholder) {
            placeholder.style.display = hasResults ? 'none' : 'flex';
        }
        
        // 显示/隐藏下载按钮
        this.updateDownloadButtons();
    }

    private async startCompression(): Promise<void> {
        if (this.files.size === 0 || this.processing) return;

        this.processing = true;
        this.elements.progressSection.style.display = 'block';
        (this.elements.compressBtn as HTMLButtonElement).disabled = true;
        
        this.processingQueue = Array.from(this.files.keys());
        const total = this.processingQueue.length;

        this.updateProgress(0, total);

        const processNext = () => {
            if (this.processingQueue.length === 0) return;

            const availableWorker = this.workers.find(w => !this.workerStatus.get(w));
            if (!availableWorker) return;

            const fileId = this.processingQueue.shift()!;
            const imageFile = this.files.get(fileId)!;

            // Mark worker as busy
            this.workerStatus.set(availableWorker, true);

            this.sendImageToWorker(availableWorker, fileId, imageFile);

            setTimeout(processNext, 10);
        };

        for (let i = 0; i < Math.min(this.maxWorkers, total); i++) {
            processNext();
        }
    }

    private sendImageToWorker(worker: Worker, fileId: string, imageFile: ImageFile): void {
        const options = {
            quality: parseFloat(this.elements.qualitySlider.value),
            maxWidth: parseInt(this.elements.maxWidthInput.value),
            maxHeight: parseInt(this.elements.maxHeightInput.value),
            format: this.elements.formatSelect.value
        };

        worker.postMessage({
            id: fileId,
            imageData: imageFile.originalData,
            filename: imageFile.file.name,
            options
        });
    }

    private handleWorkerMessage(e: MessageEvent<ProcessImageResult>): void {
        const worker = e.target as Worker;
        const result = e.data;
        const imageFile = this.files.get(result.id);

        // Mark worker as idle
        this.workerStatus.set(worker, false);

        if (!imageFile) return;

        if (result.success && result.compressedData) {
            imageFile.compressedData = result.compressedData;
            imageFile.compressedSize = result.compressedSize;
            imageFile.originalDimensions = result.originalDimensions;
            imageFile.compressedDimensions = result.compressedDimensions;
            imageFile.processed = true;

            // 立即显示这个文件的结果
            this.addResultItem(imageFile);
        } else {
            console.error(`Failed to process ${result.filename}:`, result.error);
            this.showErrorToUser(`处理 ${result.filename} 失败: ${result.error || '未知错误'}`);
        }

        const completedCount = Array.from(this.files.values()).filter(f => f.processed).length;
        const total = this.files.size;

        this.updateProgress(completedCount, total);

        if (completedCount === total) {
            this.processing = false;
            (this.elements.compressBtn as HTMLButtonElement).disabled = false;
            this.elements.progressSection.style.display = 'none';
        } else {
            // Process next item in queue if available
            if (this.processingQueue.length > 0) {
                const nextFileId = this.processingQueue.shift()!;
                const nextImageFile = this.files.get(nextFileId)!;

                // Mark worker as busy again
                this.workerStatus.set(worker, true);

                // Send to worker
                setTimeout(() => {
                    this.sendImageToWorker(worker, nextFileId, nextImageFile);
                }, 10);
            }
        }
    }

    private updateProgress(completed: number, total: number): void {
        const percentage = (completed / total) * 100;
        this.elements.progressFill.style.width = `${percentage}%`;
        this.elements.progressText.textContent = `处理中... ${completed}/${total}`;
    }

    private async addResultItem(imageFile: ImageFile): Promise<void> {
        if (!imageFile.processed || !imageFile.compressedData) return;

        // 检查是否已经存在这个文件的结果项
        const existingItem = document.querySelector(`[data-file-id="${imageFile.id}"]`);
        if (existingItem) {
            // Clean up old URLs before removing
            this.cleanupUrlsForFile(imageFile.id);
            existingItem.remove();
        }

        const resultItem = await this.createResultItem(imageFile);
        this.elements.resultsGrid.appendChild(resultItem);

        this.updateUI();
    }


    private async createResultItem(imageFile: ImageFile): Promise<HTMLElement> {
        const item = document.createElement('div');
        item.className = 'result-item';
        item.setAttribute('data-file-id', imageFile.id);

        const originalBlob = new Blob([imageFile.originalData]);
        const compressedBlob = new Blob([imageFile.compressedData!]);

        const originalUrl = URL.createObjectURL(originalBlob);
        const compressedUrl = URL.createObjectURL(compressedBlob);

        // Store URLs for cleanup
        this.urlCleanupMap.set(imageFile.id, [originalUrl, compressedUrl]);

        const compressionRatio = ((1 - imageFile.compressedSize! / imageFile.originalSize) * 100).toFixed(1);
        const savings = ((imageFile.originalSize - imageFile.compressedSize!) / 1024).toFixed(1);

        // Use safe DOM construction instead of innerHTML
        this.buildResultItemDOM(item, imageFile, originalUrl, compressedUrl, compressionRatio, savings);

        return item;
    }

    private buildResultItemDOM(container: HTMLElement, imageFile: ImageFile, originalUrl: string, compressedUrl: string, compressionRatio: string, savings: string): void {
        // Header with filename and checkbox
        const header = document.createElement('div');
        header.className = 'result-header';

        const filename = document.createElement('span');
        filename.className = 'result-filename';
        filename.textContent = imageFile.file.name; // Safe text content, no XSS risk

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'result-checkbox';
        checkbox.checked = imageFile.selected;
        checkbox.addEventListener('change', (e) => {
            this.toggleSelection(imageFile.id, (e.target as HTMLInputElement).checked);
        });

        header.appendChild(filename);
        header.appendChild(checkbox);

        // Preview section
        const preview = document.createElement('div');
        preview.className = 'result-preview';

        const originalImg = document.createElement('img');
        originalImg.src = originalUrl;
        originalImg.alt = '原图';
        originalImg.className = 'preview-image';

        const arrow = document.createElement('span');
        arrow.className = 'preview-arrow';
        arrow.textContent = '→';

        const compressedImg = document.createElement('img');
        compressedImg.src = compressedUrl;
        compressedImg.alt = '压缩后';
        compressedImg.className = 'preview-image';

        preview.appendChild(originalImg);
        preview.appendChild(arrow);
        preview.appendChild(compressedImg);

        // Compression badge
        const badge = document.createElement('div');
        badge.className = 'compression-badge';
        badge.textContent = `压缩率: ${compressionRatio}% (节省 ${savings}KB)`;

        // Stats section
        const stats = document.createElement('div');
        stats.className = 'result-stats';

        // Helper function to create stat items
        const createStatItem = (label: string, value: string) => {
            const item = document.createElement('div');
            item.className = 'stat-item';

            const labelDiv = document.createElement('div');
            labelDiv.className = 'stat-label';
            labelDiv.textContent = label;

            const valueDiv = document.createElement('div');
            valueDiv.className = 'stat-value';
            valueDiv.textContent = value;

            item.appendChild(labelDiv);
            item.appendChild(valueDiv);
            return item;
        };

        stats.appendChild(createStatItem('原始大小', this.formatFileSize(imageFile.originalSize)));
        stats.appendChild(createStatItem('压缩大小', this.formatFileSize(imageFile.compressedSize!)));
        stats.appendChild(createStatItem('原始尺寸', `${imageFile.originalDimensions!.width}×${imageFile.originalDimensions!.height}`));
        stats.appendChild(createStatItem('压缩尺寸', `${imageFile.compressedDimensions!.width}×${imageFile.compressedDimensions!.height}`));

        // Download button
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'btn btn-primary';
        downloadBtn.style.width = '100%';
        downloadBtn.textContent = '下载';
        downloadBtn.addEventListener('click', () => {
            this.downloadSingle(imageFile.id);
        });

        // Append all elements to container
        container.appendChild(header);
        container.appendChild(preview);
        container.appendChild(badge);
        container.appendChild(stats);
        container.appendChild(downloadBtn);
    }

    public toggleSelection(id: string, selected: boolean): void {
        const imageFile = this.files.get(id);
        if (imageFile) {
            imageFile.selected = selected;
            this.updateDownloadButtons();
        }
    }

    private updateDownloadButtons(): void {
        const processedCount = Array.from(this.files.values()).filter(f => f.processed).length;
        const selectedCount = Array.from(this.files.values()).filter(f => f.selected && f.processed).length;
        
        // 显示下载全部按钮
        this.elements.downloadAllBtn.style.display = processedCount > 0 ? 'inline-flex' : 'none';
        
        // 显示下载选中按钮
        this.elements.downloadSelectedBtn.style.display = selectedCount > 0 && selectedCount < processedCount ? 'inline-flex' : 'none';
    }

    public async downloadSingle(id: string): Promise<void> {
        const imageFile = this.files.get(id);
        if (!imageFile || !imageFile.compressedData) return;

        const blob = new Blob([imageFile.compressedData]);
        const url = URL.createObjectURL(blob);
        
        const extension = this.elements.formatSelect.value === 'png' ? 'png' : 
                         this.elements.formatSelect.value === 'webp' ? 'webp' : 'jpg';
        const filename = this.getFilenameWithoutExtension(imageFile.file.name) + `_compressed.${extension}`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
    }

    private async downloadAll(): Promise<void> {
        const processedFiles = Array.from(this.files.values()).filter(f => f.processed && f.compressedData);
        
        if (processedFiles.length === 0) return;

        if (processedFiles.length === 1) {
            this.downloadSingle(processedFiles[0].id);
            return;
        }

        const zip = new JSZip();
        const extension = this.elements.formatSelect.value === 'png' ? 'png' : 
                         this.elements.formatSelect.value === 'webp' ? 'webp' : 'jpg';

        for (const imageFile of processedFiles) {
            const filename = this.getFilenameWithoutExtension(imageFile.file.name) + `_compressed.${extension}`;
            zip.file(filename, imageFile.compressedData!);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'compressed_images.zip';
        a.click();
        
        URL.revokeObjectURL(url);
    }

    private async downloadSelected(): Promise<void> {
        const selectedFiles = Array.from(this.files.values()).filter(f => f.selected && f.processed && f.compressedData);
        
        if (selectedFiles.length === 0) return;

        if (selectedFiles.length === 1) {
            this.downloadSingle(selectedFiles[0].id);
            return;
        }

        const zip = new JSZip();
        const extension = this.elements.formatSelect.value === 'png' ? 'png' : 
                         this.elements.formatSelect.value === 'webp' ? 'webp' : 'jpg';

        for (const imageFile of selectedFiles) {
            const filename = this.getFilenameWithoutExtension(imageFile.file.name) + `_compressed.${extension}`;
            zip.file(filename, imageFile.compressedData!);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'selected_compressed_images.zip';
        a.click();
        
        URL.revokeObjectURL(url);
    }

    private clearAll(): void {
        // Clean up all object URLs before clearing
        this.cleanupAllUrls();

        this.files.clear();
        this.processingQueue = [];
        this.processing = false;

        this.elements.progressSection.style.display = 'none';

        // Clear results grid safely
        while (this.elements.resultsGrid.firstChild) {
            this.elements.resultsGrid.removeChild(this.elements.resultsGrid.firstChild);
        }

        this.elements.fileInput.value = '';
        (this.elements.compressBtn as HTMLButtonElement).disabled = false;

        this.updateUI();
    }

    private cleanupAllUrls(): void {
        // Revoke all object URLs to free memory
        this.urlCleanupMap.forEach((urls) => {
            urls.forEach(url => URL.revokeObjectURL(url));
        });
        this.urlCleanupMap.clear();
    }

    private cleanupUrlsForFile(fileId: string): void {
        const urls = this.urlCleanupMap.get(fileId);
        if (urls) {
            urls.forEach(url => URL.revokeObjectURL(url));
            this.urlCleanupMap.delete(fileId);
        }
    }

    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    private getFilenameWithoutExtension(filename: string): string {
        return filename.replace(/\.[^/.]+$/, '');
    }
}

declare global {
    interface Window {
        app: ImageCompressionTool;
    }
}

const app = new ImageCompressionTool();
window.app = app;