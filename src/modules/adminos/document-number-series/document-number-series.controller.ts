import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { DocumentNumberSeriesService } from './document-number-series.service';
import { DocumentNumberGeneratorService } from './services/document-number-generator.service';

import { CreateDocumentNumberSeriesDto } from './dto/create-document-number-series.dto';
import { UpdateDocumentNumberSeriesDto } from './dto/update-document-number-series.dto';

@Controller('document-number-series')
export class DocumentNumberSeriesController {
  constructor(
    private readonly documentNumberSeriesService: DocumentNumberSeriesService,
    private readonly generatorService: DocumentNumberGeneratorService,
  ) {}

  @Post()
  create(@Body() body: CreateDocumentNumberSeriesDto) {
    return this.documentNumberSeriesService.create(body);
  }

  @Get()
  findAll() {
    return this.documentNumberSeriesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentNumberSeriesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateDocumentNumberSeriesDto,
  ) {
    return this.documentNumberSeriesService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentNumberSeriesService.remove(id);
  }

  @Post('generate')
  async generate(
    @Body()
    body: {
      module: string;
      documentType: string;
    },
  ) {
    const number = await this.generatorService.generate(
      body.module,
      body.documentType,
    );

    return {
      success: true,
      documentNumber: number,
    };
  }
}
