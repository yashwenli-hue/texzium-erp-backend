import { Body, Controller, Post } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('credit-notes')
export class CreditNotesController {
  constructor(
    private readonly creditNotesService: CreditNotesService,
  ) {}

  @Post('generate')
  generate(@Body() data: CreateCreditNoteDto) {
    return this.creditNotesService.generate(data);
  }
}
