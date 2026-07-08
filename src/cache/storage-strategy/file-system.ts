import { join } from 'node:path';
import { CacheEntryExistsError, CacheStorageStrategy } from './storage-strategy.interface';
import { link, mkdir, rm, utimes } from 'node:fs/promises';
import {
  accessSync,
  constants,
  existsSync,
  linkSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { logger } from '../../logger';

function assertExistingFileSystemCacheDirReady(dir: string): void {
  try {
    accessSync(dir, constants.W_OK | constants.X_OK);
  } catch (error) {
    throw new Error(
      `CACHE_DIR "${dir}" is not writable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const probe = join(dir, `.remotecache-link-probe-${crypto.randomUUID()}`);
  const probeLink = `${probe}.link`;
  try {
    writeFileSync(probe, '');
    linkSync(probe, probeLink);
  } catch (error) {
    throw new Error(
      `CACHE_DIR "${dir}" does not support atomic hard-link commits: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    for (const path of [probeLink, probe]) {
      try {
        unlinkSync(path);
      } catch {}
    }
  }
}

export function assertFileSystemCacheDirReady(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new Error(
      `CACHE_DIR "${dir}" is not writable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertExistingFileSystemCacheDirReady(dir);
}

export class FileSystemStrategy implements CacheStorageStrategy {
  constructor(public readonly cacheDir: string) {
    this.sweepOrphanedTempFiles();
  }

  // A hard crash (SIGKILL, OOM, power loss) mid-upload leaves the
  // `${hash}.<uuid>.tmp` write buffer behind, and nothing else ever removes it.
  // Deployment is single-instance (the chart fail-guards replicaCount > 1), so
  // sweeping leftovers at startup is safe and reclaims that space.
  private sweepOrphanedTempFiles(): void {
    if (!existsSync(this.cacheDir)) return;
    try {
      for (const name of new Bun.Glob('*.tmp').scanSync(this.cacheDir)) {
        rmSync(join(this.cacheDir, name), { force: true });
      }
    } catch (error) {
      logger.error(error);
    }
  }

  private getPath(hash: string) {
    return join(this.cacheDir, hash);
  }

  private getTempPath(hash: string) {
    // Unique per write: concurrent uploads of the same hash must never share
    // a temp file, or their chunks interleave into a corrupt artifact.
    return join(this.cacheDir, `${hash}.${crypto.randomUUID()}.tmp`);
  }

  async checkReady(): Promise<void> {
    assertExistingFileSystemCacheDirReady(this.cacheDir);
  }

  async exists(hash: string): Promise<boolean> {
    return Bun.file(this.getPath(hash)).exists();
  }

  async getStream(hash: string): Promise<ReadableStream> {
    const path = this.getPath(hash);
    // Eviction recency: mtime means "last accessed" (see src/cache/eviction.ts).
    const now = new Date();
    try {
      await utimes(path, now, now);
    } catch {}
    return Bun.file(path).stream();
  }

  async getSize(hash: string): Promise<number> {
    const file = Bun.file(this.getPath(hash));
    if (!(await file.exists())) return 0;
    return file.size;
  }

  async writeStream(
    hash: string,
    stream: ReadableStream<Uint8Array>,
    _contentLength: number,
  ): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });

    const finalPath = this.getPath(hash);
    const tempPath = this.getTempPath(hash);
    const writer = Bun.file(tempPath).writer();

    const closeWriter = async () => {
      try {
        await writer.end();
      } catch {}
    };

    try {
      try {
        for await (const chunk of stream) {
          await writer.write(chunk);
        }
        await writer.end();
      } catch (error) {
        await closeWriter();
        throw error;
      }

      // rename() silently replaces an existing destination, so two concurrent
      // writers of one hash would be last-writer-wins. link() fails with EEXIST
      // instead, making first-writer-wins an atomic invariant; the losing writer
      // surfaces as a 409.
      await link(tempPath, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new CacheEntryExistsError(hash);
      }
      throw error;
    } finally {
      try {
        await rm(tempPath, { force: true });
      } catch {}
    }
  }
}
