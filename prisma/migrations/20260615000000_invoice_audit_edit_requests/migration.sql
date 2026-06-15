-- AlterTable: invoice creator + last-edit audit fields
ALTER TABLE "Invoice" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "createdByName" TEXT,
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT,
ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "editCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: sales-staff invoice edit requests
CREATE TABLE "InvoiceEditRequest" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedById" TEXT,
    "resolvedByName" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceEditRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceEditRequest_status_idx" ON "InvoiceEditRequest"("status");

-- CreateIndex
CREATE INDEX "InvoiceEditRequest_invoiceId_idx" ON "InvoiceEditRequest"("invoiceId");

-- AddForeignKey
ALTER TABLE "InvoiceEditRequest" ADD CONSTRAINT "InvoiceEditRequest_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
