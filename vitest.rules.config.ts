import { defineConfig } from 'vitest/config';

// Security-rules tests; they need the Firestore emulator (npm run test:rules).
export default defineConfig({
  // files run one at a time: the rules tests wipe the emulator database between tests
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 20000, fileParallelism: false },
});
