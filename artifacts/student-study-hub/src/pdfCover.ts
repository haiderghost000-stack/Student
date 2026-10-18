import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const coverWidth = 320;

export async function createPdfCover(file: Blob): Promise<string> {
  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let canvas: HTMLCanvasElement | null = null;

  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const pageSize = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1, coverWidth / pageSize.width) });
    canvas = window.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas rendering is unavailable.');

    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    await loadingTask.destroy();
  }
}
