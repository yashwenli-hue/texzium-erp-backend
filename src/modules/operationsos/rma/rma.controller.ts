import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RmaService } from './rma.service';
import { CreateRmaDto } from './dto/create-rma.dto';

@Controller('rma')
export class RmaController {
  constructor(private readonly rmaService: RmaService) {}

  @Post()
  create(@Body() body: CreateRmaDto) {
    return this.rmaService.create(body);
  }

  @Patch(':id/approve')
  approve(
    @Param('id') id: string,
    @Body()
    body: {
      inspectionNotes: string;
      replacementType: string;
    },
  ) {
    return this.rmaService.approve(
      id,
      body.inspectionNotes,
      body.replacementType,
    );
  }

  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: { inspectionNotes: string },
  ) {
    return this.rmaService.reject(id, body.inspectionNotes);
  }

  @Get()
  findAll() {
    return this.rmaService.findAll();
  }
}
