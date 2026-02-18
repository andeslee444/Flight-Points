/**
 * Shared Utilities
 * Created: 2026-02-17
 */

import { writeFileSync, renameSync } from 'fs';
import { writeFile, rename } from 'fs/promises';

/**
 * Atomic write (sync): writes data to a .tmp file then renames to the target path.
 * Prevents data corruption from partial writes during crashes.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, filePath);
}

/**
 * Atomic write (async): non-blocking version for hot paths.
 * Use this in the main event loop to avoid blocking on large writes.
 */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, data);
  await rename(tmpPath, filePath);
}
