import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductIdToPayments1793718980994 implements MigrationInterface {
    name = 'AddProductIdToPayments1793718980994'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" ADD "productId" character varying NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "productId"`);
    }

}
