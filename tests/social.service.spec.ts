import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SocialService } from '../src/social/social.service';

function makePrisma(overrides: any = {}) {
  return {
    publicProfile: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ ...data, createdAt: new Date() })),
      update: jest.fn(async ({ data }: any) => ({ handle: 'x', bio: null, avatarCosmeticId: null, ...data })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
      ...overrides.publicProfile,
    },
    sharedConversation: {
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ id: 'blob-1', createdAt: new Date(), ...data })),
      findUnique: jest.fn(async () => null),
      delete: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      ...overrides.sharedConversation,
    },
  } as any;
}

describe('SocialService — profile', () => {
  it('rejects invalid handle', async () => {
    const svc = new SocialService(makePrisma());
    await expect(svc.upsertProfile('u1', { handle: 'A' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertProfile('u1', { handle: '_bad' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects bio > 280 chars', async () => {
    const svc = new SocialService(makePrisma());
    await expect(svc.upsertProfile('u1', { handle: 'okk', bio: 'x'.repeat(281) }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects avatar cosmetic not in static catalog', async () => {
    const svc = new SocialService(makePrisma());
    await expect(svc.upsertProfile('u1', { handle: 'okk', avatarCosmeticId: 'ghost-skin' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts whitelisted avatar cosmetic', async () => {
    const svc = new SocialService(makePrisma());
    const r = await svc.upsertProfile('u1', { handle: 'okk', avatarCosmeticId: 'panda' });
    expect(r.handle).toBe('okk');
  });

  it('allows monkey default avatar', async () => {
    const svc = new SocialService(makePrisma());
    const r = await svc.upsertProfile('u1', { handle: 'okk', avatarCosmeticId: 'monkey' });
    expect(r.handle).toBe('okk');
  });

  it('maps P2002 handle conflict to ConflictException (409)', async () => {
    const prisma = makePrisma({
      publicProfile: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => { const e: any = new Error('unique'); e.code = 'P2002'; throw e; }),
      },
    });
    const svc = new SocialService(prisma);
    await expect(svc.upsertProfile('u1', { handle: 'taken' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('first profile creation requires handle', async () => {
    const svc = new SocialService(makePrisma());
    await expect(svc.upsertProfile('u1', { bio: 'hi' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getProfileByHandle 404 on unknown / invalid handle', async () => {
    const svc = new SocialService(makePrisma());
    await expect(svc.getProfileByHandle('UPPER')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getProfileByHandle('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SocialService — shared conversations', () => {
  it('rejects empty blob', async () => {
    const svc = new SocialService(makePrisma());
    await expect(svc.createSharedConversation('u1', Buffer.alloc(0)))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects blob > 4 MiB', async () => {
    const svc = new SocialService(makePrisma());
    const big = Buffer.alloc(4 * 1024 * 1024 + 1);
    await expect(svc.createSharedConversation('u1', big))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces per-user quota', async () => {
    const prisma = makePrisma({
      sharedConversation: { count: jest.fn(async () => 100), create: jest.fn() },
    });
    const svc = new SocialService(prisma);
    await expect(svc.createSharedConversation('u1', Buffer.from('hello')))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.sharedConversation.create).not.toHaveBeenCalled();
  });

  it('creates blob under quota', async () => {
    const prisma = makePrisma();
    const svc = new SocialService(prisma);
    const r = await svc.createSharedConversation('u1', Buffer.from('hello'));
    expect(r.id).toBe('blob-1');
    expect(prisma.sharedConversation.create).toHaveBeenCalled();
  });

  it('delete refuses non-owner', async () => {
    const prisma = makePrisma({
      sharedConversation: { findUnique: jest.fn(async () => ({ id: 'b', ownerId: 'other' })) },
    });
    const svc = new SocialService(prisma);
    await expect(svc.deleteSharedConversation('u1', 'b'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('purge deletes blobs older than TTL', async () => {
    const deleteMany = jest.fn(async () => ({ count: 7 }));
    const prisma = makePrisma({ sharedConversation: { deleteMany } });
    const svc = new SocialService(prisma);
    await svc.purgeExpiredBlobs();
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const args = (deleteMany.mock.calls as any[][])[0][0];
    expect(args.where.createdAt.lt).toBeInstanceOf(Date);
  });
});
