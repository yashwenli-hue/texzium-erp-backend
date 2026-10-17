import { Body, Controller, Get, Post } from '@nestjs/common';
import { JournalService } from './journal.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('journal')
export class JournalController {
  constructor(
    private readonly journalService: JournalService,
  ) {}

  @Post()
  create(@Body() body: CreateJournalDto) {
    return this.journalService.create(body);
  }

  @Get()
  findAll() {
    return this.journalService.findAll();
  }
}
