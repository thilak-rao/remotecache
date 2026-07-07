import { Storage, type StorageOptions } from '@google-cloud/storage';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { CacheEntryExistsError, CacheStorageStrategy } from './storage-strategy.interface';

type GcsMetadata = { size?: string | number };

export interface GcsWriteOptions {
  resumable: boolean;
  validation: 'crc32c';
  metadata: {
    contentType: 'application/octet-stream';
  };
  preconditionOpts: {
    ifGenerationMatch: 0;
  };
}

export interface GcsFile {
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[GcsMetadata, ...unknown[]]>;
  createReadStream(): Readable;
  createWriteStream(options: GcsWriteOptions): Writable;
}

export interface GcsListOptions {
  autoPaginate: false;
  maxResults: 1;
}

export interface GcsBucket {
  file(name: string): GcsFile;
  getFiles(options: GcsListOptions): Promise<unknown>;
}

export interface GcsClient {
  bucket(name: string): GcsBucket;
}

export interface GcsStrategyOptions {
  bucket: string;
  projectId?: string;
  keyFilename?: string;
  credentials?: NonNullable<StorageOptions['credentials']>;
  client?: GcsClient;
}

function createClient(options: GcsStrategyOptions): GcsClient {
  if (options.client) return options.client;

  const storageOptions: StorageOptions = {
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.keyFilename ? { keyFilename: options.keyFilename } : {}),
    ...(options.credentials ? { credentials: options.credentials } : {}),
  };
  return new Storage(storageOptions);
}

function isPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; statusCode?: unknown };
  return candidate.code === 412 || candidate.statusCode === 412;
}

export class GcsStrategy implements CacheStorageStrategy {
  readonly #bucket: GcsBucket;

  constructor(options: GcsStrategyOptions) {
    this.#bucket = createClient(options).bucket(options.bucket);
  }

  #file(hash: string): GcsFile {
    return this.#bucket.file(hash);
  }

  async exists(hash: string): Promise<boolean> {
    const [exists] = await this.#file(hash).exists();
    return exists;
  }

  async getStream(hash: string): Promise<ReadableStream> {
    return Readable.toWeb(this.#file(hash).createReadStream()) as unknown as ReadableStream;
  }

  async getSize(hash: string): Promise<number> {
    const [metadata] = await this.#file(hash).getMetadata();
    return Number(metadata.size ?? 0);
  }

  async writeStream(
    hash: string,
    stream: ReadableStream<Uint8Array>,
    _contentLength: number,
  ): Promise<void> {
    const writer = this.#file(hash).createWriteStream({
      resumable: true,
      validation: 'crc32c',
      metadata: {
        contentType: 'application/octet-stream',
      },
      preconditionOpts: {
        ifGenerationMatch: 0,
      },
    });

    try {
      // Bun's global ReadableStream is runtime-compatible with node:stream/web,
      // but its convenience-method types differ from Node's declarations.
      await pipeline(Readable.fromWeb(stream as unknown as NodeReadableStream<Uint8Array>), writer);
    } catch (error) {
      if (isPreconditionFailed(error)) {
        throw new CacheEntryExistsError(hash);
      }
      throw error;
    }
  }

  async checkReady(): Promise<void> {
    await this.#bucket.getFiles({ autoPaginate: false, maxResults: 1 });
  }
}
