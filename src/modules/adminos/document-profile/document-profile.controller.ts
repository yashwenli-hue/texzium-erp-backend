import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { DocumentProfileService } from './document-profile.service';
import {
  DocumentLogoDto,
  UpdateDocumentProfileDto,
} from './dto/update-document-profile.dto';

// What the company prints on its business documents. Reading and changing it
// both need documents.profile.manage (bank details are on it).
@Controller('document-profile')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentProfileController {
  constructor(private readonly service: DocumentProfileService) {}

  @Get()
  @Permissions('documents.profile.manage')
  get() {
    return this.service.get();
  }

  @Put()
  @Permissions('documents.profile.manage')
  update(
    @Body() body: UpdateDocumentProfileDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.service.update(body, req.user?.id);
  }

  @Put('logo')
  @Permissions('documents.profile.manage')
  setLogo(
    @Body() body: DocumentLogoDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.service.setLogo(body, req.user?.id);
  }

  @Delete('logo')
  @Permissions('documents.profile.manage')
  removeLogo(@Req() req: { user?: { id?: string } }) {
    return this.service.setLogo(null, req.user?.id);
  }
}
