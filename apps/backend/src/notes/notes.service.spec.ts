import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { EncryptionService } from '../encryption/encryption.service';
import { PasswordService } from '../password/password.service';

jest.mock('../password/password.service', () => ({
  PasswordService: jest.fn().mockImplementation(() => ({
    hash: jest.fn().mockResolvedValue('hashedpassword'),
    compare: jest.fn().mockResolvedValue(true),
  })),
}));
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getToken } from '@willsoto/nestjs-prometheus';
import { NotesService } from './notes.service';
import type { CreateNoteDto } from './dto/create-note.dto';

describe('NotesService', () => {
  let service: NotesService;
  let prisma: PrismaService;
  let encryptionService: EncryptionService;

  const mockRedis = {
    isEnabled: false,
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    checkRateLimit: jest.fn(),
    isWrongPasswordLimitExceeded: jest.fn().mockResolvedValue(false),
    recordWrongPasswordAttempt: jest.fn(),
  };

  const mockPasswordService = {
    hash: jest.fn().mockResolvedValue('hashedpassword'),
    compare: jest.fn().mockResolvedValue(true),
  };

  const mockNoteReadTotal = { inc: jest.fn() };
  const mockNoteCreateTotal = { inc: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis.isEnabled = false;
    mockRedis.isWrongPasswordLimitExceeded.mockResolvedValue(false);
    mockRedis.recordWrongPasswordAttempt.mockResolvedValue(undefined);
    mockPasswordService.compare.mockResolvedValue(true);
    mockPasswordService.hash.mockResolvedValue('hashedpassword');
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        EncryptionService,
        {
          provide: PrismaService,
          useValue: {
            secureNote: {
              create: jest.fn(),
              update: jest.fn(),
              findFirst: jest.fn(),
            },
            $queryRaw: jest.fn(),
          },
        },
        { provide: RedisService, useValue: mockRedis },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: getToken('note_read_total'), useValue: mockNoteReadTotal },
        { provide: getToken('note_create_total'), useValue: mockNoteCreateTotal },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
    prisma = module.get<PrismaService>(PrismaService);
    encryptionService = module.get<EncryptionService>(EncryptionService);
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  describe('create', () => {
    const dto: CreateNoteDto = {
      content: 'secret message',
    };

    const createdNote = {
      id: 'id-1',
      slug: 'abc123base64url',
      content: '', // set by mock from encrypted payload
      passwordHash: null,
      expiresAt: null,
      lastViewedAt: null,
      maxViews: null,
      viewCount: 0,
      isDeleted: false,
      createdAt: new Date(),
      createdBy: null,
      userId: null,
    };

    it('creates a note with encrypted content and returns it with a generated slug', async () => {
      (prisma.secureNote.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...createdNote, ...data, content: data.content }),
      );

      const result = await service.create(dto);

      expect(prisma.secureNote.create).toHaveBeenCalledTimes(1);
      const call = (prisma.secureNote.create as jest.Mock).mock.calls[0][0];
      expect(call.data.content).not.toBe(dto.content);
      expect(call.data.content).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(encryptionService.decrypt(result.content)).toBe(dto.content);
      expect(call.data.slug).toBeDefined();
      expect(call.data.passwordHash).toBeUndefined();
      expect(mockPasswordService.hash).not.toHaveBeenCalled();
      expect(typeof call.data.slug).toBe('string');
      expect(call.data.slug.length).toBeGreaterThan(0);
      expect(call.data.expiresAt).toBeUndefined();
      expect(call.data.maxViews).toBeUndefined();
      expect(mockNoteCreateTotal.inc).toHaveBeenCalledTimes(1);
    });

    it('hashes and stores password when provided', async () => {
      const dtoWithPassword: CreateNoteDto = {
        content: 'content',
        password: 'MyPass1!',
      };
      (prisma.secureNote.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...createdNote, ...data, content: data.content }),
      );

      await service.create(dtoWithPassword);

      expect(mockPasswordService.hash).toHaveBeenCalledWith('MyPass1!');
      const call = (prisma.secureNote.create as jest.Mock).mock.calls[0][0];
      expect(call.data.passwordHash).toBe('hashedpassword');
    });

    it('passes expiresAt and maxViews when provided', async () => {
      const dtoWithOpts: CreateNoteDto = {
        content: 'content',
        expiresAt: '2030-01-01T00:00:00.000Z',
        maxViews: 5,
      };
      (prisma.secureNote.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...createdNote, ...data, content: data.content }),
      );

      await service.create(dtoWithOpts);

      const call = (prisma.secureNote.create as jest.Mock).mock.calls[0][0];
      expect(call.data.expiresAt).toEqual(new Date(dtoWithOpts.expiresAt!));
      expect(call.data.maxViews).toBe(5);
      expect(call.data.content).not.toBe(dtoWithOpts.content);
    });

    it('retries with new slug on unique constraint violation (P2002)', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'x',
      });
      (prisma.secureNote.create as jest.Mock)
        .mockRejectedValueOnce(err)
        .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...createdNote, ...data, content: data.content }),
        );

      const result = await service.create(dto);

      expect(encryptionService.decrypt(result.content)).toBe(dto.content);
      expect(prisma.secureNote.create).toHaveBeenCalledTimes(2);
      expect(mockNoteCreateTotal.inc).toHaveBeenCalledTimes(1);
    });

    it('rethrows non-P2002 errors', async () => {
      const err = new Error('DB connection failed');
      (prisma.secureNote.create as jest.Mock).mockRejectedValue(err);

      await expect(service.create(dto)).rejects.toThrow('DB connection failed');
      expect(prisma.secureNote.create).toHaveBeenCalledTimes(1);
      expect(mockNoteCreateTotal.inc).not.toHaveBeenCalled();
    });
  });

  describe('readBySlug', () => {
    it('returns note with decrypted content when read from DB', async () => {
      const plainContent = 'secret from db';
      const encryptedContent = encryptionService.encrypt(plainContent);
      const dbNote = {
        id: 'id-1',
        slug: 'the-slug',
        content: encryptedContent,
        passwordHash: null,
        expiresAt: null,
        lastViewedAt: null,
        maxViews: null,
        viewCount: 0,
        isDeleted: false,
        createdAt: new Date(),
        createdBy: null,
        userId: null,
      };
      (prisma.secureNote.findFirst as jest.Mock).mockResolvedValue(dbNote);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ ...dbNote, viewCount: 1 }]);

      const result = await service.readBySlug('the-slug');

      expect(result).not.toBeNull();
      expect(result).toEqual({ success: true, content: plainContent });
      expect(mockNoteReadTotal.inc).toHaveBeenCalledWith({ source: 'postgres' });
    });

    it('returns note with decrypted content when read from Redis cache', async () => {
      const plainContent = 'secret from cache';
      const encryptedContent = encryptionService.encrypt(plainContent);
      const cachedNote = {
        id: 'id-1',
        slug: 'cached-slug',
        content: encryptedContent,
        passwordHash: null,
        expiresAt: null,
        lastViewedAt: null,
        maxViews: 2,
        viewCount: 1,
        isDeleted: false,
        createdAt: new Date(),
        createdBy: null,
        userId: null,
      };
      mockRedis.isEnabled = true;
      (mockRedis.get as jest.Mock).mockResolvedValue(cachedNote);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: 'id-1', viewCount: 2, maxViews: 2 }]);

      const result = await service.readBySlug('cached-slug');

      expect(result).not.toBeNull();
      expect(result).toEqual({ success: true, content: plainContent });
      expect(mockNoteReadTotal.inc).toHaveBeenCalledWith({ source: 'redis' });
    });

    it('returns PASSWORD_REQUIRED when note has password and none provided', async () => {
      const encryptedContent = encryptionService.encrypt('secret');
      const dbNote = {
        id: 'id-1',
        slug: 'protected-slug',
        content: encryptedContent,
        passwordHash: 'hashed',
        expiresAt: null,
        lastViewedAt: null,
        maxViews: null,
        viewCount: 0,
        isDeleted: false,
        createdAt: new Date(),
        createdBy: null,
        userId: null,
      };
      (prisma.secureNote.findFirst as jest.Mock).mockResolvedValue(dbNote);

      const result = await service.readBySlug('protected-slug');

      expect(result).toEqual({ success: false, code: 'PASSWORD_REQUIRED' });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns INVALID_PASSWORD when password is wrong', async () => {
      const encryptedContent = encryptionService.encrypt('secret');
      const dbNote = {
        id: 'id-1',
        slug: 'protected-slug',
        content: encryptedContent,
        passwordHash: 'hashed',
        expiresAt: null,
        lastViewedAt: null,
        maxViews: null,
        viewCount: 0,
        isDeleted: false,
        createdAt: new Date(),
        createdBy: null,
        userId: null,
      };
      (prisma.secureNote.findFirst as jest.Mock).mockResolvedValue(dbNote);
      mockPasswordService.compare.mockResolvedValueOnce(false);

      const result = await service.readBySlug('protected-slug', 'wrong');

      expect(result).toEqual({ success: false, code: 'INVALID_PASSWORD' });
      expect(mockRedis.recordWrongPasswordAttempt).toHaveBeenCalledWith('protected-slug');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns content when password is correct', async () => {
      const plainContent = 'secret';
      const encryptedContent = encryptionService.encrypt(plainContent);
      const dbNote = {
        id: 'id-1',
        slug: 'protected-slug',
        content: encryptedContent,
        passwordHash: 'hashed',
        expiresAt: null,
        lastViewedAt: null,
        maxViews: null,
        viewCount: 0,
        isDeleted: false,
        createdAt: new Date(),
        createdBy: null,
        userId: null,
      };
      (prisma.secureNote.findFirst as jest.Mock).mockResolvedValue(dbNote);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ ...dbNote, viewCount: 1 }]);

      const result = await service.readBySlug('protected-slug', 'correct');

      expect(result).toEqual({ success: true, content: plainContent });
      expect(mockPasswordService.compare).toHaveBeenCalledWith('correct', 'hashed');
    });
  });
});
