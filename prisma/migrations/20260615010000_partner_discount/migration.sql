-- AlterTable: per-partner extra discount off the wholesale price
ALTER TABLE "B2bPartner" ADD COLUMN     "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.0;
