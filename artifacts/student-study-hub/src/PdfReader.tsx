import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, LoaderCircle, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfReaderProps = { file: Blob };

export default function PdfReader({ file }: PdfReaderProps) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [viewerWidth, setViewerWidth] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setDocument(null);
    setLoading(true);
    setPageNumber(1);
    setError('');

    void (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!active) return;
        loadingTask = getDocument({ data: bytes });
        const loadedDocument = await loadingTask.promise;
        if (!active) return;
        setDocument(loadedDocument);
      } catch {
        if (active) setError('لم نتمكن من قراءة الملف. تأكد أنه PDF صالح وغير محمي بكلمة مرور.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy().catch(() => {});
    };
  }, [file]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const observer = new ResizeObserver((entries) => {
      setViewerWidth(entries[0]?.contentRect.width ?? viewer.clientWidth);
    });
    observer.observe(viewer);
    setViewerWidth(viewer.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!document || !canvas || !viewerWidth) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    setPageLoading(true);

    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.max(0.25, Math.min(1.65, (viewerWidth - 36) / baseViewport.width));
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas rendering is unavailable.');

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
        if (!cancelled) setPageLoading(false);
      } catch (renderError) {
        if (cancelled || (renderError instanceof Error && renderError.name === 'RenderingCancelledException')) return;
        setError('تعذّر عرض هذه الصفحة. جرّب صفحة أخرى أو أعد فتح الملف.');
        setPageLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, viewerWidth, zoom]);

  return <div className="pdf-reader">
    {document && <div className="pdf-reader-controls" aria-label="أدوات قراءة PDF">
      <div className="pdf-page-controls">
        <button className="viewer-control" aria-label="الصفحة السابقة" title="الصفحة السابقة" disabled={pageNumber <= 1} onClick={() => setPageNumber((page) => Math.max(1, page - 1))}><ChevronRight size={16} /></button>
        <span className="pdf-page-count" aria-live="polite">صفحة {pageNumber} من {document.numPages}</span>
        <button className="viewer-control" aria-label="الصفحة التالية" title="الصفحة التالية" disabled={pageNumber >= document.numPages} onClick={() => setPageNumber((page) => Math.min(document.numPages, page + 1))}><ChevronLeft size={16} /></button>
      </div>
      <div className="pdf-zoom-controls">
        <button className="viewer-control" aria-label="تصغير الصفحة" title="تصغير" disabled={zoom <= 0.6} onClick={() => setZoom((value) => Math.max(0.6, Number((value - 0.2).toFixed(1))))}><ZoomOut size={15} /></button>
        <span className="pdf-zoom-value">{Math.round(zoom * 100)}٪</span>
        <button className="viewer-control" aria-label="تكبير الصفحة" title="تكبير" disabled={zoom >= 2.4} onClick={() => setZoom((value) => Math.min(2.4, Number((value + 0.2).toFixed(1))))}><ZoomIn size={15} /></button>
      </div>
    </div>}
    <div className="pdf-canvas-wrap" ref={viewerRef}>
      <div className="pdf-canvas-stage">
        <canvas ref={canvasRef} className={`pdf-page-canvas ${loading || pageLoading || error ? 'is-loading' : ''}`} aria-label={`صفحة ${pageNumber}`} />
        {(loading || pageLoading) && !error && <div className="pdf-reader-message" role="status"><LoaderCircle size={22} className="pdf-loader" /><span>{loading ? 'جارٍ فتح الملف…' : 'جارٍ عرض الصفحة…'}</span></div>}
        {error && <div className="pdf-reader-message pdf-reader-error" role="alert"><span className="pdf-error-mark">!</span><strong>تعذّرت القراءة</strong><span>{error}</span></div>}
      </div>
    </div>
  </div>;
}
