import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1793718698588 implements MigrationInterface {
    name = 'InitialSchema1793718698588'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "gateways" ("id" character varying(36) NOT NULL, "name" character varying NOT NULL, "displayName" character varying NOT NULL, "feePercent" double precision NOT NULL, "feeFixed" integer NOT NULL, "approvalRate" double precision NOT NULL, "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b53153080a6907017cf44cb7f58" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payments" ("id" character varying(36) NOT NULL, "amountInCents" integer NOT NULL, "currency" character varying(3) NOT NULL, "gatewayId" character varying(36) NOT NULL, "gatewayName" character varying NOT NULL, "netAmountInCents" integer NOT NULL, "totalFeeInCents" integer NOT NULL, "status" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "idempotency_records" ("key" character varying(255) NOT NULL, "requestFingerprint" character varying(64) NOT NULL, "state" character varying(20) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "response" jsonb, "statusCode" integer, CONSTRAINT "PK_f97e644e78e639ac55614cbaffe" PRIMARY KEY ("key"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "idempotency_records"`);
        await queryRunner.query(`DROP TABLE "payments"`);
        await queryRunner.query(`DROP TABLE "gateways"`);
    }

}
