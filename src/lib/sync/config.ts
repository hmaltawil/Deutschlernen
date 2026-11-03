import type { FirebaseOptions } from 'firebase/app';

/**
 * Firebase web config of the sync project. These values identify the project and
 * are public by design; access is controlled by firestore.rules.
 * A build can override them with VITE_FIREBASE_CONFIG (JSON), e.g. for the emulator.
 */
const PROJECT: FirebaseOptions | null = null;

const fromEnv = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
export const firebaseConfig: FirebaseOptions | null = fromEnv ? (JSON.parse(fromEnv) as FirebaseOptions) : PROJECT;

/** host:port of a Firestore emulator (tests only). */
export const emulatorHost = (import.meta.env.VITE_FIRESTORE_EMULATOR as string | undefined) || '';
