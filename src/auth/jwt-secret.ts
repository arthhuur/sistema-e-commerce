/**
 * De onde vem o segredo que assina os tokens.
 *
 * Mora num arquivo próprio (e não dentro do AuthModule) porque mais de um
 * lugar precisa dele: o módulo, para configurar o JwtModule, e a cifra do
 * segredo do TOTP, que deriva a chave de criptografia a partir daqui. Se
 * ficasse no AuthModule, a cifra importaria o módulo que importa a cifra —
 * um ciclo que o TypeScript resolve mal.
 */

/**
 * Ambientes em que é aceitável usar o segredo de desenvolvimento.
 *
 * A lista é de PERMISSÃO, não de proibição, e isso é o ponto: qualquer
 * ambiente que não esteja explicitamente aqui precisa de um segredo real.
 * Escrito ao contrário ("libero tudo menos produção"), um servidor com a
 * variável `NODE_ENV` esquecida cairia no caso permissivo e assinaria tokens
 * com um segredo público — que está neste arquivo, à vista de todos no
 * GitHub. Com a lista de permissão, o esquecimento produz o erro seguro.
 */
const ENVIRONMENTS_ALLOWING_DEV_SECRET = ['development', 'test'];

/** Longo o bastante para não ser adivinhável. Só vale fora de produção. */
export const DEV_SECRET =
  'apenas-para-desenvolvimento-nao-use-em-producao-1234567890';

export const MINIMUM_SECRET_LENGTH = 32;

/**
 * Decide com qual segredo os tokens serão assinados.
 *
 * O SEGREDO JWT É A CHAVE DO REINO. Quem o conhece consegue assinar um token
 * dizendo "sou o gerente" — sem senha, sem nada — e a API acredita, porque a
 * assinatura confere. Não existe defesa depois disso.
 *
 * Por isso a ausência dele é um erro FATAL em ambiente que não seja
 * desenvolvimento: é melhor a aplicação não subir do que subir insegura.
 * Uma API fora do ar aparece no primeiro minuto; uma API com segredo público
 * pode passar meses sem ninguém notar.
 */
export function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (secret) {
    if (secret.length < MINIMUM_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET precisa ter ao menos ${MINIMUM_SECRET_LENGTH} caracteres. ` +
          'Gere um novo com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
      );
    }
    return secret;
  }

  const environment = process.env.NODE_ENV ?? '';

  if (ENVIRONMENTS_ALLOWING_DEV_SECRET.includes(environment)) {
    return DEV_SECRET;
  }

  throw new Error(
    'JWT_SECRET não está definido. A aplicação não vai subir sem ele fora do ambiente de desenvolvimento. ' +
      'Gere um com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
  );
}
