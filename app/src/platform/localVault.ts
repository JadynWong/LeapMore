interface Entry {
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

const store = 'entries';
let connection: Promise<IDBDatabase> | undefined;

function open() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('leapmore-local-vault', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => { connection = undefined; throw error; });
  return connection;
}

async function access<T>(mode: IDBTransactionMode, operation: (entries: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = operation(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? request.error);
  });
}

function algorithm(id: string, iv: Uint8Array<ArrayBuffer>) {
  return { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) };
}

export async function readLocalSecret(id: string) {
  const entry = await access<Entry | undefined>('readonly', entries => entries.get(id));
  if (!entry) return undefined;
  return new TextDecoder().decode(await crypto.subtle.decrypt(algorithm(id, entry.iv), entry.key, entry.ciphertext));
}

export async function writeLocalSecret(id: string, value: string) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(algorithm(id, iv), key, new TextEncoder().encode(value));
  await access('readwrite', entries => entries.put({ key, iv, ciphertext } satisfies Entry, id));
}

export async function deleteLocalSecret(id: string) {
  await access('readwrite', entries => entries.delete(id));
}
