import { Body, Controller, Post } from '@nestjs/common';
import { DebitNotesService } from './debit-notes.service';
import { CreateDebitNoteDto } from './dto/create-debit-note.dto';

@Controller('debit-notes')
export class DebitNotesController {
  constructor(
    private readonly debitNotesService: DebitNotesService,
  ) {}

  @Post('generate')
  generate(@Body() data: CreateDebitNoteDto) {
    return this.debitNotesService.generate(data);
  }
}
