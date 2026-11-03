/** Firestore backend for sync (lite SDK: small, no realtime listeners, works with transactions). */
import { getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectFirestoreEmulator, doc, getFirestore, runTransaction } from 'firebase/firestore/lite';
import type { Chunk, RemoteTx } from './core';

export interface Remote {
  transact<T>(syncId: string, fn: (tx: RemoteTx) => Promise<T>): Promise<T>;
}

export function createRemote(config: FirebaseOptions, emulator?: string): Remote {
  const app = getApps().find((a) => a.name === 'luecke') ?? initializeApp(config, 'luecke');
  const db = getFirestore(app);
  if (emulator) {
    const [host, port] = emulator.split(':');
    try {
      connectFirestoreEmulator(db, host, Number(port));
    } catch {
      /* already connected */
    }
  }
  return {
    transact(syncId, fn) {
      return runTransaction(
        db,
        (t) => {
          const ref = (id: string) => doc(db, 'sync', syncId, 'chunks', id);
          return fn({
            get: async (id) => {
              const snap = await t.get(ref(id));
              return snap.exists() ? (snap.data() as Chunk) : null;
            },
            set: (id, chunk) => {
              t.set(ref(id), chunk);
            },
          });
        },
        { maxAttempts: 6 },
      );
    },
  };
}
