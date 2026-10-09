import { useEffect, useRef, useState } from 'react';
import {
  FileText, LoaderCircle, Minus, Plus, X,
} from 'lucide-react';
import {
  getDocument, GlobalWorkerOptions, TextLayer,
  type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfReaderProps = { file: Blob; name: string; onClose: () => void };
type PageSize = { width: number; height: number };
type PinchStart = { distance: number; zoom: number; scrollTop: number; scrollLeft: number; centerX: number; centerY: number } | null;

const clampZoom = (value: number) => Math.min(3, Math.max(0.6, value));
const touchDistance = (touches: TouchList) => Math.max(1, Math.hypot(
  touches[0].clientX - touches[1].clientX,
  touches[0].clientY - touches[1].clientY,
));

export default function PdfReader({ file, name, onClose }: PdfReaderProps) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [renderReady, setRenderReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const pinchRef = useRef<PinchStart>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    let active = true;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setPdfDocument(null);
    setLoading(true);
    setError('');
    setPageNumber(1);

    void (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        if (!active) return;
        loadingTask = getDocument({ data });
        const loadedDocument = await loadingTask.promise;
        if (active) setPdfDocument(loadedDocument);
      } catch {
        if (active) setError('لم نتمكن من فتح الملف. تأكد أنه PDF صالح وغير محمي بكلمة مرور.');
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
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === '+' || event.key === '=') setZoom((value) => clampZoom(value + 0.15));
      if (event.key === '-') setZoom((value) => clampZoom(value - 0.15));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;
    const observer = new ResizeObserver(() => setViewerWidth(scrollArea.clientWidth));
    observer.observe(scrollArea);
    setViewerWidth(scrollArea.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const rect = scrollArea.getBoundingClientRect();
      const centerX = ((event.touches[0].clientX + event.touches[1].clientX) / 2) - rect.left;
      pinchRef.current = {
        distance: touchDistance(event.touches),
        zoom: zoomRef.current,
        scrollTop: scrollArea.scrollTop,
        scrollLeft: scrollArea.scrollLeft,
        centerX,
        centerY: ((event.touches[0].clientY + event.touches[1].clientY) / 2) - rect.top,
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current;
      if (event.touches.length !== 2 || !pinch) return;
      event.preventDefault();
      const nextZoom = clampZoom(pinch.zoom * touchDistance(event.touches) / pinch.distance);
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      const ratio = nextZoom / pinch.zoom;
      requestAnimationFrame(() => {
        scrollArea.scrollTop = Math.max(0, (pinch.scrollTop + pinch.centerY) * ratio - pinch.centerY);
        scrollArea.scrollLeft = Math.max(0, (pinch.scrollLeft + pinch.centerX) * ratio - pinch.centerX);
      });
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinchRef.current = null;
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const previousZoom = zoomRef.current;
      const nextZoom = clampZoom(previousZoom * Math.exp(-event.deltaY * 0.002));
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      const rect = scrollArea.getBoundingClientRect();
      const anchorY = event.clientY - rect.top;
      const anchorX = event.clientX - rect.left;
      requestAnimationFrame(() => {
        scrollArea.scrollTop = Math.max(0, (scrollArea.scrollTop + anchorY) * (nextZoom / previousZoom) - anchorY);
        scrollArea.scrollLeft = Math.max(0, (scrollArea.scrollLeft + anchorX) * (nextZoom / previousZoom) - anchorX);
      });
    };
    scrollArea.addEventListener('touchstart', onTouchStart, { passive: true });
    scrollArea.addEventListener('touchmove', onTouchMove, { passive: false });
    scrollArea.addEventListener('touchend', onTouchEnd, { passive: true });
    scrollArea.addEventListener('touchcancel', onTouchEnd, { passive: true });
    scrollArea.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      scrollArea.removeEventListener('touchstart', onTouchStart);
      scrollArea.removeEventListener('touchmove', onTouchMove);
      scrollArea.removeEventListener('touchend', onTouchEnd);
      scrollArea.removeEventListener('touchcancel', onTouchEnd);
      scrollArea.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    const scrollArea = scrollRef.current;
    if (!scrollArea || !pdfDocument) return;
    scrollArea.scrollTop = 0;
    setPageNumber(1);
    setRenderReady(false);
  }, [pdfDocument]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const updatePageNumber = () => {
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;
    const marker = scrollArea.getBoundingClientRect().top + Math.min(170, scrollArea.clientHeight * 0.25);
    const visiblePage = Array.from(scrollArea.querySelectorAll<HTMLElement>('[data-pdf-page]'))
      .find((page) => page.getBoundingClientRect().bottom > marker);
    if (visiblePage) setPageNumber(Number(visiblePage.dataset.pdfPage));
  };
  const handleScroll = () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      updatePageNumber();
      scrollFrameRef.current = null;
    });
  };
  const changeZoom = (amount: number) => setZoom((value) => clampZoom(value + amount));

  return <div className="pdf-fullscreen" role="dialog" aria-modal="true" aria-label={`قارئ ملف ${name}`} dir="rtl">
    <header className="pdf-fullscreen-header">
      <div className="pdf-reader-title">
        <span className="pdf-reader-file-icon"><FileText size={17} /></span>
        <strong title={name}>{name}</strong>
        <button className="pdf-close-button" onClick={onClose} aria-label="إغلاق قارئ PDF" title="إغلاق"><X size={19} /></button>
      </div>
      <div className="pdf-reader-actions">
        <span className="pdf-page-count" aria-live="polite">{pdfDocument ? `صفحة ${pageNumber} من ${pdfDocument.numPages}` : 'قارئ PDF'}</span>
        <div className="pdf-zoom-controls" aria-label="تكبير الصفحة">
          <button className="viewer-control" aria-label="تصغير" title="تصغير" disabled={zoom <= 0.6} onClick={() => changeZoom(-0.15)}><Minus size={16} /></button>
          <span className="pdf-zoom-value">{Math.round(zoom * 100)}٪</span>
          <button className="viewer-control" aria-label="تكبير" title="تكبير" disabled={zoom >= 3} onClick={() => changeZoom(0.15)}><Plus size={16} /></button>
        </div>
      </div>
    </header>
    <main className="pdf-document-scroll" ref={scrollRef} onScroll={handleScroll} aria-label="صفحات الملف">
      {loading && <div className="pdf-reader-state" role="status"><LoaderCircle size={25} className="pdf-loader" /><span>جارٍ فتح الملف…</span></div>}
      {error && <div className="pdf-reader-state pdf-reader-error" role="alert"><span className="pdf-error-mark">!</span><strong>تعذّرت القراءة</strong><span>{error}</span></div>}
      {pdfDocument && !error && <div className="pdf-pages-stack">
        {Array.from({ length: pdfDocument.numPages }, (_, index) => <PdfPage
          key={`${pdfDocument.fingerprints[0] ?? name}-${index + 1}`}
          document={pdfDocument}
          pageNumber={index + 1}
          zoom={zoom}
          viewerWidth={viewerWidth}
          onRendered={index === 0 ? setRenderReady : undefined}
        />)}
      </div>}
      {pdfDocument && !renderReady && !loading && <div className="pdf-first-page-loading" role="status"><LoaderCircle size={22} className="pdf-loader" /><span>جارٍ تجهيز الصفحة الأولى…</span></div>}
    </main>
  </div>;
}

type PdfPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  viewerWidth: number;
  onRendered?: (ready: boolean) => void;
};

function PdfPage({ document, pageNumber, zoom, viewerWidth, onRendered }: PdfPageProps) {
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [baseSize, setBaseSize] = useState<PageSize | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [pageError, setPageError] = useState('');
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void document.getPage(pageNumber).then((loadedPage) => {
      if (!active) return;
      const viewport = loadedPage.getViewport({ scale: 1 });
      setPage(loadedPage);
      setBaseSize({ width: viewport.width, height: viewport.height });
    }).catch(() => {
      if (active) setPageError('تعذّر تجهيز هذه الصفحة.');
    });
    return () => { active = false; };
  }, [document, pageNumber]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new IntersectionObserver((entries) => {
      setNearViewport(Boolean(entries[0]?.isIntersecting));
    }, { rootMargin: '850px 0px' });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  const fitScale = baseSize && viewerWidth
    ? Math.max(0.25, Math.min(1.6, (viewerWidth - 42) / baseSize.width))
    : 1;
  const scale = fitScale * zoom;
  const viewport = page ? page.getViewport({ scale }) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const textContainer = textLayerRef.current;
    if (!page || !canvas || !textContainer || !viewport) return;
    if (!nearViewport) {
      canvas.width = 0;
      canvas.height = 0;
      textContainer.replaceChildren();
      setRendering(false);
      return;
    }
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let textLayer: TextLayer | null = null;
    let restoreCanvasText: (() => void) | null = null;
    setRendering(true);
    setPageError('');

    void (async () => {
      try {
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const containsArabic = textContent.items.some((item) => 'str' in item && /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/i.test(item.str));
        textContainer.replaceChildren();
        textContainer.classList.toggle('arabic-readable', containsArabic);
        textContainer.style.width = `${viewport.width}px`;
        textContainer.style.height = `${viewport.height}px`;
        textContainer.style.setProperty('--total-scale-factor', String(viewport.scale));
        textLayer = new TextLayer({ textContentSource: textContent, container: textContainer, viewport });

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas rendering is unavailable.');
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

        const originalFillText = context.fillText.bind(context);
        const originalStrokeText = context.strokeText.bind(context);
        if (containsArabic) {
          context.fillText = () => {};
          context.strokeText = () => {};
          restoreCanvasText = () => {
            context.fillText = originalFillText;
            context.strokeText = originalStrokeText;
          };
        }
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await Promise.all([renderTask.promise, textLayer.render()]);
        restoreCanvasText?.();
        restoreCanvasText = null;
        if (!cancelled) {
          setRendering(false);
          onRendered?.(true);
        }
      } catch (renderError) {
        restoreCanvasText?.();
        if (cancelled || (renderError instanceof Error && renderError.name === 'RenderingCancelledException')) return;
        setPageError('تعذّر عرض الصفحة. جرّب إعادة فتح الملف.');
        setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [page, nearViewport, viewport?.width, viewport?.height, viewport?.scale, onRendered]);

  return <section
    className={`pdf-page-shell ${rendering ? 'rendering' : ''}`}
    data-pdf-page={pageNumber}
    ref={shellRef}
    style={viewport ? { width: viewport.width, height: viewport.height } : baseSize ? { aspectRatio: `${baseSize.width} / ${baseSize.height}` } : undefined}
    aria-label={`صفحة ${pageNumber}`}
  >
    <canvas ref={canvasRef} className="pdf-page-canvas" aria-hidden="true" />
    <div ref={textLayerRef} className="pdf-text-layer" aria-hidden="true" />
    {rendering && <div className="pdf-page-placeholder"><LoaderCircle size={20} className="pdf-loader" /><span>صفحة {pageNumber}</span></div>}
    {pageError && <div className="pdf-page-placeholder pdf-page-error" role="alert">{pageError}</div>}
  </section>;
}
