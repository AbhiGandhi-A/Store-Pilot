import prisma from "~/db.server";
import {
  fetchShopInfo,
  fetchAllProducts,
  fetchAllLocations,
  fetchAllInventoryLevels,
  getOrCreateShop,
  parseShopifyId,
  sanitizeError,
  type ShopifyProduct,
  type ShopifyProductWithInventory,
  type ShopifyLocation,
  type ShopifyInventoryLevel,
  type AdminGraphQL,
} from "~/services/shopify.admin.server";

export type SyncType =
  | "shop"
  | "products"
  | "variants"
  | "locations"
  | "inventory_levels"
  | "full";

export interface SyncResult {
  success: boolean;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  error?: string;
}

async function createSyncTracking(
  shopId: string,
  syncType: SyncType
): Promise<string> {
  const tracking = await prisma.syncTracking.create({
    data: {
      shopId,
      syncType,
      status: "running",
      startedAt: new Date(),
    },
  });
  return tracking.id;
}

async function updateSyncTracking(
  trackingId: string,
  updates: Partial<{
    status: string;
    completedAt: Date;
    errorSummary: string;
    recordsProcessed: number;
    recordsCreated: number;
    recordsUpdated: number;
    recordsFailed: number;
    cursor: string;
    hasNextPage: boolean;
  }>
): Promise<void> {
  try {
    await prisma.syncTracking.update({
      where: { id: trackingId },
      data: updates,
    });
  } catch (err) {
    console.error(`[StockPilot] Failed to update sync tracking ${trackingId}:`, err);
  }
}

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

export async function syncShop(admin: AdminGraphQL): Promise<SyncResult> {
  let recordsProcessed = 0;
  let recordsCreated = 0;
  const recordsUpdated = 0;
  const recordsFailed = 0;

  try {
    const shopInfo = await fetchShopInfo(admin);
    const domain = shopInfo.myshopifyDomain;

    const shop = await getOrCreateShop(domain, shopInfo);

    const trackingId = await createSyncTracking(shop.id, "shop");

    recordsProcessed = 1;
    recordsCreated = 1;

    await updateSyncTracking(trackingId, {
      status: "completed",
      completedAt: new Date(),
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsFailed,
    });

    return { success: true, recordsProcessed, recordsCreated, recordsUpdated, recordsFailed };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : "Unknown error";
    const message = sanitizeError(rawMsg);
    console.error("[StockPilot Sync Shop Failure]:", error);
    return { success: false, recordsProcessed, recordsCreated, recordsUpdated, recordsFailed, error: message };
  }
}

export async function syncProducts(admin: AdminGraphQL, shopId: string): Promise<SyncResult> {
  const trackingId = await createSyncTracking(shopId, "products");
  let recordsProcessed = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsFailed = 0;

  try {
    await fetchAllProducts(admin, async (batch: ShopifyProductWithInventory[]) => {
      for (const product of batch) {
        try {
          const shopifyProductId = parseShopifyId(product.id);

          const existing = await prisma.product.findUnique({
            where: { shopId_shopifyId: { shopId, shopifyId: shopifyProductId } },
          });

          let productRecord;
          if (existing) {
            productRecord = await prisma.product.update({
              where: { id: existing.id },
              data: {
                title: product.title,
                handle: product.handle,
                vendor: product.vendor,
                productType: product.productType,
                status: product.status,
                tags: product.tags,
                publishedAt: parseDate(product.publishedAt),
                templateSuffix: product.templateSuffix,
                bodyHtml: product.bodyHtml,
                shopifyUpdatedAt: parseDate(product.updatedAt),
                updatedAt: new Date(),
              },
            });
            recordsUpdated++;
          } else {
            productRecord = await prisma.product.create({
              data: {
                shopId,
                shopifyId: shopifyProductId,
                title: product.title,
                handle: product.handle,
                vendor: product.vendor,
                productType: product.productType,
                status: product.status,
                tags: product.tags,
                publishedAt: parseDate(product.publishedAt),
                templateSuffix: product.templateSuffix,
                bodyHtml: product.bodyHtml,
                shopifyCreatedAt: parseDate(product.createdAt),
                shopifyUpdatedAt: parseDate(product.updatedAt),
              },
            });
            recordsCreated++;
          }

          for (const variant of product.variants) {
            const shopifyVariantId = parseShopifyId(variant.id);
            const inventoryItemId = variant.inventoryItemId ? parseShopifyId(variant.inventoryItemId) : null;

            const existingVariant = await prisma.productVariant.findUnique({
              where: { shopId_shopifyId: { shopId, shopifyId: shopifyVariantId } },
            });

            if (existingVariant) {
              await prisma.productVariant.update({
                where: { id: existingVariant.id },
                data: {
                  title: variant.title,
                  sku: variant.sku,
                  barcode: variant.barcode,
                  price: variant.price || "0.00",
                  compareAtPrice: variant.compareAtPrice ? variant.compareAtPrice : null,
                  inventoryItemId,
                  inventoryPolicy: variant.inventoryPolicy,
                  position: variant.position !== null && variant.position !== undefined ? Number(variant.position) : null,
                  weight: variant.weight !== null && variant.weight !== undefined ? String(variant.weight) : null,
                  weightUnit: variant.weightUnit,
                  taxable: variant.taxable,
                  requiresShipping: variant.requiresShipping,
                  shopifyUpdatedAt: parseDate(variant.updatedAt),
                  updatedAt: new Date(),
                },
              });
            } else {
              await prisma.productVariant.create({
                data: {
                  shopId,
                  productId: productRecord.id,
                  shopifyId: shopifyVariantId,
                  title: variant.title,
                  sku: variant.sku,
                  barcode: variant.barcode,
                  price: variant.price || "0.00",
                  compareAtPrice: variant.compareAtPrice ? variant.compareAtPrice : null,
                  inventoryItemId,
                  inventoryPolicy: variant.inventoryPolicy,
                  position: variant.position !== null && variant.position !== undefined ? Number(variant.position) : null,
                  weight: variant.weight !== null && variant.weight !== undefined ? String(variant.weight) : null,
                  weightUnit: variant.weightUnit,
                  taxable: variant.taxable,
                  requiresShipping: variant.requiresShipping,
                  shopifyCreatedAt: parseDate(variant.createdAt),
                  shopifyUpdatedAt: parseDate(variant.updatedAt),
                },
              });
            }
          }

          recordsProcessed++;
        } catch (err) {
          recordsFailed++;
          console.error(`[StockPilot] Failed to sync product ${product.id}:`, err);
        }
      }
    });

    await updateSyncTracking(trackingId, {
      status: "completed",
      completedAt: new Date(),
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsFailed,
    });

    return { success: true, recordsProcessed, recordsCreated, recordsUpdated, recordsFailed };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : "Unknown error";
    const message = sanitizeError(rawMsg);
    console.error(`[StockPilot Sync Products Failure] shopId=${shopId}:`, error);
    await updateSyncTracking(trackingId, {
      status: "failed",
      completedAt: new Date(),
      errorSummary: message,
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsFailed,
    });
    return { success: false, recordsProcessed, recordsCreated, recordsUpdated, recordsFailed, error: message };
  }
}

export async function syncLocations(admin: AdminGraphQL, shopId: string): Promise<SyncResult> {
  const trackingId = await createSyncTracking(shopId, "locations");
  let recordsProcessed = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsFailed = 0;

  try {
    await fetchAllLocations(admin, async (batch: ShopifyLocation[]) => {
      for (const location of batch) {
        try {
          const shopifyLocationId = parseShopifyId(location.id);

          const existing = await prisma.location.findUnique({
            where: { shopId_shopifyId: { shopId, shopifyId: shopifyLocationId } },
          });

          if (existing) {
            await prisma.location.update({
              where: { id: existing.id },
              data: {
                name: location.name,
                address1: location.address1,
                address2: location.address2,
                city: location.city,
                province: location.province,
                provinceCode: location.provinceCode,
                country: location.country,
                countryCode: location.countryCode,
                zip: location.zip,
                phone: location.phone,
                isActive: location.isActive,
                legacy: location.legacy,
                shopifyUpdatedAt: parseDate(location.updatedAt),
                updatedAt: new Date(),
              },
            });
            recordsUpdated++;
          } else {
            await prisma.location.create({
              data: {
                shopId,
                shopifyId: shopifyLocationId,
                name: location.name,
                address1: location.address1,
                address2: location.address2,
                city: location.city,
                province: location.province,
                provinceCode: location.provinceCode,
                country: location.country,
                countryCode: location.countryCode,
                zip: location.zip,
                phone: location.phone,
                isActive: location.isActive,
                legacy: location.legacy,
                shopifyCreatedAt: parseDate(location.createdAt),
                shopifyUpdatedAt: parseDate(location.updatedAt),
              },
            });
            recordsCreated++;
          }

          recordsProcessed++;
        } catch (err) {
          recordsFailed++;
          console.error(`[StockPilot] Failed to sync location ${location.id}:`, err);
        }
      }
    });

    await updateSyncTracking(trackingId, {
      status: "completed",
      completedAt: new Date(),
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsFailed,
    });

    return { success: true, recordsProcessed, recordsCreated, recordsUpdated, recordsFailed };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : "Unknown error";
    const message = sanitizeError(rawMsg);
    console.error(`[StockPilot Sync Locations Failure] shopId=${shopId}:`, error);
    await updateSyncTracking(trackingId, {
      status: "failed",
      completedAt: new Date(),
      errorSummary: message,
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsFailed,
    });
    return { success: false, recordsProcessed, recordsCreated, recordsUpdated, recordsFailed, error: message };
  }
}

export async function syncInventoryLevels(admin: AdminGraphQL, shopId: string): Promise<SyncResult> {
  const trackingId = await createSyncTracking(shopId, "inventory_levels");
  let recordsProcessed = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsFailed = 0;

  try {
    await fetchAllInventoryLevels(admin, async (batch: ShopifyInventoryLevel[]) => {
      for (const level of batch) {
        try {
          const locShopifyId = parseShopifyId(level.locationId);
          const invItemId = parseShopifyId(level.inventoryItemId);

          const location = await prisma.location.findUnique({
            where: { shopId_shopifyId: { shopId, shopifyId: locShopifyId } },
          });

          if (!location) {
            recordsFailed++;
            continue;
          }

          let variant: { id: string } | null = null;
          if (invItemId) {
            variant = await prisma.productVariant.findFirst({
              where: { shopId, inventoryItemId: invItemId },
              select: { id: true },
            });
          }

          const existing = await prisma.inventoryLevel.findUnique({
            where: {
              shopId_inventoryItemId_locationId: {
                shopId,
                inventoryItemId: invItemId,
                locationId: location.id,
              },
            },
          });

          if (existing) {
            await prisma.inventoryLevel.update({
              where: { id: existing.id },
              data: {
                available: level.available,
                shopifyUpdatedAt: parseDate(level.updatedAt),
                lastSyncedAt: new Date(),
                variantId: variant?.id ?? null,
              },
            });
            recordsUpdated++;
          } else {
            await prisma.inventoryLevel.create({
              data: {
                shopId,
                inventoryItemId: invItemId,
                locationId: location.id,
                available: level.available,
                shopifyUpdatedAt: parseDate(level.updatedAt),
                lastSyncedAt: new Date(),
                variantId: variant?.id ?? null,
              },
            });
            recordsCreated++;
          }

          recordsProcessed++;
        } catch (err) {
          recordsFailed++;
          console.error(`[StockPilot] Failed to sync inventory level ${level.inventoryItemId}@${level.locationId}:`, err);
        }
      }
    });

    await updateSyncTracking(trackingId, {
      status: "completed",
      completedAt: new Date(),
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsFailed,
    });

    return { success: true, recordsProcessed, recordsCreated, recordsUpdated, recordsFailed };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : "Unknown error";
    const message = sanitizeError(rawMsg);
    console.error(`[StockPilot Sync Inventory Levels Failure] shopId=${shopId}:`, error);
    await updateSyncTracking(trackingId, {
      status: "failed",
      completedAt: new Date(),
      errorSummary: message,
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsFailed,
    });
    return { success: false, recordsProcessed, recordsCreated, recordsUpdated, recordsFailed, error: message };
  }
}

export async function syncAll(admin: AdminGraphQL): Promise<SyncResult[]> {
  const shopInfo = await fetchShopInfo(admin);
  const shop = await getOrCreateShop(shopInfo.myshopifyDomain, shopInfo);

  const results: SyncResult[] = [];

  const shopResult = await syncShop(admin);
  results.push(shopResult);

  const productsResult = await syncProducts(admin, shop.id);
  results.push(productsResult);

  const locationsResult = await syncLocations(admin, shop.id);
  results.push(locationsResult);

  const inventoryResult = await syncInventoryLevels(admin, shop.id);
  results.push(inventoryResult);

  return results;
}

export async function getSyncStatus(shopId: string, syncType?: SyncType) {
  return prisma.syncTracking.findMany({
    where: {
      shopId,
      ...(syncType ? { syncType } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: 10,
  });
}

export { parseShopifyId, parseDate };
