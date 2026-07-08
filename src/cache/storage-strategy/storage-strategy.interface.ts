export interface CacheStorageStrategy {
  exists(hash: string): Promise<boolean>;
  // assumes existence check has been done beforehand
  getStream(hash: string): Promise<ReadableStream>;
  getSize(hash: string): Promise<number>;
  writeStream(
    hash: string,
    stream: ReadableStream<Uint8Array>,
    contentLength: number,
  ): Promise<void>;
  checkReady(): Promise<void>;
}

/**
 * Thrown by writeStream when the hash already has a committed entry.
 * Cache writes are append-only: writeCache maps this to a 409 response.
 */
export class CacheEntryExistsError extends Error {
  constructor(hash: string) {
    super(`Cache entry already exists: ${hash}`);
    this.name = 'CacheEntryExistsError';
  }
}
