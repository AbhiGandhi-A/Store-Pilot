import prisma from "~/db.server";
import { parseShopifyId, parseDate } from "~/services/sync.server";

export async function handleProductUpdate(shopId: string, payload: Record<string, unknown>) {
  const product = payload as Record<string, unknown>;
  const shopifyProductId = parseShopifyId(product.id as string);

  const existing = await prisma.product.findUnique({
    where: { shopId_shopifyId: { shopId, shopifyId: shopifyProductId } },
  });

  if (existing) {
    await prisma.product.update({
      where: { id: existing.id },
      data: {
        title: product.title as string,
        handle: product.handle as string | null,
        vendor: product.vendor as string | null,
        productType: product.productType as string | null,
        status: product.status as string | null,
        tags: (product.tags as string[]) || [],
        publishedAt: parseDate(product.publishedAt as string | null),
        templateSuffix: product.templateSuffix as string | null,
        bodyHtml: product.bodyHtml as string | null,
        shopifyUpdatedAt: parseDate(product.updatedAt as string | null),
        updatedAt: new Date(),
      },
    });
  } else {
    await prisma.product.create({
      data: {
        shopId,
        shopifyId: shopifyProductId,
        title: product.title as string,
        handle: product.handle as string | null,
        vendor: product.vendor as string | null,
        productType: product.productType as string | null,
        status: product.status as string | null,
        tags: (product.tags as string[]) || [],
        publishedAt: parseDate(product.publishedAt as string | null),
        templateSuffix: product.templateSuffix as string | null,
        bodyHtml: product.bodyHtml as string | null,
        shopifyCreatedAt: parseDate(product.createdAt as string | null),
        shopifyUpdatedAt: parseDate(product.updatedAt as string | null),
      },
    });
  }

  if (product.variants && Array.isArray(product.variants)) {
    for (const variant of product.variants as Array<Record<string, unknown>>) {
      const shopifyVariantId = parseShopifyId(variant.id as string);
      const inventoryItemId = variant.inventoryItem
        ? parseShopifyId((variant.inventoryItem as Record<string, unknown>).id as string)
        : null;

      const existingVariant = await prisma.productVariant.findUnique({
        where: { shopId_shopifyId: { shopId, shopifyId: shopifyVariantId } },
      });

      const productRecord = await prisma.product.findUnique({
        where: { shopId_shopifyId: { shopId, shopifyId: shopifyProductId } },
        select: { id: true },
      });

      if (!productRecord) continue;

      if (existingVariant) {
        await prisma.productVariant.update({
          where: { id: existingVariant.id },
          data: {
            title: variant.title as string,
            sku: variant.sku as string | null,
            barcode: variant.barcode as string | null,
            price: variant.price as string,
            compareAtPrice: variant.compareAtPrice as string | null,
            inventoryItemId,
            inventoryPolicy: variant.inventoryPolicy as string | null,
            position: variant.position as number | null,
            weight: variant.weight as number | null,
            weightUnit: variant.weightUnit as string | null,
            taxable: variant.taxable as boolean | null,
            requiresShipping: variant.requiresShipping as boolean | null,
            shopifyUpdatedAt: parseDate(variant.updatedAt as string | null),
            updatedAt: new Date(),
          },
        });
      } else {
        await prisma.productVariant.create({
          data: {
            shopId,
            productId: productRecord.id,
            shopifyId: shopifyVariantId,
            title: variant.title as string,
            sku: variant.sku as string | null,
            barcode: variant.barcode as string | null,
            price: variant.price as string,
            compareAtPrice: variant.compareAtPrice as string | null,
            inventoryItemId,
            inventoryPolicy: variant.inventoryPolicy as string | null,
            position: variant.position as number | null,
            weight: variant.weight as number | null,
            weightUnit: variant.weightUnit as string | null,
            taxable: variant.taxable as boolean | null,
            requiresShipping: variant.requiresShipping as boolean | null,
            shopifyCreatedAt: parseDate(variant.createdAt as string | null),
            shopifyUpdatedAt: parseDate(variant.updatedAt as string | null),
          },
        });
      }
    }
  }
}

export async function handleProductDelete(shopId: string, payload: Record<string, unknown>) {
  const shopifyProductId = parseShopifyId(payload.id as string);

  await prisma.product.deleteMany({
    where: { shopId, shopifyId: shopifyProductId },
  });
}

export async function handleInventoryLevelsUpdate(shopId: string, payload: Record<string, unknown>) {
  const inventoryItemId = parseShopifyId(payload.inventory_item_id as string);
  const locationId = parseShopifyId(payload.location_id as string);
  const available = (payload.available as number) || 0;
  const updatedAt = parseDate(payload.updated_at as string | null) || new Date();

  const location = await prisma.location.findUnique({
    where: { shopId_shopifyId: { shopId, shopifyId: locationId } },
  });

  if (!location) return;

  let variant: { id: string } | null = null;
  if (inventoryItemId) {
    variant = await prisma.productVariant.findFirst({
      where: { shopId, inventoryItemId },
      select: { id: true },
    });
  }

  await prisma.inventoryLevel.upsert({
    where: {
      shopId_inventoryItemId_locationId: {
        shopId,
        inventoryItemId,
        locationId: location.id,
      },
    },
    create: {
      shopId,
      inventoryItemId,
      locationId: location.id,
      available,
      shopifyUpdatedAt: updatedAt,
      lastSyncedAt: new Date(),
      variantId: variant?.id ?? null,
    },
    update: {
      available,
      shopifyUpdatedAt: updatedAt,
      lastSyncedAt: new Date(),
      variantId: variant?.id ?? null,
    },
  });
}

export async function handleInventoryItemsUpdate(shopId: string, payload: Record<string, unknown>) {
  const inventoryItemId = parseShopifyId(payload.id as string);

  const variants = await prisma.productVariant.findMany({
    where: { shopId, inventoryItemId },
    select: { id: true },
  });

  for (const variant of variants) {
    const levels = await prisma.inventoryLevel.findMany({
      where: { shopId, variantId: variant.id },
    });

    for (const level of levels) {
      await prisma.inventoryLevel.update({
        where: { id: level.id },
        data: { lastSyncedAt: new Date() },
      });
    }
  }
}

export async function handleLocationsUpdate(shopId: string, payload: Record<string, unknown>) {
  const location = payload as Record<string, unknown>;
  const shopifyLocationId = parseShopifyId(location.id as string);

  const address = location.address as Record<string, unknown> | null;

  const existing = await prisma.location.findUnique({
    where: { shopId_shopifyId: { shopId, shopifyId: shopifyLocationId } },
  });

  if (existing) {
    await prisma.location.update({
      where: { id: existing.id },
      data: {
        name: location.name as string,
        address1: address?.address1 as string | null,
        address2: address?.address2 as string | null,
        city: address?.city as string | null,
        province: address?.province as string | null,
        provinceCode: address?.provinceCode as string | null,
        country: address?.country as string | null,
        countryCode: address?.countryCode as string | null,
        zip: address?.zip as string | null,
        phone: address?.phone as string | null,
        isActive: location.active as boolean ?? true,
        legacy: location.legacy as boolean ?? false,
        shopifyUpdatedAt: parseDate(location.updatedAt as string | null),
        updatedAt: new Date(),
      },
    });
  } else {
    await prisma.location.create({
      data: {
        shopId,
        shopifyId: shopifyLocationId,
        name: location.name as string,
        address1: address?.address1 as string | null,
        address2: address?.address2 as string | null,
        city: address?.city as string | null,
        province: address?.province as string | null,
        provinceCode: address?.provinceCode as string | null,
        country: address?.country as string | null,
        countryCode: address?.countryCode as string | null,
        zip: address?.zip as string | null,
        phone: address?.phone as string | null,
        isActive: location.active as boolean ?? true,
        legacy: location.legacy as boolean ?? false,
        shopifyCreatedAt: parseDate(location.createdAt as string | null),
        shopifyUpdatedAt: parseDate(location.updatedAt as string | null),
      },
    });
  }
}