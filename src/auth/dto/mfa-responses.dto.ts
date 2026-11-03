import { ApiProperty } from '@nestjs/swagger';

/**
 * As respostas do segundo fator.
 *
 * Estão juntas num arquivo porque são todas pequenas e do mesmo assunto —
 * separar cada uma em quatro arquivos daria mais arquivos que conteúdo. O DTO
 * de ENTRADA (`MfaCodeDto`) ficou de fora: entrada e saída mudam por motivos
 * diferentes e é bom que dê para ver cada uma sozinha.
 */

/**
 * O que a API devolve quando a senha confere mas falta o segundo fator.
 *
 * Repare no QUE NÃO ESTÁ AQUI: o token intermediário. Ele sai apenas como
 * cookie `httpOnly`, como os da sessão. O `mfaRequired` existe para o front
 * saber que a resposta NÃO é um erro e que deve mostrar a tela do código —
 * sem ele, `200` com um corpo sem `email` seria ambíguo.
 */
export class MfaChallengeDto {
  @ApiProperty({
    description:
      'A senha conferiu, mas a conta exige o segundo fator. Peça o código e chame POST /auth/mfa/verify.',
    example: true,
  })
  mfaRequired: boolean;
}

export class MfaSetupResponseDto {
  @ApiProperty({
    description: 'URL otpauth:// que o aplicativo autenticador entende.',
    example:
      'otpauth://totp/Payment%20Router:gerente@loja.com?secret=JBSWY3DPEHPK3PXP&issuer=Payment%20Router',
  })
  otpauthUrl: string;

  @ApiProperty({
    description:
      'O mesmo conteúdo em QR Code, como data URL pronta para um <img src>.',
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...',
  })
  qrDataUrl: string;
}

export class MfaRecoveryCodesResponseDto {
  @ApiProperty({
    description:
      'Códigos de recuperação, mostrados UMA única vez. Guarde-os fora do celular: são a saída se o aparelho for perdido.',
    type: [String],
    example: ['A2C4E-6G8J2', 'K3M5P-7R9T2'],
  })
  recoveryCodes: string[];
}

export class MfaStatusResponseDto {
  @ApiProperty({
    description: 'O login já exige o código do aplicativo.',
    example: true,
  })
  enabled: boolean;

  @ApiProperty({
    description:
      'A configuração começou (o QR Code foi gerado) mas ainda não foi confirmada com um código.',
    example: false,
  })
  pending: boolean;
}
