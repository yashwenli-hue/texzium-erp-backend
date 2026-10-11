import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import {
  assertRegistrablePath,
  contentTypeFor,
  DOCUMENT_UPLOADS_ROOT,
  openStoredDocument,
  safeDownloadName,
} from './document-storage';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';

// What a document listing shows. The stored filePath is a server path and never
// leaves the API.
const DOCUMENT_LIST_SELECT = {
  id: true,
  documentName: true,
  documentType: true,
  moduleName: true,
  referenceId: true,
  status: true,
  remarks: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentSelect;

@Injectable()
export class DocumentService {
  constructor(
    private prisma: PrismaService,
    @Inject(DOCUMENT_UPLOADS_ROOT) private readonly uploadsRoot: string,
  ) {}

  // Internal only (e.g. commissioning certificates): there is no HTTP route that
  // registers a document, and the file must be inside the uploads directory.
  async create(data: {
    documentName: string;
    documentType: string;
    moduleName: string;
    referenceId: string;
    filePath: string;
    remarks?: string;
  }) {
    await assertRegistrablePath(this.uploadsRoot, data.filePath);

    return this.prisma.document.create({
      data,
      select: DOCUMENT_LIST_SELECT,
    });
  }

  async findAll(filter: ListDocumentsQueryDto = {}) {
    return this.prisma.document.findMany({
      where: {
        moduleName: filter.moduleName,
        referenceId: filter.referenceId,
      },
      select: DOCUMENT_LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  // The file of one document, opened and checked (see openStoredDocument). A missing
  // document and a file that is missing, not a plain file or outside the uploads
  // directory are all 404, and the stored path is never part of the answer.
  async openForDownload(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      select: { filePath: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found.');
    }

    const opened = await openStoredDocument(
      this.uploadsRoot,
      document.filePath,
    );

    if (!opened) {
      throw new NotFoundException(
        'The file for this document is not available.',
      );
    }

    return {
      stream: opened.handle.createReadStream({ autoClose: true }),
      size: opened.size,
      fileName: safeDownloadName(opened.fileName),
      contentType: contentTypeFor(opened.fileName),
    };
  }
}
