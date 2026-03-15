import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter } from 'prom-client';
import type { SecureNote } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { CACHE_KEY_PREFIX, CACHE_MAX_TTL_SEC } from '../constants';
import { EncryptionService } from '../encryption/encryption.service';
import { PasswordService } from '../password/password.service';
import type { CreateNoteDto } from './dto/create-note.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const SLUG_BYTES = 12;

function generateSlug(): string {
  return randomBytes(SLUG_BYTES).toString('base64url');
}

export type ReadNoteResult =
  | { success: true; content: string }
  | { success: false; code: 'PASSWORD_REQUIRED' | 'INVALID_PASSWORD' | 'WRONG_PASSWORD_LIMIT' }
  | null;

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly encryptionService: EncryptionService,
    private readonly passwordService: PasswordService,
    @InjectMetric('note_read_total') private readonly noteReadTotal: Counter<string>,
    @InjectMetric('note_create_total') private readonly noteCreateTotal: Counter<string>,
  ) {}

  /**
   * Find note by slug without incrementing view count. Returns null if not found or expired/deleted/over maxViews.
   */
  private async findNoteBySlug(slug: string): Promise<SecureNote | null> {
    const cacheKey = `${CACHE_KEY_PREFIX}${slug}`;
    if (this.redis.isEnabled) {
      const cached = await this.redis.get<SecureNote>(cacheKey);
      if (cached) return cached;
    }
    const note = await this.prisma.secureNote.findFirst({
      where: {
        slug,
        isDeleted: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!note) return null;
    if (note.maxViews != null && note.viewCount >= note.maxViews) return null;
    return note;
  }

  async readBySlug(slug: string, password?: string): Promise<ReadNoteResult> {
    const note = await this.findNoteBySlug(slug);
    if (!note) return null;

    if (note.passwordHash) {
      if (password === undefined || password === '') {
        return { success: false, code: 'PASSWORD_REQUIRED' };
      }
      const limitExceeded = await this.redis.isWrongPasswordLimitExceeded(slug);
      if (limitExceeded) {
        return { success: false, code: 'WRONG_PASSWORD_LIMIT' };
      }
      const valid = await this.passwordService.compare(password, note.passwordHash);
      if (!valid) {
        await this.redis.recordWrongPasswordAttempt(slug);
        return { success: false, code: 'INVALID_PASSWORD' };
      }
    }

    const cacheKey = `${CACHE_KEY_PREFIX}${slug}`;

    if (this.redis.isEnabled) {
      const cached = await this.redis.get<SecureNote>(cacheKey);
      if (cached) {
        this.noteReadTotal.inc({ source: 'redis' });
        this.incrementViewCountOnly(slug)
          .then(({ invalidate }) => {
            if (invalidate) return this.redis.del(cacheKey);
          })
          .catch(() => {});
        const content = this.encryptionService.decrypt(cached.content);
        return { success: true, content };
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
    const updated = rows[0] ?? null;
    if (!updated) return null;

    if (this.redis.isEnabled) {
      const ttl = this.getCacheTtl(updated);
      await this.redis.set(cacheKey, updated, ttl);
    }

    if (updated.maxViews != null && updated.viewCount >= updated.maxViews) {
      await this.prisma.secureNote.update({
        where: { id: updated.id },
        data: { isDeleted: true },
      });
      if (this.redis.isEnabled) await this.redis.del(cacheKey);
    }
    this.noteReadTotal.inc({ source: 'postgres' });
    const content = this.encryptionService.decrypt(updated.content);
    return { success: true, content };
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
    const passwordHash =
      dto.password && dto.password.trim() !== ''
        ? await this.passwordService.hash(dto.password)
        : undefined;

    const data: Prisma.SecureNoteCreateInput = {
      slug: generateSlug(),
      content: this.encryptionService.encrypt(dto.content),
      passwordHash: passwordHash ?? undefined,
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
