import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter } from 'prom-client';
import type { SecureNote } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { CACHE_KEY_PREFIX, CACHE_MAX_TTL_SEC } from '../constants';
import { EncryptionService } from '../encryption/encryption.service';
import type { CreateNoteDto } from './dto/create-note.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const SLUG_BYTES = 12;

function generateSlug(): string {
  return randomBytes(SLUG_BYTES).toString('base64url');
}

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly encryptionService: EncryptionService,
    @InjectMetric('note_read_total') private readonly noteReadTotal: Counter<string>,
    @InjectMetric('note_create_total') private readonly noteCreateTotal: Counter<string>,
  ) {}

  async readBySlug(slug: string): Promise<SecureNote | null> {
    const cacheKey = `${CACHE_KEY_PREFIX}${slug}`;

    if (this.redis.isEnabled) {
      const cached = await this.redis.get<SecureNote>(cacheKey);
      if (cached) {
        this.noteReadTotal.inc({ source: 'redis' });
        this.incrementViewCountOnly(slug)
          .then(({ invalidate }) => {
            if (invalidate) {
              return this.redis.del(cacheKey);
            }
          })
          .catch(() => {});
        const decrypted = { ...cached, content: this.encryptionService.decrypt(cached.content) };
        return decrypted;
      }
    }

    const rows = await this.prisma.$queryRaw<SecureNote[]>`
      UPDATE "SecureNote"
      SET "viewCount" = "viewCount" + 1
      WHERE "slug" = ${slug}
        AND "isDeleted" = false
        AND ("expiresAt" IS NULL OR "expiresAt" > now())
        AND ("maxViews" IS NULL OR "viewCount" < "maxViews")
      RETURNING *
    `;
    const note = rows[0] ?? null;
    if (!note) return null;

    if (this.redis.isEnabled) {
      const ttl = this.getCacheTtl(note);
      await this.redis.set(cacheKey, note, ttl);
    }

    if (note.maxViews != null && note.viewCount >= note.maxViews) {
      await this.prisma.secureNote.update({
        where: { id: note.id },
        data: { isDeleted: true },
      });
      if (this.redis.isEnabled) {
        await this.redis.del(cacheKey);
      }
    }
    this.noteReadTotal.inc({ source: 'postgres' });
    return { ...note, content: this.encryptionService.decrypt(note.content) };
  }

  private getCacheTtl(note: SecureNote): number {
    const maxTtl = CACHE_MAX_TTL_SEC;
    if (note.expiresAt == null) {
      return maxTtl;
    }
    const remainingSec = Math.floor(
      (note.expiresAt.getTime() - Date.now()) / 1000,
    );
    if (remainingSec <= 0) return 1;
    return Math.min(remainingSec, maxTtl);
  }

  /**
   * Increments view count for the note by slug. Returns whether cache should be invalidated (maxViews reached).
   */
  private async incrementViewCountOnly(
    slug: string,
  ): Promise<{ invalidate: boolean }> {
    const rows = await this.prisma.$queryRaw<
      { viewCount: number; maxViews: number | null; id: string }[]
    >`
      UPDATE "SecureNote"
      SET "viewCount" = "viewCount" + 1
      WHERE "slug" = ${slug}
        AND "isDeleted" = false
        AND ("expiresAt" IS NULL OR "expiresAt" > now())
        AND ("maxViews" IS NULL OR "viewCount" < "maxViews")
      RETURNING id, "viewCount", "maxViews"
    `;
    const row = rows[0];
    if (!row) return { invalidate: false };
    const invalidate =
      row.maxViews != null && row.viewCount >= row.maxViews;
    if (invalidate) {
      await this.prisma.secureNote.update({
        where: { id: row.id },
        data: { isDeleted: true },
      });
    }
    return { invalidate };
  }

  async create(dto: CreateNoteDto): Promise<SecureNote> {
    const data: Prisma.SecureNoteCreateInput = {
      slug: generateSlug(),
      content: this.encryptionService.encrypt(dto.content),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      maxViews: dto.maxViews ?? undefined,
    };

    let note: SecureNote;
    try {
      note = await this.prisma.secureNote.create({ data });
    } catch (err) {
      const isUniqueViolation =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002';
      if (!isUniqueViolation) throw err;
      data.slug = generateSlug();
      note = await this.prisma.secureNote.create({ data });
    }
    this.noteCreateTotal.inc();
    return note;
  }
}
