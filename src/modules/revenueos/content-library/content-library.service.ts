import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../core/database/prisma.service';
import { USER_REFERENCE_SELECT } from '../../../core/security/user-select';
import {
  ContentAccessUnavailable,
  ContentDisposition,
  signContentAccess,
} from './content-access';
import { ContentStorage } from './content-storage';
import { ContentUploadsService } from './content-uploads.service';
import { CONTENT_TYPES, ContentKind, displayName } from './content-types';
import {
  CONTENT_TAG_MAX,
  CONTENT_TAGS_MAX,
  CreateContentAssetDto,
  ListContentAssetsQueryDto,
  UpdateContentAssetDto,
} from './dto/content-asset.dto';

type Db = PrismaService | Prisma.TransactionClient;
type UploadedTemp = { path: string; originalname: string };

export const CONTENT_ASSET_NOT_FOUND = 'Content not found.';
export const CONTENT_ARCHIVED_MESSAGE =
  'This content is archived. Restore it first.';

const FILE_SELECT = {
  id: true,
  version: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  metadataRemoved: true,
  uploadedById: true,
  createdAt: true,
} satisfies Prisma.ContentFileSelect;

type FileRow = Prisma.ContentFileGetPayload<{ select: typeof FILE_SELECT }>;
type AssetRow = Prisma.ContentAssetGetPayload<{
  include: { files: { select: typeof FILE_SELECT } };
}>;

// Tags: trimmed, lower-case, no duplicates, at most 20 of at most 40 characters.
export function normaliseTags(tags: string[] | string | undefined): string[] {
  const list = typeof tags === 'string' ? tags.split(',') : (tags ?? []);
  const out: string[] = [];
  for (const raw of list) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!tag) continue;
    if (tag.length > CONTENT_TAG_MAX) {
      throw new BadRequestException(
        `A tag can be at most ${CONTENT_TAG_MAX} characters.`,
      );
    }
    if (!out.includes(tag)) out.push(tag);
  }
  if (out.length > CONTENT_TAGS_MAX) {
    throw new BadRequestException(`At most ${CONTENT_TAGS_MAX} tags.`);
  }
  return out;
}

// A name for a downloaded file: from the title, ASCII letters, digits, dot, dash and
// underscore only, with the version and the stored type's extension.
export function downloadName(title: string, version: number, mimeType: string) {
  const ext =
    Object.values(CONTENT_TYPES).find((t) => t.mimeType === mimeType)
      ?.extension ?? 'bin';
  const base =
    title
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80) || 'content';
  return `${base}-v${version}.${ext}`;
}

@Injectable()
export class ContentLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ContentStorage,
    private readonly uploads: ContentUploadsService,
  ) {}

  // The file to ingest: the multipart file, or a finished piecewise upload of this user.
  private async fileFrom(
    file: UploadedTemp | undefined,
    uploadId: string | undefined,
    actorId: string | undefined,
  ): Promise<UploadedTemp> {
    if (file && uploadId) {
      throw new BadRequestException(
        'Send either a file or an upload id, not both.',
      );
    }
    if (file) return file;
    if (uploadId) return this.uploads.take(uploadId, actorId);
    throw new BadRequestException('Choose a file to upload.');
  }

  async list(query: ListContentAssetsQueryDto) {
    const where: Prisma.ContentAssetWhereInput = {};
    const status = query.status ?? 'ACTIVE';
    if (status !== 'ALL') where.status = status;
    if (query.kind) where.kind = query.kind;
    if (query.inventoryItemId) where.inventoryItemId = query.inventoryItemId;
    if (query.category) {
      const items = await this.prisma.inventoryItem.findMany({
        where: { category: { equals: query.category, mode: 'insensitive' } },
        select: { id: true },
      });
      where.AND = [{ inventoryItemId: { in: items.map((i) => i.id) } }];
    }
    if (query.tag) where.tags = { has: query.tag.toLowerCase() };
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
        { tags: { has: query.q.toLowerCase() } },
      ];
    }
    const assets = await this.prisma.contentAsset.findMany({
      where,
      include: {
        files: { select: FILE_SELECT, orderBy: { version: 'desc' }, take: 1 },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 500,
    });
    const versions = await this.prisma.contentFile.groupBy({
      by: ['assetId'],
      where: { assetId: { in: assets.map((a) => a.id) } },
      _count: { _all: true },
    });
    const shares = await this.prisma.contentShare.groupBy({
      by: ['assetId'],
      where: { assetId: { in: assets.map((a) => a.id) } },
      _count: { _all: true },
    });
    const count = (
      rows: Array<{ assetId: string; _count: { _all: number } }>,
      id: string,
    ) => rows.find((r) => r.assetId === id)?._count._all ?? 0;
    const refs = await this.references(
      assets,
      assets.flatMap((a) => a.files),
    );
    return assets.map((asset) =>
      this.view(asset, refs, {
        versionCount: count(versions, asset.id),
        shareCount: count(shares, asset.id),
      }),
    );
  }

  async get(id: string) {
    const asset = await this.prisma.contentAsset.findUnique({
      where: { id },
      include: { files: { select: FILE_SELECT, orderBy: { version: 'desc' } } },
    });
    if (!asset) throw new NotFoundException(CONTENT_ASSET_NOT_FOUND);
    const shareCount = await this.prisma.contentShare.count({
      where: { assetId: id },
    });
    const refs = await this.references([asset], asset.files);
    return {
      ...this.view(asset, refs, {
        versionCount: asset.files.length,
        shareCount,
      }),
      versions: asset.files.map((file) => this.fileView(file, refs.users)),
    };
  }

  async create(
    body: CreateContentAssetDto,
    upload: UploadedTemp | undefined,
    actorId?: string,
  ) {
    const tags = normaliseTags(body.tags);
    await this.assertInventoryItem(this.prisma, body.inventoryItemId);
    const file = await this.fileFrom(upload, body.uploadId, actorId);
    const stored = await this.storage.ingest(
      file.path,
      file.originalname,
      body.kind,
    );
    try {
      const asset = await this.prisma.$transaction(async (tx) => {
        const created = await tx.contentAsset.create({
          data: {
            title: body.title,
            description: body.description || null,
            kind: body.kind,
            tags,
            inventoryItemId: body.inventoryItemId ?? null,
            createdById: actorId ?? null,
            updatedById: actorId ?? null,
          },
        });
        await tx.contentFile.create({
          data: {
            assetId: created.id,
            version: 1,
            storageKey: stored.storageKey,
            originalName: displayName(file.originalname),
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            width: stored.width,
            height: stored.height,
            metadataRemoved: stored.metadataRemoved,
            uploadedById: actorId ?? null,
          },
        });
        return created;
      });
      return this.get(asset.id);
    } catch (error) {
      await this.storage.discard(stored.storageKey);
      throw error;
    }
  }

  async addVersion(
    id: string,
    upload: UploadedTemp | undefined,
    actorId?: string,
    uploadId?: string,
  ) {
    const asset = await this.prisma.contentAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException(CONTENT_ASSET_NOT_FOUND);
    if (asset.status !== 'ACTIVE')
      throw new ConflictException(CONTENT_ARCHIVED_MESSAGE);
    const file = await this.fileFrom(upload, uploadId, actorId);
    const stored = await this.storage.ingest(
      file.path,
      file.originalname,
      asset.kind as ContentKind,
    );
    try {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockAsset(tx, id);
        if (locked.status !== 'ACTIVE')
          throw new ConflictException(CONTENT_ARCHIVED_MESSAGE);
        const last = await tx.contentFile.aggregate({
          where: { assetId: id },
          _max: { version: true },
        });
        await tx.contentFile.create({
          data: {
            assetId: id,
            version: (last._max.version ?? 0) + 1,
            storageKey: stored.storageKey,
            originalName: displayName(file.originalname),
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            width: stored.width,
            height: stored.height,
            metadataRemoved: stored.metadataRemoved,
            uploadedById: actorId ?? null,
          },
        });
        await tx.contentAsset.update({
          where: { id },
          data: { updatedById: actorId ?? null, updatedAt: new Date() },
        });
      });
    } catch (error) {
      await this.storage.discard(stored.storageKey);
      throw error;
    }
    return this.get(id);
  }

  async update(id: string, body: UpdateContentAssetDto, actorId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const asset = await this.lockAsset(tx, id);
      if (asset.status !== 'ACTIVE')
        throw new ConflictException(CONTENT_ARCHIVED_MESSAGE);
      await this.assertInventoryItem(tx, body.inventoryItemId ?? undefined);
      const data: Prisma.ContentAssetUncheckedUpdateInput = {
        updatedById: actorId ?? null,
      };
      if (body.title !== undefined) data.title = body.title;
      if (body.description !== undefined)
        data.description = body.description || null;
      if (body.tags !== undefined) data.tags = normaliseTags(body.tags);
      if (body.inventoryItemId !== undefined)
        data.inventoryItemId = body.inventoryItemId;
      await tx.contentAsset.update({ where: { id }, data });
    });
    return this.get(id);
  }

  async archive(id: string, reason: string, actorId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const asset = await this.lockAsset(tx, id);
      if (asset.status === 'ARCHIVED')
        throw new ConflictException('This content is already archived.');
      await tx.contentAsset.update({
        where: { id },
        data: {
          status: 'ARCHIVED',
          archivedAt: new Date(),
          archivedById: actorId ?? null,
          archiveReason: reason,
          updatedById: actorId ?? null,
        },
      });
    });
    return this.get(id);
  }

  async restore(id: string, actorId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const asset = await this.lockAsset(tx, id);
      if (asset.status === 'ACTIVE')
        throw new ConflictException('This content is not archived.');
      await tx.contentAsset.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          archivedAt: null,
          archivedById: null,
          archiveReason: null,
          updatedById: actorId ?? null,
        },
      });
    });
    return this.get(id);
  }

  // A signed, expiring URL for one version (default: the current one).
  async accessUrl(
    id: string,
    disposition: ContentDisposition,
    version?: number,
  ) {
    const asset = await this.prisma.contentAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException(CONTENT_ASSET_NOT_FOUND);
    const file = await this.prisma.contentFile.findFirst({
      where: { assetId: id, ...(version ? { version } : {}) },
      orderBy: { version: 'desc' },
      select: FILE_SELECT,
    });
    if (!file) throw new NotFoundException('That version does not exist.');
    return {
      ...this.sign(file.id, disposition),
      fileId: file.id,
      version: file.version,
      mimeType: file.mimeType,
      fileName: downloadName(asset.title, file.version, file.mimeType),
    };
  }

  sign(fileId: string, disposition: ContentDisposition) {
    try {
      return signContentAccess(fileId, disposition);
    } catch (error) {
      if (error instanceof ContentAccessUnavailable) {
        throw new ServiceUnavailableException(
          'Content access is not configured.',
        );
      }
      throw error;
    }
  }

  // The stored file behind a signed URL (the signature is checked by the caller).
  async fileForAccess(fileId: string) {
    const file = await this.prisma.contentFile.findUnique({
      where: { id: fileId },
      select: {
        storageKey: true,
        mimeType: true,
        version: true,
        asset: { select: { title: true } },
      },
    });
    if (!file) return null;
    return {
      storageKey: file.storageKey,
      mimeType: file.mimeType,
      fileName: downloadName(file.asset.title, file.version, file.mimeType),
    };
  }

  async lockAsset(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: string; kind: string; title: string }>
    >`
      SELECT "id", "status", "kind", "title" FROM "ContentAsset" WHERE "id" = ${id} FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException(CONTENT_ASSET_NOT_FOUND);
    return rows[0];
  }

  private async assertInventoryItem(
    db: Db,
    inventoryItemId: string | undefined,
  ) {
    if (!inventoryItemId) return;
    const item = await db.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { id: true },
    });
    if (!item)
      throw new BadRequestException('That inventory item does not exist.');
  }

  private async references(assets: AssetRow[], files: FileRow[]) {
    const userIds = new Set<string>();
    for (const a of assets) {
      for (const id of [a.createdById, a.updatedById, a.archivedById])
        if (id) userIds.add(id);
    }
    for (const f of files) if (f.uploadedById) userIds.add(f.uploadedById);
    const itemIds = [
      ...new Set(
        assets.map((a) => a.inventoryItemId).filter((x): x is string => !!x),
      ),
    ];
    const [users, items] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: USER_REFERENCE_SELECT,
      }),
      this.prisma.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, sku: true, productName: true, category: true },
      }),
    ]);
    return {
      users: new Map(users.map((u) => [u.id, u])),
      items: new Map(items.map((i) => [i.id, i])),
    };
  }

  private fileView(
    file: FileRow,
    users: Map<string, { id: string; fullName: string }>,
  ) {
    return {
      id: file.id,
      version: file.version,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      width: file.width,
      height: file.height,
      metadataRemoved: file.metadataRemoved,
      uploadedBy: (file.uploadedById && users.get(file.uploadedById)) || null,
      createdAt: file.createdAt,
    };
  }

  private view(
    asset: AssetRow,
    refs: Awaited<ReturnType<ContentLibraryService['references']>>,
    counts: { versionCount: number; shareCount: number },
  ) {
    const user = (id: string | null) => (id && refs.users.get(id)) || null;
    const current = asset.files[0];
    return {
      id: asset.id,
      title: asset.title,
      description: asset.description,
      kind: asset.kind,
      tags: asset.tags,
      inventoryItem:
        (asset.inventoryItemId && refs.items.get(asset.inventoryItemId)) ||
        null,
      status: asset.status,
      archivedAt: asset.archivedAt,
      archiveReason: asset.archiveReason,
      archivedBy: user(asset.archivedById),
      createdBy: user(asset.createdById),
      updatedBy: user(asset.updatedById),
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      currentVersion: current ? this.fileView(current, refs.users) : null,
      versionCount: counts.versionCount,
      shareCount: counts.shareCount,
    };
  }
}
