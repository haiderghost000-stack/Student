const DB_NAME = 'rafiq-pdf-library';
const STORE_NAME = 'pdfs';

function openPdfDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveSharedPdfs(files) {
  const db = await openPdfDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const addedAt = new Date().toISOString();

      files.forEach((file) => {
        store.put({
          id: `shared-${crypto.randomUUID()}`,
          name: file.name || 'ملف PDF مشترك.pdf',
          size: file.size,
          addedAt,
          file,
        });
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

self.addEventListener('fetch', (event) => {
  const sharePath = new URL('share-target/', self.registration.scope).pathname;
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'POST' || requestUrl.pathname !== sharePath) return;

  event.respondWith((async () => {
    try {
      const formData = await event.request.formData();
      const sharedFiles = formData.getAll('files').filter((value) => value instanceof File && value.size > 0);
      const pdfFiles = sharedFiles.filter((file) => (
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      ));
      const unsupportedCount = sharedFiles.length - pdfFiles.length;

      if (pdfFiles.length) await saveSharedPdfs(pdfFiles);

      const destination = new URL('./', self.registration.scope);
      destination.searchParams.set('shared', String(pdfFiles.length));
      destination.searchParams.set('unsupported', String(unsupportedCount));
      return Response.redirect(destination.href, 303);
    } catch (error) {
      console.error('Failed to receive shared files.', error);
      const destination = new URL('./', self.registration.scope);
      destination.searchParams.set('shareError', '1');
      return Response.redirect(destination.href, 303);
    }
  })());
});
