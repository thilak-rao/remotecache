export interface CacheFile {
  valid: () => boolean;
  exists: () => Promise<boolean>;
  stream: () => Promise<ReadableStream>;
  size: () => Promise<number>;
  writeStream: (stream: ReadableStream<Uint8Array>, contentLength: number) => Promise<void>;
}
