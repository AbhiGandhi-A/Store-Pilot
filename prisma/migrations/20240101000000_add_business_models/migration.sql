-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "myshopifyDomain" TEXT NOT NULL,
    "email" TEXT,
    "currencyCode" TEXT,
    "timezone" TEXT,
    "planName" TEXT,
    "primaryLocale" TEXT,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "vendor" TEXT,
    "productType" TEXT,
    "status" TEXT,
    "tags" TEXT[],
    "publishedAt" TIMESTAMP(3),
    "templateSuffix" TEXT,
    "bodyHtml" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shopifyCreatedAt" TIMESTAMP(3),
    "shopifyUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "price" DECIMAL(19,4) NOT NULL,
    "compareAtPrice" DECIMAL(19,4),
    "inventoryItemId" TEXT,
    "inventoryPolicy" TEXT,
    "position" INTEGER,
    "weight" DECIMAL(19,4),
    "weightUnit" TEXT,
    "taxable" BOOLEAN,
    "requiresShipping" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shopifyCreatedAt" TIMESTAMP(3),
    "shopifyUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address1" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "province" TEXT,
    "provinceCode" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shopifyCreatedAt" TIMESTAMP(3),
    "shopifyUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLevel" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "variantId" TEXT,
    "available" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shopifyUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncTracking" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorSummary" TEXT,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "hasNextPage" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SyncTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyEventId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_myshopifyDomain_key" ON "Shop"("myshopifyDomain");

-- CreateIndex
CREATE INDEX "Shop_domain_idx" ON "Shop"("domain");

-- CreateIndex
CREATE INDEX "Shop_myshopifyDomain_idx" ON "Shop"("myshopifyDomain");

-- CreateIndex
CREATE INDEX "Product_shopId_handle_idx" ON "Product"("shopId", "handle");

-- CreateIndex
CREATE INDEX "Product_shopId_status_idx" ON "Product"("shopId", "status");

-- CreateIndex
CREATE INDEX "Product_shopId_vendor_idx" ON "Product"("shopId", "vendor");

-- CreateIndex
CREATE UNIQUE INDEX "Product_shopId_shopifyId_key" ON "Product"("shopId", "shopifyId");

-- CreateIndex
CREATE INDEX "ProductVariant_shopId_inventoryItemId_idx" ON "ProductVariant"("shopId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "ProductVariant_shopId_sku_idx" ON "ProductVariant"("shopId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_shopId_shopifyId_key" ON "ProductVariant"("shopId", "shopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_shopId_productId_shopifyId_key" ON "ProductVariant"("shopId", "productId", "shopifyId");

-- CreateIndex
CREATE INDEX "Location_shopId_isActive_idx" ON "Location"("shopId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Location_shopId_shopifyId_key" ON "Location"("shopId", "shopifyId");

-- CreateIndex
CREATE INDEX "InventoryLevel_shopId_variantId_idx" ON "InventoryLevel"("shopId", "variantId");

-- CreateIndex
CREATE INDEX "InventoryLevel_shopId_locationId_idx" ON "InventoryLevel"("shopId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryLevel_shopId_updatedAt_idx" ON "InventoryLevel"("shopId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLevel_shopId_inventoryItemId_locationId_key" ON "InventoryLevel"("shopId", "inventoryItemId", "locationId");

-- CreateIndex
CREATE INDEX "SyncTracking_shopId_syncType_status_idx" ON "SyncTracking"("shopId", "syncType", "status");

-- CreateIndex
CREATE INDEX "SyncTracking_shopId_startedAt_idx" ON "SyncTracking"("shopId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_shopifyEventId_key" ON "WebhookEvent"("shopifyEventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopId_topic_status_idx" ON "WebhookEvent"("shopId", "topic", "status");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopId_receivedAt_idx" ON "WebhookEvent"("shopId", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopId_shopifyEventId_idx" ON "WebhookEvent"("shopId", "shopifyEventId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLevel" ADD CONSTRAINT "InventoryLevel_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLevel" ADD CONSTRAINT "InventoryLevel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLevel" ADD CONSTRAINT "InventoryLevel_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncTracking" ADD CONSTRAINT "SyncTracking_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

