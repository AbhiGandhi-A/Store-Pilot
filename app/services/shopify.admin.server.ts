import prisma from "~/db.server";
import {
  GET_SHOP_INFO,
  GET_PRODUCTS,
  GET_LOCATIONS,
  GET_INVENTORY_LEVELS,
  GET_INVENTORY_LEVELS_BY_LOCATION,
  GET_ORDERS,
} from "~/services/shopify.graphql";

export function parseShopifyId(id: string | null | undefined): string {
  if (!id) return "";
  const str = String(id);
  const parts = str.split("/");
  return parts[parts.length - 1] || str;
}

export function sanitizeError(msg: string): string {
  if (!msg) return "";
  return msg
    .replace(/(?:shpat_|shpss_|Bearer\s+)[a-zA-Z0-9_-]+/gi, "[REDACTED_SECRET]")
    .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://[REDACTED_USER_INFO]@")
    .replace(/api[-_]?key[=:\s]+[a-zA-Z0-9_-]+/gi, "api_key=[REDACTED]");
}

export interface ShopifyShopInfo {
  id: string;
  name: string;
  email: string | null;
  currencyCode: string;
  ianaTimezone: string;
  planName: string | null;
  myshopifyDomain: string;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string | null;
  vendor: string | null;
  productType: string | null;
  status: string;
  tags: string[];
  publishedAt: string | null;
  templateSuffix: string | null;
  bodyHtml: string | null;
  createdAt: string;
  updatedAt: string;
  variants: ShopifyVariant[];
}

export interface ShopifyProductWithInventory extends ShopifyProduct {
  variants: ShopifyVariantWithInventory[];
}

export interface ShopifyVariantWithInventory extends ShopifyVariant {
  inventoryItemId: string | null;
}

export interface ShopifyVariant {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryItem: { id: string } | null;
  inventoryPolicy: string | null;
  position: number | null;
  weight: number | null;
  weightUnit: string | null;
  taxable: boolean | null;
  requiresShipping: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopifyLocation {
  id: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  country: string | null;
  countryCode: string | null;
  zip: string | null;
  phone: string | null;
  isActive: boolean;
  legacy: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShopifyInventoryLevel {
  inventoryItemId: string;
  locationId: string;
  available: number;
  updatedAt: string;
}

export interface ShopifyOrder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
  financialStatus: string;
  fulfillmentStatus: string | null;
  totalPrice: { amount: string; currencyCode: string };
  subtotalPrice: { amount: string; currencyCode: string };
  totalTax: { amount: string; currencyCode: string };
  lineItems: Array<{
    id: string;
    title: string;
    sku: string | null;
    quantity: number;
    variant: { id: string; product: { id: string } } | null;
    originalUnitPrice: { amount: string; currencyCode: string };
  }>;
}

export type AdminGraphQL = {
  graphql: (query: string, options?: { variables?: Record<string, unknown>; apiVersion?: string; headers?: Record<string, string>; tries?: number; signal?: AbortSignal }) => Promise<Response>;
};

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}

export async function executeGraphQL<T>(
  admin: AdminGraphQL,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  let response: Response;
  try {
    response = await admin.graphql(query, { variables });
  } catch (networkOrAuthErr) {
    const rawMsg = networkOrAuthErr instanceof Error ? networkOrAuthErr.message : String(networkOrAuthErr);
    console.error("[StockPilot GraphQL Network/Call Failure]:", networkOrAuthErr);
    throw new Error(`Shopify GraphQL request failed: ${sanitizeError(rawMsg)}`);
  }

  let result: GraphQLResponse<T>;
  try {
    result = (await response.json()) as GraphQLResponse<T>;
  } catch (jsonErr) {
    console.error(`[StockPilot GraphQL JSON Parse Failure] Status: ${response?.status} ${response?.statusText}`, jsonErr);
    throw new Error(`Shopify GraphQL returned non-JSON response (HTTP ${response?.status}): ${response?.statusText}`);
  }

  if (result.errors && (Array.isArray(result.errors) ? result.errors.length > 0 : Boolean(result.errors))) {
    const errList = Array.isArray(result.errors)
      ? result.errors.map((e: unknown) => (typeof e === "string" ? e : (e as { message?: string })?.message || JSON.stringify(e))).join("; ")
      : typeof result.errors === "string"
        ? result.errors
        : JSON.stringify(result.errors);
    console.error(`[StockPilot GraphQL Query Error]: ${errList}`);
    throw new Error(`Shopify GraphQL Error: ${sanitizeError(errList)}`);
  }

  if (!result.data) {
    console.error("[StockPilot GraphQL Empty Data]:", result);
    throw new Error("Shopify GraphQL response contained no data");
  }

  return result.data;
}

export async function fetchShopInfo(admin: AdminGraphQL): Promise<ShopifyShopInfo> {
  const data = await executeGraphQL<{ shop: ShopifyShopInfo }>(admin, GET_SHOP_INFO);
  return data.shop;
}

export interface ShopifyProductsQueryResponse {
  products: {
    edges: Array<{ node: Record<string, unknown>; cursor: string }>;
    pageInfo: { hasNextPage: boolean; endCursor: string };
  };
}

export interface ShopifyLocationsQueryResponse {
  locations: {
    edges: Array<{ node: Record<string, unknown>; cursor: string }>;
    pageInfo: { hasNextPage: boolean; endCursor: string };
  };
}

export interface ShopifyInventoryLevelsQueryResponse {
  inventoryItems: {
    edges: Array<{
      node: {
        id: string;
        inventoryLevels: {
          edges: Array<{
            node: {
              id: string;
              updatedAt: string;
              location?: { id: string };
              available?: number;
              quantities?: Array<{ name: string; quantity: number }>;
            };
          }>;
        };
      };
      cursor: string;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string };
  };
}

export interface ShopifyInventoryLevelsByLocationQueryResponse {
  location?: {
    inventoryLevels?: {
      edges: Array<{
        node: {
          id: string;
          updatedAt: string;
          item?: { id: string };
          location?: { id: string };
          available?: number;
          quantities?: Array<{ name: string; quantity: number }>;
        };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor: string };
    };
  };
}

export async function fetchAllProducts(
  admin: AdminGraphQL,
  onProgress?: (products: ShopifyProductWithInventory[]) => void
): Promise<ShopifyProductWithInventory[]> {
  const allProducts: ShopifyProductWithInventory[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    const data: ShopifyProductsQueryResponse = await executeGraphQL<ShopifyProductsQueryResponse>(admin, GET_PRODUCTS, { first: 50, after });

    const { edges, pageInfo } = data.products;

    const products: ShopifyProductWithInventory[] = edges.map((edge) => {
      const node = edge.node;
      const rawVariants = Array.isArray(node.variants)
        ? node.variants
        : (node.variants as { edges?: Array<{ node: Record<string, unknown> }> })?.edges?.map((e) => e.node) || [];

      const variants: ShopifyVariantWithInventory[] = rawVariants.map((rawV) => {
        const v = rawV as Record<string, unknown> & {
          inventoryItem?: {
            id?: string;
            requiresShipping?: boolean;
            measurement?: { weight?: { value?: number; unit?: string } };
          };
          price?: string | { amount?: string };
          compareAtPrice?: string | { amount?: string };
        };
        const invItemId = v.inventoryItem?.id ? parseShopifyId(v.inventoryItem.id) : (typeof v.inventoryItemId === "string" ? v.inventoryItemId : null);
        const weight = v.inventoryItem?.measurement?.weight?.value ?? (typeof v.weight === "number" ? v.weight : null);
        const weightUnit = v.inventoryItem?.measurement?.weight?.unit ?? (typeof v.weightUnit === "string" ? v.weightUnit : null);
        const requiresShipping = v.inventoryItem?.requiresShipping ?? (typeof v.requiresShipping === "boolean" ? v.requiresShipping : null);

        return {
          id: String(v.id || ""),
          title: String(v.title || ""),
          sku: typeof v.sku === "string" ? v.sku : null,
          barcode: typeof v.barcode === "string" ? v.barcode : null,
          price: typeof v.price === "string" ? v.price : (v.price?.amount || "0.00"),
          compareAtPrice: typeof v.compareAtPrice === "string" ? v.compareAtPrice : (v.compareAtPrice?.amount || null),
          inventoryItem: v.inventoryItem?.id ? { id: v.inventoryItem.id } : null,
          inventoryItemId: invItemId,
          inventoryPolicy: typeof v.inventoryPolicy === "string" ? v.inventoryPolicy : null,
          position: typeof v.position === "number" ? v.position : null,
          weight: weight !== null ? Number(weight) : null,
          weightUnit: weightUnit ? String(weightUnit) : null,
          taxable: typeof v.taxable === "boolean" ? v.taxable : null,
          requiresShipping: requiresShipping ?? null,
          createdAt: typeof v.createdAt === "string" ? v.createdAt : (typeof node.createdAt === "string" ? node.createdAt : new Date().toISOString()),
          updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : (typeof node.updatedAt === "string" ? node.updatedAt : new Date().toISOString()),
        };
      });

      return {
        id: String(node.id || ""),
        title: String(node.title || ""),
        handle: typeof node.handle === "string" ? node.handle : null,
        vendor: typeof node.vendor === "string" ? node.vendor : null,
        productType: typeof node.productType === "string" ? node.productType : null,
        status: typeof node.status === "string" ? node.status : "ACTIVE",
        tags: Array.isArray(node.tags) ? (node.tags as string[]) : [],
        publishedAt: typeof node.publishedAt === "string" ? node.publishedAt : null,
        templateSuffix: typeof node.templateSuffix === "string" ? node.templateSuffix : null,
        bodyHtml: typeof node.descriptionHtml === "string" ? node.descriptionHtml : (typeof node.bodyHtml === "string" ? node.bodyHtml : null),
        createdAt: typeof node.createdAt === "string" ? node.createdAt : new Date().toISOString(),
        updatedAt: typeof node.updatedAt === "string" ? node.updatedAt : new Date().toISOString(),
        variants,
      };
    });
    allProducts.push(...products);

    if (onProgress && products.length > 0) {
      onProgress(products);
    }

    hasNextPage = pageInfo.hasNextPage;
    after = pageInfo.endCursor;
  }

  return allProducts;
}

export async function fetchAllLocations(
  admin: AdminGraphQL,
  onProgress?: (locations: ShopifyLocation[]) => void
): Promise<ShopifyLocation[]> {
  const allLocations: ShopifyLocation[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    const data: ShopifyLocationsQueryResponse = await executeGraphQL<ShopifyLocationsQueryResponse>(admin, GET_LOCATIONS, { first: 50, after });

    const { edges, pageInfo } = data.locations;

    const locations: ShopifyLocation[] = edges.map((edge) => {
      const node = edge.node;
      const addr = (node.address as Record<string, unknown>) || {};
      return {
        id: String(node.id || ""),
        name: String(node.name || ""),
        address1: (addr.address1 as string) ?? (node.address1 as string) ?? null,
        address2: (addr.address2 as string) ?? (node.address2 as string) ?? null,
        city: (addr.city as string) ?? (node.city as string) ?? null,
        province: (addr.province as string) ?? (node.province as string) ?? null,
        provinceCode: (addr.provinceCode as string) ?? (node.provinceCode as string) ?? null,
        country: (addr.country as string) ?? (node.country as string) ?? null,
        countryCode: (addr.countryCode as string) ?? (node.countryCode as string) ?? null,
        zip: (addr.zip as string) ?? (node.zip as string) ?? null,
        phone: (addr.phone as string) ?? (node.phone as string) ?? null,
        isActive: typeof node.isActive === "boolean" ? node.isActive : true,
        legacy: Boolean(node.legacy ?? false),
        createdAt: typeof node.createdAt === "string" ? node.createdAt : new Date().toISOString(),
        updatedAt: typeof node.updatedAt === "string" ? node.updatedAt : new Date().toISOString(),
      };
    });
    allLocations.push(...locations);

    if (onProgress && locations.length > 0) {
      onProgress(locations);
    }

    hasNextPage = pageInfo.hasNextPage;
    after = pageInfo.endCursor;
  }

  return allLocations;
}

export async function fetchAllInventoryLevels(
  admin: AdminGraphQL,
  onProgress?: (levels: ShopifyInventoryLevel[]) => void
): Promise<ShopifyInventoryLevel[]> {
  const allLevels: ShopifyInventoryLevel[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    const data: ShopifyInventoryLevelsQueryResponse = await executeGraphQL<ShopifyInventoryLevelsQueryResponse>(admin, GET_INVENTORY_LEVELS, { first: 50, after });

    const { edges, pageInfo } = data.inventoryItems;

    for (const edge of edges) {
      const inventoryItemId = parseShopifyId(edge.node.id);
      const levelEdges = edge.node.inventoryLevels?.edges || [];
      for (const levelEdge of levelEdges) {
        const level = levelEdge.node;
        const availableQty =
          level.quantities?.find((q) => q.name === "available")?.quantity ??
          (typeof level.available === "number" ? level.available : 0);

        allLevels.push({
          inventoryItemId,
          locationId: parseShopifyId(level.location?.id || ""),
          available: availableQty,
          updatedAt: level.updatedAt || new Date().toISOString(),
        });
      }
    }

    if (onProgress && allLevels.length > 0) {
      onProgress(allLevels);
    }

    hasNextPage = pageInfo.hasNextPage;
    after = pageInfo.endCursor;
  }

  return allLevels;
}

export async function fetchInventoryLevelsByLocation(
  admin: AdminGraphQL,
  locationId: string,
  onProgress?: (levels: ShopifyInventoryLevel[]) => void
): Promise<ShopifyInventoryLevel[]> {
  const allLevels: ShopifyInventoryLevel[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    const data: ShopifyInventoryLevelsByLocationQueryResponse = await executeGraphQL<ShopifyInventoryLevelsByLocationQueryResponse>(admin, GET_INVENTORY_LEVELS_BY_LOCATION, { first: 50, after, locationId });

    const locationData = data.location;
    if (!locationData || !locationData.inventoryLevels) break;

    const { edges, pageInfo } = locationData.inventoryLevels;

    for (const edge of edges) {
      const level = edge.node;
      const itemId = level.item?.id || "";
      const inventoryItemId = parseShopifyId(itemId);
      const locId = level.location?.id ? parseShopifyId(level.location.id) : parseShopifyId(locationId);

      const availableQty =
        level.quantities?.find((q) => q.name === "available")?.quantity ??
        (typeof level.available === "number" ? level.available : 0);

      allLevels.push({
        inventoryItemId,
        locationId: locId,
        available: availableQty,
        updatedAt: level.updatedAt || new Date().toISOString(),
      });
    }

    if (onProgress && allLevels.length > 0) {
      onProgress(allLevels);
    }

    hasNextPage = pageInfo.hasNextPage;
    after = pageInfo.endCursor;
  }

  return allLevels;
}

export async function fetchOrders(
  admin: AdminGraphQL,
  limit: number = 50,
  query?: string
): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage && allOrders.length < limit) {
    const data: {
      orders: {
        edges: Array<{ node: ShopifyOrder; cursor: string }>;
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    } = await executeGraphQL<{
      orders: {
        edges: Array<{ node: ShopifyOrder; cursor: string }>;
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    }>(admin, GET_ORDERS, { first: Math.min(50, limit - allOrders.length), after, query });

    const { edges, pageInfo } = data.orders;

    const orders = edges.map((edge) => edge.node);
    allOrders.push(...orders);

    hasNextPage = pageInfo.hasNextPage;
    after = pageInfo.endCursor;
  }

  return allOrders.slice(0, limit);
}

export async function getOrCreateShop(
  domain: string,
  shopInfo: ShopifyShopInfo
): Promise<{ id: string; domain: string; name: string | null }> {
  const shop = await prisma.shop.upsert({
    where: { domain },
    create: {
      domain,
      name: shopInfo.name,
      myshopifyDomain: shopInfo.myshopifyDomain,
      email: shopInfo.email,
      currencyCode: shopInfo.currencyCode,
      timezone: shopInfo.ianaTimezone,
      planName: shopInfo.planName,
      settings: {},
    },
    update: {
      name: shopInfo.name,
      myshopifyDomain: shopInfo.myshopifyDomain,
      email: shopInfo.email,
      currencyCode: shopInfo.currencyCode,
      timezone: shopInfo.ianaTimezone,
      planName: shopInfo.planName,
      updatedAt: new Date(),
    },
    select: { id: true, domain: true, name: true },
  });

  return shop;
}