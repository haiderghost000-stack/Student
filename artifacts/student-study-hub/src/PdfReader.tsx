import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { TransformComponent, TransformWrapper, useControls } from 'react-zoom-pan-pinch';
import { FileText, LoaderCircle, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type PdfReaderProps = {
  file: File;
  fileName: string;
  onClose: () => void;
};

function ReaderZoomControls({ pageCount }: { pageCount: number | null }) {
  const { zoomIn, zoomOut, resetTransform } = useControls();

  return (
    <div className="pdf-reader-zoombar" dir="rtl">
      <span className="pdf-reader-page-count" aria-live="polite">
        {pageCount ? `${pageCount} صفحة` : 'جارٍ تحميل الملف…'}
      </span>
      <div className="pdf-reader-zoom-actions">
        <button type="button" aria-label="تكبير" title="تكبير" onClick={() => { void zoomIn(0.25); }}>
          <ZoomIn size={17} />
        </button>
        <button type="button" aria-label="تصغير" title="تصغير" onClick={() => { void zoomOut(0.25); }}>
          <ZoomOut size={17} />
        </button>
        <button type="button" className="pdf-reader-fit" title="ملاءمة عرض الصفحات" onClick={() => { void resetTransform(); }}>
          <Maximize2 size={15} />
          <span>ملاءمة العرض</span>
        </button>
      </div>
    </div>
  );
}

export default function PdfReader({ file, fileName, onClose }: PdfReaderProps) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageWidth, setPageWidth] = useState(560);
  const [isZoomed, setIsZoomed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateWidth = () => {
      setPageWidth(Math.max(280, Math.min(1200, Math.floor(stage.clientWidth) - 28)));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="pdf-reader" role="dialog" aria-modal="true" aria-labelledby="pdf-reader-title" dir="rtl">
      <header className="pdf-reader-header">
        <div className="pdf-reader-heading">
          <span className="pdf-reader-file-icon"><FileText size={18} /></span>
          <div className="pdf-reader-title-copy">
            <strong id="pdf-reader-title">{fileName}</strong>
            <small>قارئ PDF داخل التطبيق</small>
          </div>
        </div>
        <button className="pdf-reader-close" type="button" aria-label="إغلاق قارئ PDF" onClick={onClose}>
          <X size={19} />
        </button>
      </header>

      <TransformWrapper
        initialScale={1}
        minScale={1}
        maxScale={5}
        limitToBounds
        panning={{ disabled: !isZoomed, velocityDisabled: true }}
        pinch={{ step: 5, allowPanning: true }}
        wheel={{ disabled: true }}
        doubleClick={{ disabled: true }}
        onTransform={(_, state) => {
          const zoomed = state.scale > 1.01;
          setIsZoomed((current) => current === zoomed ? current : zoomed);
        }}
      >
        <ReaderZoomControls pageCount={pageCount} />
        <div ref={stageRef} className="pdf-reader-stage">
          <TransformComponent
            wrapperClass="pdf-reader-viewport"
            contentClass="pdf-reader-transform-content"
            wrapperStyle={{
              width: '100%',
              height: '100%',
              overflow: isZoomed ? 'hidden' : 'auto',
              touchAction: isZoomed ? 'none' : 'pan-y',
            }}
            contentStyle={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}
          >
            <Document
              key={`${file.name}-${file.size}-${file.lastModified}`}
              file={file}
              className="pdf-reader-document"
              loading={<div className="pdf-reader-state"><LoaderCircle className="pdf-reader-spinner" size={28} /><span>جارٍ تجهيز صفحات الملف…</span></div>}
              error={<div className="pdf-reader-state pdf-reader-error">تعذّر عرض هذا الملف. تأكد من أنه ملف PDF صالح ثم أعد فتحه.</div>}
              noData={<div className="pdf-reader-state pdf-reader-error">لم يتم العثور على بيانات للملف.</div>}
              onLoadSuccess={({ numPages }) => setPageCount(numPages)}
              onLoadError={() => setPageCount(null)}
              suspense={false}
            >
              <div className="pdf-reader-pages" dir="ltr">
                {Array.from({ length: pageCount ?? 0 }, (_, index) => (
                  <div className="pdf-reader-page" key={index + 1}>
                    <Page
                      pageNumber={index + 1}
                      width={pageWidth}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      loading={<div className="pdf-reader-page-loading" style={{ width: pageWidth }} />}
                    />
                  </div>
                ))}
              </div>
            </Document>
          </TransformComponent>
        </div>
      </TransformWrapper>
    </section>
  );
}
