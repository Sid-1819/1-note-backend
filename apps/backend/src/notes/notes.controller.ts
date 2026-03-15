import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  ForbiddenException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { CreateNoteDto } from './dto/create-note.dto';
import { RateLimitGuard } from '../redis/rate-limit.guard';
import { NotesService } from './notes.service';

const NOTE_PASSWORD_HEADER = 'x-note-password';

@Controller('s')
@UseGuards(RateLimitGuard)
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createNote(@Body() dto: CreateNoteDto) {
    const note = await this.notesService.create(dto);
    return { slug: note.slug };
  }

  @Get(':slug')
  async readNote(
    @Param('slug') slug: string,
    @Headers(NOTE_PASSWORD_HEADER) password?: string,
  ) {
    const result = await this.notesService.readBySlug(slug, password?.trim() || undefined);

    if (result === null) {
      throw new NotFoundException();
    }

    if (!result.success) {
      if (result.code === 'WRONG_PASSWORD_LIMIT') {
        throw new HttpException(
          {
            code: result.code,
            message: 'Too many wrong passphrase attempts. Try again in 15 minutes.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new ForbiddenException({
        code: result.code,
        message:
          result.code === 'PASSWORD_REQUIRED'
            ? 'This note is protected. Provide the passphrase in the X-Note-Password header.'
            : 'Invalid passphrase.',
      });
    }

    return { content: result.content };
  }
}
