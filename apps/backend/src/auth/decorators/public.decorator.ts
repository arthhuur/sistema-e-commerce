import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Libera uma rota da exigência de sessão.
 *
 * O PADRÃO DO SISTEMA É PROTEGIDO. Toda rota nova nasce exigindo login, e
 * esta marcação é o que abre uma exceção — de forma explícita e visível na
 * leitura do código.
 *
 * A escolha do padrão é a parte importante. O contrário (tudo aberto, e cada
 * rota decide se protege) tem uma falha previsível: no dia em que alguém cria
 * um endpoint novo e esquece de protegê-lo, ninguém percebe. Com o padrão
 * fechado, o esquecimento produz o erro seguro — a rota fica inacessível, o
 * teste falha, e o problema aparece antes de chegar em produção.
 *
 * Usado em: `/`, `/health`, e as rotas de login/renovação/saída.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
