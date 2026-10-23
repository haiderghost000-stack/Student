import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FileText, LoaderCircle, Maximize2, Minus, Plus, X,
} from 'lucide-react';
import panzoom, { type PanZoom } from 'panzoom';
import {
  getDocument, GlobalWorkerOptions, TextLayer,
  type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfReaderProps = { file: Blob; name: string; onClose: () => void };
type PageSize = { width: number; height: number };
type ZoomAnchor = {
  pageNumber: number;
  pageX: number;
  pageY: number;
  viewportX: number;
  viewportY: number;
};
type PinchGesture = { lastX: number; lastY: number } | null;
type SingleTouchScroll = { lastX: number; lastY: number } | null;

const clampZoom = (value: number) => Math.min(4, Math.max(0.5, Math.round(value * 100) / 100));
const arabicTextPattern = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/i;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function captureZoomAnchor(scrollArea: HTMLElement, viewportX: number, viewportY: number): ZoomAnchor | null {
  const areaRect = scrollArea.getBoundingClientRect();
  const clientX = areaRect.left + viewportX;
  const clientY = areaRect.top + viewportY;
  const pages = Array.from(scrollArea.querySelectorAll<HTMLElement>('[data-pdf-page]'));
  if (!pages.length) return null;

  let page: HTMLElement | null = null;
  let pageRect: DOMRect | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  let anchorClientX = clientX;
  let anchorClientY = clientY;
  for (const candidate of pages) {
    const rect = candidate.getBoundingClientRect();
    const withinPage = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    if (withinPage) {
      page = candidate;
      pageRect = rect;
      break;
    }
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const distance = dx * dx + dy * dy;
    if (distance < closestDistance) {
      closestDistance = distance;
      page = candidate;
      pageRect = rect;
      anchorClientX = clamp(clientX, rect.left, rect.right);
      anchorClientY = clamp(clientY, rect.top, rect.bottom);
    }
  }
  if (!page || !pageRect) return null;
  if (!pageRect.width || !pageRect.height) return null;

  return {
    pageNumber: Number(page.dataset.pdfPage),
    pageX: clamp((anchorClientX - pageRect.left) / pageRect.width, 0, 1),
    pageY: clamp((anchorClientY - pageRect.top) / pageRect.height, 0, 1),
    viewportX: anchorClientX - areaRect.left,
    viewportY: anchorClientY - areaRect.top,
  };
}

function ensureZoomPanSpace(scrollArea: HTMLElement) {
  const stack = scrollArea.querySelector<HTMLElement>('.pdf-pages-stack');
  if (!stack) return;

  const verticalSpace = Math.max(scrollArea.clientHeight, Number.parseFloat(stack.style.paddingTop) || 0);
  const horizontalSpace = Math.max(scrollArea.clientWidth, Number.parseFloat(stack.style.paddingLeft) || 0);
  stack.style.paddingTop = `${verticalSpace}px`;
  stack.style.paddingBottom = `${verticalSpace}px`;
  stack.style.paddingLeft = `${horizontalSpace}px`;
  stack.style.paddingRight = `${horizontalSpace}px`;
}

function clearPanzoomTransform(stack: HTMLElement) {
  stack.style.transform = '';
  stack.style.transformOrigin = '';
  stack.style.willChange = '';
}

function restoreZoomAnchor(scrollArea: HTMLElement, anchor: ZoomAnchor) {
  const page = Array.from(scrollArea.querySelectorAll<HTMLElement>('[data-pdf-page]'))
    .find((candidate) => Number(candidate.dataset.pdfPage) === anchor.pageNumber);
  if (!page) return;

  const areaRect = scrollArea.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  const anchorX = pageRect.left + anchor.pageX * pageRect.width - areaRect.left;
  const anchorY = pageRect.top + anchor.pageY * pageRect.height - areaRect.top;
  scrollArea.scrollLeft = Math.max(0, scrollArea.scrollLeft + anchorX - anchor.viewportX);
  scrollArea.scrollTop = Math.max(0, scrollArea.scrollTop + anchorY - anchor.viewportY);
}

export default function PdfReader({ file, name, onClose }: PdfReaderProps) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [panzoomEpoch, setPanzoomEpoch] = useState(0);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [renderReady, setRenderReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const pendingZoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const pinchRef = useRef<PinchGesture>(null);
  const singleTouchRef = useRef<SingleTouchScroll>(null);
  const panzoomRef = useRef<PanZoom | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const zoomValueRef = useRef<HTMLSpanElement>(null);

  const zoomTo = (value: number, anchorX?: number, anchorY?: number) => {
    const nextZoom = clampZoom(value);
    const previousZoom = zoomRef.current;
    if (nextZoom === previousZoom) return;
    const scrollArea = scrollRef.current;
    if (scrollArea) {
      const focusX = anchorX ?? scrollArea.clientWidth / 2;
      const focusY = anchorY ?? scrollArea.clientHeight / 2;
      pendingZoomAnchorRef.current = captureZoomAnchor(scrollArea, focusX, focusY);
      ensureZoomPanSpace(scrollArea);
    }
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
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

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    const scrollArea = scrollRef.current;
    if (!anchor || !scrollArea) return;
    pendingZoomAnchorRef.current = null;
    restoreZoomAnchor(scrollArea, anchor);
  }, [zoom]);

  useEffect(() => {
    const scrollArea = scrollRef.current;
    const stack = scrollArea?.querySelector<HTMLElement>('.pdf-pages-stack');
    if (!scrollArea || !stack || !pdfDocument) return;

    const controller = panzoom(stack, {
      minZoom: 0.5 / zoomRef.current,
      maxZoom: 4 / zoomRef.current,
      pinchSpeed: 1,
      smoothScroll: false,
      zoomDoubleClickSpeed: 1,
      beforeWheel: () => true,
      beforeMouseDown: () => true,
      disableKeyboardInteraction: true,
    });
    panzoomRef.current = controller;

    const onTouchStartCapture = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        const touch = event.touches[0];
        singleTouchRef.current = { lastX: touch.clientX, lastY: touch.clientY };
        event.stopPropagation();
        pinchRef.current = null;
        return;
      }
      if (event.touches.length !== 2) return;

      singleTouchRef.current = null;
      const rect = scrollArea.getBoundingClientRect();
      pinchRef.current = {
        lastX: (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left,
        lastY: (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top,
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current;
      if (event.touches.length === 2 && pinch) {
        const rect = scrollArea.getBoundingClientRect();
        pinch.lastX = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
        pinch.lastY = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top;
        return;
      }

      const singleTouch = singleTouchRef.current;
      if (event.touches.length !== 1 || !singleTouch) return;
      event.preventDefault();
      const touch = event.touches[0];
      scrollArea.scrollLeft -= touch.clientX - singleTouch.lastX;
      scrollArea.scrollTop -= touch.clientY - singleTouch.lastY;
      singleTouch.lastX = touch.clientX;
      singleTouch.lastY = touch.clientY;
    };
    const finishPinch = (event: TouchEvent) => {
      const pinch = pinchRef.current;
      if (event.touches.length >= 2) return;
      if (!pinch) {
        if (event.touches.length === 0) singleTouchRef.current = null;
        return;
      }
      pinchRef.current = null;
      singleTouchRef.current = event.touches.length === 1
        ? { lastX: event.touches[0].clientX, lastY: event.touches[0].clientY }
        : null;

      const areaRect = scrollArea.getBoundingClientRect();
      const focus = event.touches.length === 1
        ? { x: event.touches[0].clientX - areaRect.left, y: event.touches[0].clientY - areaRect.top }
        : { x: pinch.lastX, y: pinch.lastY };
      const anchor = captureZoomAnchor(scrollArea, focus.x, focus.y);
      const nextZoom = clampZoom(zoomRef.current * controller.getTransform().scale);

      if (panzoomRef.current === controller) {
        controller.dispose();
        panzoomRef.current = null;
      }
      clearPanzoomTransform(stack);
      ensureZoomPanSpace(scrollArea);

      if (nextZoom === zoomRef.current) {
        if (anchor) restoreZoomAnchor(scrollArea, anchor);
        if (zoomValueRef.current) zoomValueRef.current.textContent = `${Math.round(zoomRef.current * 100)}٪`;
        setPanzoomEpoch((current) => current + 1);
        return;
      }

      pendingZoomAnchorRef.current = anchor;
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const previousZoom = zoomRef.current;
      const rect = scrollArea.getBoundingClientRect();
      zoomTo(previousZoom * Math.exp(-event.deltaY * 0.002), event.clientX - rect.left, event.clientY - rect.top);
    };

    const onTransform = () => {
      const currentZoom = clampZoom(zoomRef.current * controller.getTransform().scale);
      if (zoomValueRef.current) zoomValueRef.current.textContent = `${Math.round(currentZoom * 100)}٪`;
    };
    controller.on('transform', onTransform);
    scrollArea.addEventListener('touchstart', onTouchStartCapture, { capture: true, passive: true });
    scrollArea.addEventListener('touchmove', onTouchMove, { passive: false });
    scrollArea.addEventListener('touchend', finishPinch, { passive: true });
    scrollArea.addEventListener('touchcancel', finishPinch, { passive: true });
    scrollArea.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      scrollArea.removeEventListener('touchstart', onTouchStartCapture, true);
      scrollArea.removeEventListener('touchmove', onTouchMove);
      scrollArea.removeEventListener('touchend', finishPinch);
      scrollArea.removeEventListener('touchcancel', finishPinch);
      scrollArea.removeEventListener('wheel', onWheel);
      if (panzoomRef.current === controller) {
        controller.dispose();
        panzoomRef.current = null;
      }
      clearPanzoomTransform(stack);
    };
  }, [pdfDocument, zoom, panzoomEpoch]);

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
  const hasRenderedRef = useRef(false);
  const renderedSizeRef = useRef<PageSize | null>(null);

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
      canvas.style.width = '';
      canvas.style.height = '';
      textContainer.replaceChildren();
      textContainer.style.transform = '';
      hasRenderedRef.current = false;
      renderedSizeRef.current = null;
      setRendering(false);
      return;
    }
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let textLayer: TextLayer | null = null;
    let restoreCanvasText: (() => void) | null = null;
    let pendingTextContainer: HTMLDivElement | null = null;
    setRendering(true);
    setPageError('');
    const previousRenderedSize = renderedSizeRef.current;
    if (hasRenderedRef.current && previousRenderedSize) {
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      textContainer.style.transform = `scale(${viewport.width / previousRenderedSize.width})`;
    }

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
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const renderCanvas = window.document.createElement('canvas');
        renderCanvas.width = Math.floor(viewport.width * outputScale);
        renderCanvas.height = Math.floor(viewport.height * outputScale);
        const context = renderCanvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas rendering is unavailable.');
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

        pendingTextContainer = window.document.createElement('div');
        pendingTextContainer.className = 'pdf-text-layer';
        pendingTextContainer.classList.toggle('arabic-readable', containsArabic);
        pendingTextContainer.style.position = 'fixed';
        pendingTextContainer.style.inset = 'auto';
        pendingTextContainer.style.left = '-100000px';
        pendingTextContainer.style.top = '0';
        pendingTextContainer.style.direction = 'ltr';
        pendingTextContainer.style.width = `${viewport.width}px`;
        pendingTextContainer.style.height = `${viewport.height}px`;
        pendingTextContainer.style.setProperty('--total-scale-factor', String(viewport.scale));
        window.document.body.append(pendingTextContainer);
        textLayer = new TextLayer({ textContentSource: textContentForLayer, container: pendingTextContainer, viewport });

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
        renderTask = page.render({ canvas: renderCanvas, canvasContext: context, viewport });
        const pageRenderPromise = Promise.allSettled([renderTask.promise, textRenderPromise]).then((results) => {
          restoreCanvasText?.();
          restoreCanvasText = null;
          const failedRender = results.find((result) => result.status === 'rejected');
          if (failedRender?.status === 'rejected') throw failedRender.reason;
        });
        renderQueueRef.current = pageRenderPromise.then(() => {}, () => {});
        await pageRenderPromise;
        if (cancelled) return;

        canvas.width = renderCanvas.width;
        canvas.height = renderCanvas.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const visibleContext = canvas.getContext('2d', { alpha: false });
        if (!visibleContext) throw new Error('Canvas rendering is unavailable.');
        visibleContext.drawImage(renderCanvas, 0, 0);
        textContainer.classList.toggle('arabic-readable', containsArabic);
        textContainer.style.width = `${viewport.width}px`;
        textContainer.style.height = `${viewport.height}px`;
        textContainer.style.setProperty('--total-scale-factor', String(viewport.scale));
        textContainer.style.transform = '';
        textContainer.replaceChildren(...Array.from(pendingTextContainer?.childNodes ?? []));
        pendingTextContainer?.remove();
        pendingTextContainer = null;
        hasRenderedRef.current = true;
        renderedSizeRef.current = { width: viewport.width, height: viewport.height };
        setRendering(false);
        onRendered?.(true);
      } catch (renderError) {
        restoreCanvasText?.();
        pendingTextContainer?.remove();
        pendingTextContainer = null;
        if (cancelled || (renderError instanceof Error && renderError.name === 'RenderingCancelledException')) return;
        setPageError('تعذّر عرض الصفحة. جرّب إعادة فتح الملف.');
        setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      pendingTextContainer?.remove();
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
    {rendering && !hasRenderedRef.current && <div className="pdf-page-placeholder"><LoaderCircle size={20} className="pdf-loader" /><span>صفحة {pageNumber}</span></div>}
    {pageError && <div className="pdf-page-placeholder pdf-page-error" role="alert">{pageError}</div>}
  </section>;
}
