import { createHash } from 'crypto';
import { promisify } from 'util';
import { gunzip } from 'zlib';

const gunzipAsync = promisify(gunzip);

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

export class BodyParser {
  private inferredEncoding: 'gzip' | undefined;
  private parsed: Buffer | undefined;
  private bodyDigest: string | undefined = undefined;
  private parseErr: unknown = undefined;

  constructor(private readonly raw: Buffer) {}

  private throwIfNotReady(): void {
    if (this.parsed === undefined && this.parseErr === undefined)
      throw new Error('BodyParser: parse() has not been called yet');
    if (this.parseErr !== undefined) throw this.parseErr;
  }

  private async attemptParse(): Promise<Buffer> {
    if (this.raw.length >= 2 && this.raw.subarray(0, 2).equals(GZIP_MAGIC)) {
      this.inferredEncoding = 'gzip';
      this.parsed = await gunzipAsync(this.raw);
    } else {
      this.parsed = this.raw;
    }
    this.bodyDigest = createHash('sha256')
      .update(this.parsed)
      .digest('base64url');
    return this.parsed;
  }

  // idempotent
  async parse(): Promise<Buffer> {
    if (this.parsed !== undefined) return this.parsed;
    if (this.parseErr !== undefined) throw this.parseErr;

    try {
      return await this.attemptParse();
    } catch (e) {
      this.parseErr = e;
      throw e;
    }
  }

  isParsed(): boolean {
    return this.parseErr === undefined && this.parsed !== undefined;
  }

  getRaw(): Buffer {
    return this.raw;
  }

  getParsed(): Buffer {
    this.throwIfNotReady();
    return this.parsed!;
  }

  getCompressionFormat(): 'gzip' | undefined {
    if (this.parsed === undefined && this.parseErr === undefined)
      throw new Error('BodyParser: parse() has not been called yet');
    // Return inferred encoding even if decompression failed — it was detected
    // from the magic bytes before the error occurred.
    return this.inferredEncoding;
  }

  getBodyDigest(): string {
    this.throwIfNotReady();
    return this.bodyDigest!;
  }
}
