import { Injectable, Logger } from '@nestjs/common';

/**
 * Simula a integração com fornecedores de Dropshipping.
 * 
 * Em um cenário real, este serviço faria chamadas HTTP para as APIs dos
 * fornecedores parceiros para validar estoque, preço e prazo em tempo real.
 */
@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  /**
   * Valida se há estoque disponível para um produto.
   * 
   * @param productId ID do produto no fornecedor
   * @returns true se houver estoque, false caso contrário
   */
  async checkStock(productId: string): Promise<boolean> {
    this.logger.log(`Consultando estoque para o produto: ${productId}`);

    // Simulação de latência de rede (50ms - 200ms)
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 150 + 50));

    // Lógica de simulação:
    // Se o ID contiver "out-of-stock", simulamos falta de estoque.
    if (productId.includes('out-of-stock')) {
      this.logger.warn(`Produto ${productId} está sem estoque no fornecedor.`);
      return false;
    }

    return true;
  }
}
