import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ServiceTicketsService } from './service-tickets.service';
import { CreateServiceTicketDto } from './dto/create-service-ticket.dto';

@Controller('service-tickets')
export class ServiceTicketsController {
  constructor(
    private readonly serviceTicketsService: ServiceTicketsService,
  ) {}

  @Post()
  create(@Body() body: CreateServiceTicketDto) {
    return this.serviceTicketsService.create(body);
  }

  @Patch(':id/close')
  closeTicket(
    @Param('id') id: string,
    @Body() body: { status: string; resolutionNotes: string },
  ) {
    return this.serviceTicketsService.closeTicket(
      id,
      body.status,
      body.resolutionNotes,
    );
  }


@Patch(':id/assign')
assignEngineer(
  @Param('id') id: string,
  @Body() body: { engineerName: string },
) {
  return this.serviceTicketsService.assignEngineer(
    id,
    body.engineerName,
  );
}

@Patch(':id/status')
updateStatus(
  @Param('id') id: string,
  @Body() body: { status: string },
) {
  return this.serviceTicketsService.updateStatus(
    id,
    body.status,
  );
}


  @Get()
  findAll() {
    return this.serviceTicketsService.findAll();
  }
}
