import { useEffect, useRef, useState } from 'react';
import {
  FileText, LoaderCircle, Maximize2, Minus, Plus, X,
} from 'lucide-react';
import {
  getDocument, GlobalWorkerOptions, TextLayer,
  type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfReaderProps = { file: Blob; name: string; onClose: () => void };
type PageSize = { width: number; height: number };
type PinchStart = {
  distance: number;
  zoom: number;
  currentZoom: number;
  scrollTop: number;
  scrollLeft: number;
  centerX: number;
  centerY: number;
  originX: number;
  originY: number;
  frameId: number | null;
} | null;

const clampZoom = (value: number) => Math.min(4, Math.max(0.5, Math.round(value * 100) / 100));
const arabicTextPattern = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/i;
const touchDistance = (touches: TouchList) => Math.max(1, Math.hypot(
  touches[0].clientX - touches[1].clientX,
  touches[0].clientY - touches[1].clientY,
));

function applyStackPreview(scrollArea: HTMLElement, baseZoom: number, previewZoom: number, originX: number, originY: number) {
  const stack = scrollArea.querySelector<HTMLElement>('.pdf-pages-stack');
  if (!stack) return;
  stack.style.transformOrigin = `${originX}px ${originY}px`;
  stack.style.transform = `scale(${previewZoom / baseZoom})`;
  stack.style.willChange = 'transform';
}

function clearStackPreview(scrollArea: HTMLElement) {
  const stack = scrollArea.querySelector<HTMLElement>('.pdf-pages-stack');
  if (!stack) return;
  stack.style.transform = '';
  stack.style.transformOrigin = '';
  stack.style.willChange = '';
}

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
  const zoomValueRef = useRef<HTMLSpanElement>(null);

  const zoomTo = (value: number, anchorX?: number, anchorY?: number) => {
    const nextZoom = clampZoom(value);
    const previousZoom = zoomRef.current;
    if (nextZoom === previousZoom) return;
    const scrollArea = scrollRef.current;
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    if (!scrollArea) return;
    const focusX = anchorX ?? scrollArea.clientWidth / 2;
    const focusY = anchorY ?? scrollArea.clientHeight / 2;
    const previousScrollTop = scrollArea.scrollTop;
    const previousScrollLeft = scrollArea.scrollLeft;
    const ratio = nextZoom / previousZoom;
    requestAnimationFrame(() => {
      scrollArea.scrollTop = Math.max(0, (previousScrollTop + focusY) * ratio - focusY);
      scrollArea.scrollLeft = Math.max(0, (previousScrollLeft + focusX) * ratio - focusX);
    });
  };

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
      if (event.key === '+' || event.key === '=') zoomTo(zoomRef.current + 0.1);
      if (event.key === '-') zoomTo(zoomRef.current - 0.1);
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
      const clientX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const clientY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      const centerX = clientX - rect.left;
      const centerY = clientY - rect.top;
      const stackRect = scrollArea.querySelector<HTMLElement>('.pdf-pages-stack')?.getBoundingClientRect();
      pinchRef.current = {
        distance: touchDistance(event.touches),
        zoom: zoomRef.current,
        currentZoom: zoomRef.current,
        scrollTop: scrollArea.scrollTop,
        scrollLeft: scrollArea.scrollLeft,
        centerX,
        centerY,
        originX: stackRect ? clientX - stackRect.left : centerX,
        originY: stackRect ? clientY - stackRect.top : centerY,
        frameId: null,
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current;
      if (event.touches.length !== 2 || !pinch) return;
      event.preventDefault();
      pinch.currentZoom = clampZoom(pinch.zoom * touchDistance(event.touches) / pinch.distance);
      if (zoomValueRef.current) zoomValueRef.current.textContent = `${Math.round(pinch.currentZoom * 100)}٪`;
      if (pinch.frameId !== null) cancelAnimationFrame(pinch.frameId);
      pinch.frameId = requestAnimationFrame(() => {
        applyStackPreview(scrollArea, pinch.zoom, pinch.currentZoom, pinch.originX, pinch.originY);
        pinch.frameId = null;
      });
    };
    const onTouchEnd = (event: TouchEvent) => {
      const pinch = pinchRef.current;
      if (event.touches.length >= 2 || !pinch) return;
      pinchRef.current = null;
      if (pinch.frameId !== null) cancelAnimationFrame(pinch.frameId);
      if (pinch.currentZoom === pinch.zoom) {
        clearStackPreview(scrollArea);
        return;
      }
      applyStackPreview(scrollArea, pinch.zoom, pinch.currentZoom, pinch.originX, pinch.originY);
      const ratio = pinch.currentZoom / pinch.zoom;
      zoomRef.current = pinch.currentZoom;
      setZoom(pinch.currentZoom);
      requestAnimationFrame(() => {
        scrollArea.scrollTop = Math.max(0, (pinch.scrollTop + pinch.centerY) * ratio - pinch.centerY);
        scrollArea.scrollLeft = Math.max(0, (pinch.scrollLeft + pinch.centerX) * ratio - pinch.centerX);
        clearStackPreview(scrollArea);
      });
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const previousZoom = zoomRef.current;
      const rect = scrollArea.getBoundingClientRect();
      zoomTo(previousZoom * Math.exp(-event.deltaY * 0.002), event.clientX - rect.left, event.clientY - rect.top);
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
  const changeZoom = (amount: number) => zoomTo(zoomRef.current + amount);

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
          <button className="viewer-control" aria-label="تصغير" title="تصغير" disabled={zoom <= 0.5} onClick={() => changeZoom(-0.1)}><Minus size={16} /></button>
          <span className="pdf-zoom-value" ref={zoomValueRef}>{Math.round(zoom * 100)}٪</span>
          <button className="viewer-control" aria-label="تكبير" title="تكبير" disabled={zoom >= 4} onClick={() => changeZoom(0.1)}><Plus size={16} /></button>
          <button className="viewer-control" aria-label="ملاءمة عرض الصفحة" title="ملاءمة عرض الصفحة" disabled={zoom === 1} onClick={() => zoomTo(1)}><Maximize2 size={14} /></button>
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
  const renderQueueRef = useRef<Promise<void>>(Promise.resolve());

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
        await renderQueueRef.current;
        if (cancelled) return;
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const arabicFontNames = new Set(
          textContent.items.flatMap((item) => 'str' in item && arabicTextPattern.test(item.str) ? [item.fontName] : []),
        );
        const containsArabic = arabicFontNames.size > 0;
        if (containsArabic) {
          await window.document.fonts.load('16px "IBM Plex Sans Arabic"').catch(() => {});
          if (cancelled) return;
        }
        const textContentForLayer = containsArabic ? {
          ...textContent,
          styles: Object.fromEntries(Object.entries(textContent.styles).map(([fontName, style]) => [
            fontName,
            arabicFontNames.has(fontName)
              ? { ...style, fontFamily: '"IBM Plex Sans Arabic", sans-serif' }
              : style,
          ])),
        } : textContent;
        textContainer.replaceChildren();
        textContainer.classList.toggle('arabic-readable', containsArabic);
        textContainer.style.width = `${viewport.width}px`;
        textContainer.style.height = `${viewport.height}px`;
        textContainer.style.setProperty('--total-scale-factor', String(viewport.scale));
        textLayer = new TextLayer({ textContentSource: textContentForLayer, container: textContainer, viewport });

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
        const textRenderPromise = textLayer.render();
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        const pageRenderPromise = Promise.allSettled([renderTask.promise, textRenderPromise]).then((results) => {
          restoreCanvasText?.();
          restoreCanvasText = null;
          const failedRender = results.find((result) => result.status === 'rejected');
          if (failedRender?.status === 'rejected') throw failedRender.reason;
        });
        renderQueueRef.current = pageRenderPromise.then(() => {}, () => {});
        await pageRenderPromise;
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
