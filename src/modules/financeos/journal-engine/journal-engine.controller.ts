import { Body, Controller, Get, Post } from '@nestjs/common';
import { JournalEngineService } from './journal-engine.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('journal-engine')
export class JournalEngineController {
  constructor(
    private readonly journalEngineService: JournalEngineService,
  ) {}

  @Post('create')
  create(@Body() data: CreateJournalEntryDto) {
    return this.journalEngineService.create(data);
  }

  @Get()
  findAll() {
    return this.journalEngineService.findAll();
  }
}
