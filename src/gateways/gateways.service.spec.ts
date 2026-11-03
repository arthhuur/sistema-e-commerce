import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GatewaysService } from './gateways.service.js';
import { Gateway } from './gateway.entity.js';
import { CreateGatewayDto } from './dto/create-gateway.dto.js';
import { UpdateGatewayDto } from './dto/update-gateway.dto.js';
import { testDatabaseOptions, truncateAll } from '../../test/test-database.js';

/**
 * Testes do GatewaysService.
 *
 * Ainda são testes de UMA classe — sem HTTP, sem supertest. O que mudou na
 * Fase 2 é de onde o dado vem: antes o Service guardava tudo num `Map` e o
 * teste subia uma app nova a cada caso; agora ele conversa com o Postgres, e o
 * teste conecta no banco de TESTE e esvazia as tabelas entre um caso e outro.
 *
 * Repare no par `beforeAll` / `beforeEach`:
 *  - `beforeAll`: abre a conexão UMA vez (abrir conexão é caro; fazer isso a
 *    cada teste somaria segundos à suíte sem ganhar nada).
 *  - `beforeEach`: esvazia as tabelas (barato) e é o que garante o isolamento
 *    que o `Map` dava de graça.
 */
describe('GatewaysService', () => {
  let service: GatewaysService;
  let module: TestingModule;
  let dataSource: DataSource;

  /**
   * Fábrica de DTO para os testes.
   *
   * Recebe sobrescritas em vez de usarmos `{ ...dto }`: o linter (oxlint) acusa
   * spread de instância de classe, e com razão — é o mesmo cheiro do bug do
   * PATCH que corrigimos no Service.
   */
  function makeGatewayDto(
    overrides: { name?: string; active?: boolean } = {},
  ): CreateGatewayDto {
    return {
      name: overrides.name ?? 'mercado_pago',
      displayName: 'Mercado Pago',
      feePercent: 3.99,
      feeFixed: 49,
      approvalRate: 0.92,
      active: overrides.active,
    };
  }

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(testDatabaseOptions()),
        TypeOrmModule.forFeature([Gateway]),
      ],
      providers: [GatewaysService],
    }).compile();

    service = module.get<GatewaysService>(GatewaysService);
    dataSource = module.get<DataSource>(DataSource);
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  afterAll(async () => {
    // Fecha a conexão: sem isto o processo do Vitest fica com o pool aberto e
    // demora a encerrar.
    await module.close();
  });

  describe('create', () => {
    it('gera um id único', async () => {
      const gateway = await service.create(makeGatewayDto());

      expect(gateway.id).toEqual(expect.any(String));
      expect(gateway.id.length).toBeGreaterThan(0);
    });

    it('ativa o gateway quando "active" não é informado', async () => {
      const gateway = await service.create(makeGatewayDto());

      expect(gateway.active).toBe(true);
    });

    it('respeita "active: false" quando informado', async () => {
      const gateway = await service.create(makeGatewayDto({ active: false }));

      expect(gateway.active).toBe(false);
    });
  });

  describe('findAll', () => {
    it('devolve todos quando não há filtro', async () => {
      await service.create(makeGatewayDto());
      await service.create(makeGatewayDto({ name: 'pagbank', active: false }));

      expect(await service.findAll()).toHaveLength(2);
    });

    it('filtra apenas os ativos', async () => {
      await service.create(makeGatewayDto());
      await service.create(makeGatewayDto({ name: 'pagbank', active: false }));

      const ativos = await service.findAll({ active: true });

      expect(ativos).toHaveLength(1);
      expect(ativos[0].name).toBe('mercado_pago');
    });

    it('filtra apenas os inativos (o caso que o "if (active)" quebraria)', async () => {
      await service.create(makeGatewayDto());
      await service.create(makeGatewayDto({ name: 'pagbank', active: false }));

      const inativos = await service.findAll({ active: false });

      expect(inativos).toHaveLength(1);
      expect(inativos[0].name).toBe('pagbank');
    });
  });

  describe('findOne', () => {
    it('devolve o gateway existente', async () => {
      const created = await service.create(makeGatewayDto());

      expect(await service.findOne(created.id)).toEqual(created);
    });

    it('lança NotFoundException quando o id não existe', async () => {
      // Aqui usamos `rejects` em vez de `toThrow` porque a exceção não nasce
      // na hora da chamada: o Service é assíncrono, então a falha chega
      // dentro da Promise. `toThrow` na função só pegaria erro síncrono.
      await expect(service.findOne('id-inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('altera apenas o campo enviado e preserva os demais', async () => {
      const created = await service.create(makeGatewayDto());

      // Reproduzimos EXATAMENTE o que o ValidationPipe entrega na vida real:
      // uma INSTÂNCIA do DTO com todas as propriedades declaradas, sendo que
      // as não enviadas valem undefined. Foi isso que causou o bug do spread.
      const dto = Object.assign(new UpdateGatewayDto(), { feePercent: 2.5 });

      const updated = await service.update(created.id, dto);

      expect(updated.feePercent).toBe(2.5);
      // Estes asserts são a rede de proteção: se alguém voltar a usar
      // `{ ...current, ...dto }`, eles falham imediatamente.
      expect(updated.name).toBe('mercado_pago');
      expect(updated.displayName).toBe('Mercado Pago');
      expect(updated.feeFixed).toBe(49);
      expect(updated.approvalRate).toBe(0.92);
      expect(updated.active).toBe(true);
      expect(updated.id).toBe(created.id);
    });

    it('preserva createdAt e atualiza updatedAt', async () => {
      const created = await service.create(makeGatewayDto());

      const updated = await service.update(created.id, {
        displayName: 'Novo Nome',
      });

      expect(updated.createdAt).toEqual(created.createdAt);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        created.updatedAt.getTime(),
      );
    });
  });

  describe('remove', () => {
    it('remove o gateway e ele deixa de ser encontrado', async () => {
      const created = await service.create(makeGatewayDto());

      await service.remove(created.id);

      expect(await service.findAll()).toHaveLength(0);
      await expect(service.findOne(created.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lança NotFoundException ao remover id inexistente', async () => {
      await expect(service.remove('id-inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('estimateFee', () => {
    it('calcula taxa fixa + percentual em centavos', async () => {
      const created = await service.create(makeGatewayDto());

      // 10000 * 3.99 / 100 = 399 (parte percentual)
      // 49 (fixa) + 399 = 448 de taxa
      const estimate = await service.estimateFee(created.id, 10000);

      expect(estimate.feeFixedInCents).toBe(49);
      expect(estimate.feePercentInCents).toBe(399);
      expect(estimate.totalFeeInCents).toBe(448);
      expect(estimate.netAmountInCents).toBe(9552);
    });

    it('arredonda a parte percentual para o centavo mais próximo', async () => {
      const created = await service.create(makeGatewayDto());

      // 15050 * 3.99 / 100 = 600.495 -> Math.round -> 600
      const estimate = await service.estimateFee(created.id, 15050);

      expect(estimate.feePercentInCents).toBe(600);
      expect(estimate.totalFeeInCents).toBe(649);
    });

    it('lança NotFoundException para gateway inexistente', async () => {
      await expect(service.estimateFee('id-inexistente', 10000)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
