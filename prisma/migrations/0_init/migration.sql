-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "retailPrice" DOUBLE PRECISION NOT NULL,
    "wholesalePrice" DOUBLE PRECISION NOT NULL,
    "shelfLife" INTEGER NOT NULL,
    "icon" TEXT NOT NULL,
    "dailyTarget" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeItem" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantityGrams" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stock" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isPerishable" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FifoBatch" (
    "id" TEXT NOT NULL,
    "batchCode" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "dateReceived" TEXT NOT NULL,
    "originalQty" DOUBLE PRECISION NOT NULL,
    "remainingQty" DOUBLE PRECISION NOT NULL,
    "expiryDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FifoBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionLog" (
    "id" TEXT NOT NULL,
    "batchCode" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "dateProduced" TEXT NOT NULL,
    "expiryDate" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "B2bPartner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "terms" INTEGER NOT NULL,
    "limit" DOUBLE PRECISION NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "B2bPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "customerType" TEXT NOT NULL,
    "partnerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "date" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "grandTotal" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "outstanding" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "retailPrice" DOUBLE PRECISION NOT NULL,
    "wholesalePrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialLog" (
    "id" TEXT NOT NULL,
    "txnCode" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "isAudit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "passkey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "defaultVAT" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "defaultCreditLimit" DOUBLE PRECISION NOT NULL DEFAULT 100000,
    "autoPrintReceipt" BOOLEAN NOT NULL DEFAULT false,
    "bakeryName" TEXT NOT NULL DEFAULT 'Blissburn Products Co.',
    "bakeryAddress" TEXT NOT NULL DEFAULT 'Industrial Estate, Zone B, Colombo, Sri Lanka',
    "bakeryPhone" TEXT NOT NULL DEFAULT '+94 11 2345 678',
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsProvider" TEXT NOT NULL DEFAULT 'textlk',
    "smsApiToken" TEXT,
    "smsSenderId" TEXT,
    "smsUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_key" ON "Product"("name");

-- CreateIndex
CREATE INDEX "RecipeItem_productId_idx" ON "RecipeItem"("productId");

-- CreateIndex
CREATE INDEX "RecipeItem_ingredientId_idx" ON "RecipeItem"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeItem_productId_ingredientId_key" ON "RecipeItem"("productId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_code_key" ON "Ingredient"("code");

-- CreateIndex
CREATE INDEX "Ingredient_code_idx" ON "Ingredient"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FifoBatch_batchCode_key" ON "FifoBatch"("batchCode");

-- CreateIndex
CREATE INDEX "FifoBatch_ingredientId_idx" ON "FifoBatch"("ingredientId");

-- CreateIndex
CREATE INDEX "FifoBatch_batchCode_idx" ON "FifoBatch"("batchCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionLog_batchCode_key" ON "ProductionLog"("batchCode");

-- CreateIndex
CREATE INDEX "ProductionLog_productId_idx" ON "ProductionLog"("productId");

-- CreateIndex
CREATE INDEX "ProductionLog_batchCode_idx" ON "ProductionLog"("batchCode");

-- CreateIndex
CREATE INDEX "ProductionLog_dateProduced_idx" ON "ProductionLog"("dateProduced");

-- CreateIndex
CREATE UNIQUE INDEX "B2bPartner_name_key" ON "B2bPartner"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE INDEX "Invoice_partnerId_idx" ON "Invoice"("partnerId");

-- CreateIndex
CREATE INDEX "Invoice_invoiceNo_idx" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE INDEX "Invoice_date_idx" ON "Invoice"("date");

-- CreateIndex
CREATE INDEX "Invoice_customerType_status_idx" ON "Invoice"("customerType", "status");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialLog_txnCode_key" ON "FinancialLog"("txnCode");

-- CreateIndex
CREATE INDEX "FinancialLog_txnCode_idx" ON "FinancialLog"("txnCode");

-- CreateIndex
CREATE INDEX "FinancialLog_date_idx" ON "FinancialLog"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_username_key" ON "Staff"("username");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FifoBatch" ADD CONSTRAINT "FifoBatch_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLog" ADD CONSTRAINT "ProductionLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "B2bPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

