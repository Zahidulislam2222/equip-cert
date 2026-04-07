// Offline queue — stores inspection submissions in IndexedDB when offline, syncs when back online

const DB_NAME = 'equipcert-offline';
const DB_VERSION = 1;
const STORE_QUEUE = 'submission-queue';
const STORE_CHECKLISTS = 'cached-checklists';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_CHECKLISTS)) {
        db.createObjectStore(STORE_CHECKLISTS, { keyPath: 'equipmentName' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- Submission Queue ---

export interface QueuedSubmission {
  id?: number;
  payload: Record<string, unknown>;
  photoBlob?: Blob | null;
  timestamp: number;
}

export async function queueSubmission(submission: Omit<QueuedSubmission, 'id'>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).add(submission);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueuedSubmissions(): Promise<QueuedSubmission[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const request = tx.objectStore(STORE_QUEUE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueueCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const request = tx.objectStore(STORE_QUEUE).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- Checklist Cache ---

export interface CachedChecklist {
  equipmentName: string;
  items: { id: string; question: string }[];
  cachedAt: number;
}

export async function cacheChecklist(checklist: CachedChecklist): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHECKLISTS, 'readwrite');
    tx.objectStore(STORE_CHECKLISTS).put(checklist);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedChecklist(equipmentName: string): Promise<CachedChecklist | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHECKLISTS, 'readonly');
    const request = tx.objectStore(STORE_CHECKLISTS).get(equipmentName);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

// --- Sync Logic ---

export async function syncQueuedSubmissions(
  submitFn: (payload: Record<string, unknown>, photoBlob?: Blob | null) => Promise<void>
): Promise<{ synced: number; failed: number }> {
  const items = await getQueuedSubmissions();
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    try {
      await submitFn(item.payload, item.photoBlob);
      if (item.id) await removeFromQueue(item.id);
      synced++;
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}
