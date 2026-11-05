import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/decorators/public.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Rota de boas-vindas: serve para confirmar que a API respondeu, e é a
  // primeira coisa que alguém testa ao abrir o endereço. Não expõe dado
  // nenhum, então fica aberta de propósito.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
