// Runs against the Firestore emulator: npm run test:rules
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const id = 'a'.repeat(64);
const chunk = (data = '[]') => ({ v: 1, data, updated: Date.now() });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-luecke',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

describe('firestore.rules', () => {
  const db = () => env.unauthenticatedContext().firestore();

  it('lets anyone with the sync id write and read its chunks', async () => {
    await assertSucceeds(setDoc(doc(db(), `sync/${id}/chunks/p01`), chunk()));
    await assertSucceeds(setDoc(doc(db(), `sync/${id}/chunks/p01`), chunk('[[1]]')));
    await assertSucceeds(getDoc(doc(db(), `sync/${id}/chunks/p01`)));
    await assertSucceeds(getDocs(collection(db(), `sync/${id}/chunks`)));
  });
  it('rejects malformed ids, extra fields, wrong types and huge data', async () => {
    await assertFails(setDoc(doc(db(), 'sync/short/chunks/p01'), chunk()));
    await assertFails(setDoc(doc(db(), `sync/${id}/chunks/Bad_Id`), chunk()));
    await assertFails(setDoc(doc(db(), `sync/${id}/chunks/p01`), { ...chunk(), extra: 1 }));
    await assertFails(setDoc(doc(db(), `sync/${id}/chunks/p01`), { v: 1, data: 5, updated: 1 }));
    await assertFails(setDoc(doc(db(), `sync/${id}/chunks/p01`), chunk('x'.repeat(400001))));
  });
  it('never allows deleting, listing all codes, or collection-group queries', async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `sync/${id}/chunks/p01`), chunk()));
    await assertFails(deleteDoc(doc(db(), `sync/${id}/chunks/p01`)));
    await assertFails(getDocs(collection(db(), 'sync')));
    await assertFails(getDocs(collectionGroup(db(), 'chunks')));
    await assertFails(getDoc(doc(db(), `sync/${id}`)));
  });
});
