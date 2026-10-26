import prisma from "~/db.server";

export type AnalysisStatus =
  | "OK"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "STOCKOUT_RISK"
  | "SLOW_MOVING"
  | "POTENTIAL_DEAD_STOCK"
  | "EXCESS_INVENTORY"
  | "REORDER_RECOMMENDED"
  | "INSUFFICIENT_HISTORY"
  | "MISSING_DATA"
  | "STALE_DATA"
  | "ZERO_DEMAND"
  | "NEGATIVE_INVENTORY";

export type FindingSeverity = "info" | "warning" | "critical";

export interface ShopSettings {
  lowStockThreshold?: number;
  slowMovingAnalysisDays?: number;
  deadStockAnalysisDays?: number;
  targetInventoryCoverageDays?: number;
  defaultLeadTimeDays?: number;
  safetyStockDays?: number;
  minimumOrderQuantity?: number;
}

export interface InventorySnapshot {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  inventoryItemId: string | null;
  locationId: string;
  locationName: string;
  available: number;
  shopifyUpdatedAt: Date | null;
  lastSyncedAt: Date;
  price: number | null;
}

export interface DemandMetrics {
  variantId: string;
  totalUnitsSold: number;
  averageDailyDemand: number;
  analysisPeriodDays: number;
  analysisStartDate: Date;
  analysisEndDate: Date;
  dataPoints: number;
  isReliable: boolean;
}

export interface InventoryFinding {
  id: string;
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  locationId: string | null;
  locationName: string | null;
  findingType: AnalysisStatus;
  severity: FindingSeverity;
  availableQuantity: number;
  demandMetrics: DemandMetrics | null;
  daysRemaining: number | null;
  estimatedStockoutDate: Date | null;
  reorderPoint: number | null;
  targetStock: number | null;
  suggestedReorderQuantity: number | null;
  leadTimeDays: number | null;
  safetyStock: number | null;
  evidence: string[];
  warnings: string[];
  calculatedAt: Date;
}

export interface AnalysisResult {
  findings: InventoryFinding[];
  summary: {
    outOfStock: number;
    lowStock: number;
    stockoutRisk: number;
    slowMoving: number;
    potentialDeadStock: number;
    excessInventory: number;
    reorderRecommended: number;
    insufficientHistory: number;
    missingData: number;
    staleData: number;
    negativeInventory: number;
  };
  dataQuality: {
    totalVariantsAnalyzed: number;
    variantsWithDemandData: number;
    variantsWithInventoryData: number;
    oldestInventorySync: Date | null;
    analysisPeriodDays: number;
  };
  settings: Required<ShopSettings>;
}

const DEFAULT_SETTINGS: Required<ShopSettings> = {
  lowStockThreshold: 10,
  slowMovingAnalysisDays: 90,
  deadStockAnalysisDays: 180,
  targetInventoryCoverageDays: 60,
  defaultLeadTimeDays: 14,
  safetyStockDays: 7,
  minimumOrderQuantity: 1,
};

function getSettings(shop: { settings: unknown }): Required<ShopSettings> {
  const settings = (shop.settings as Partial<ShopSettings>) || {};
  return {
    lowStockThreshold: settings.lowStockThreshold ?? DEFAULT_SETTINGS.lowStockThreshold,
    slowMovingAnalysisDays: settings.slowMovingAnalysisDays ?? DEFAULT_SETTINGS.slowMovingAnalysisDays,
    deadStockAnalysisDays: settings.deadStockAnalysisDays ?? DEFAULT_SETTINGS.deadStockAnalysisDays,
    targetInventoryCoverageDays: settings.targetInventoryCoverageDays ?? DEFAULT_SETTINGS.targetInventoryCoverageDays,
    defaultLeadTimeDays: settings.defaultLeadTimeDays ?? DEFAULT_SETTINGS.defaultLeadTimeDays,
    safetyStockDays: settings.safetyStockDays ?? DEFAULT_SETTINGS.safetyStockDays,
    minimumOrderQuantity: settings.minimumOrderQuantity ?? DEFAULT_SETTINGS.minimumOrderQuantity,
  };
}

function isStaleData(lastSyncedAt: Date, maxAgeHours: number = 24): boolean {
  const ageMs = Date.now() - lastSyncedAt.getTime();
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

function calculateDaysRemaining(available: number, dailyDemand: number): number | null {
  if (dailyDemand <= 0) return null;
  if (available <= 0) return 0;
  return Math.floor(available / dailyDemand);
}

function calculateReorderPoint(
  averageDailyDemand: number,
  leadTimeDays: number,
  safetyStock: number
): number {
  return Math.ceil(averageDailyDemand * leadTimeDays + safetyStock);
}

function calculateSafetyStock(averageDailyDemand: number, safetyStockDays: number): number {
  return Math.ceil(averageDailyDemand * safetyStockDays);
}

function calculateTargetStock(
  averageDailyDemand: number,
  coverageDays: number,
  safetyStock: number
): number {
  return Math.ceil(averageDailyDemand * coverageDays + safetyStock);
}

function calculateSuggestedReorderQuantity(
  targetStock: number,
  availableQuantity: number,
  minimumOrderQuantity: number
): number {
  const needed = Math.max(0, targetStock - availableQuantity);
  return Math.max(needed, minimumOrderQuantity);
}

async function fetchInventorySnapshots(shopId: string): Promise<InventorySnapshot[]> {
  const inventoryLevels = await prisma.inventoryLevel.findMany({
    where: { shopId },
    include: {
      variant: {
        include: {
          product: true,
        },
      },
      location: true,
    },
  });

  return inventoryLevels.map((level) => ({
    variantId: level.variantId ?? "",
    productId: level.variant?.productId ?? "",
    productTitle: level.variant?.product?.title ?? "Unknown Product",
    variantTitle: level.variant?.title ?? "Unknown Variant",
    sku: level.variant?.sku ?? null,
    inventoryItemId: level.inventoryItemId,
    locationId: level.locationId,
    locationName: level.location?.name ?? "Unknown Location",
    available: level.available,
    shopifyUpdatedAt: level.shopifyUpdatedAt,
    lastSyncedAt: level.lastSyncedAt,
    price: level.variant ? Number(level.variant.price) : null,
  }));
}

async function fetchSalesHistory(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shopId: string,
  days: number
): Promise<Map<string, DemandMetrics>> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const query = `#graphql
    query GetOrders($first: Int!, $after: String, $query: String) {
      orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
        edges {
          node {
            id
            createdAt
            lineItems(first: 100) {
              edges {
                node {
                  id
                  quantity
                  variant {
                    id
                    product {
                      id
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const demandMap = new Map<string, { totalQuantity: number; orders: number }>();

  let hasNextPage = true;
  let after: string | null = null;
  const queryStr = `created_at:>${startDate.toISOString()} created_at:<${endDate.toISOString()}`;

  while (hasNextPage) {
    const response = await admin.graphql(query, {
      variables: { first: 50, after, query: queryStr },
    });
    const result = await response.json();

    if (result.errors) {
      console.error("GraphQL errors fetching orders:", result.errors);
      break;
    }

    const orders = result.data?.orders;
    if (!orders) break;

    for (const edge of orders.edges) {
      const order = edge.node;
      for (const itemEdge of order.lineItems.edges) {
        const item = itemEdge.node;
        if (item.variant?.id) {
          const variantShopifyId = item.variant.id.split("/").pop() || item.variant.id;
          const key = variantShopifyId;
          const existing = demandMap.get(key) || { totalQuantity: 0, orders: 0 };
          existing.totalQuantity += item.quantity;
          existing.orders += 1;
          demandMap.set(key, existing);
        }
      }
    }

    hasNextPage = orders.pageInfo.hasNextPage;
    after = orders.pageInfo.endCursor;
  }

  const demandMetricsMap = new Map<string, DemandMetrics>();

  for (const [variantShopifyId, data] of demandMap.entries()) {
    const averageDailyDemand = data.totalQuantity / days;
    demandMetricsMap.set(variantShopifyId, {
      variantId: variantShopifyId,
      totalUnitsSold: data.totalQuantity,
      averageDailyDemand,
      analysisPeriodDays: days,
      analysisStartDate: startDate,
      analysisEndDate: endDate,
      dataPoints: data.orders,
      isReliable: data.orders >= 3 && days >= 30,
    });
  }

  return demandMetricsMap;
}

export async function analyzeInventory(
  shopId: string,
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> }
): Promise<AnalysisResult> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) {
    throw new Error("Shop not found");
  }

  const settings = getSettings(shop);
  const snapshots = await fetchInventorySnapshots(shopId);

  const demandMetricsMap = await fetchSalesHistory(admin, shopId, settings.slowMovingAnalysisDays);

  const findings: InventoryFinding[] = [];
  const now = new Date();

  const variantGroups = new Map<string, InventorySnapshot[]>();
  for (const snapshot of snapshots) {
    if (!snapshot.variantId) continue;
    const existing = variantGroups.get(snapshot.variantId) || [];
    existing.push(snapshot);
    variantGroups.set(snapshot.variantId, existing);
  }

  let oldestSync: Date | null = null;
  for (const snapshot of snapshots) {
    if (!oldestSync || snapshot.lastSyncedAt < oldestSync) {
      oldestSync = snapshot.lastSyncedAt;
    }
  }

  for (const [variantId, locations] of variantGroups.entries()) {
    const firstSnapshot = locations[0];
    const totalAvailable = locations.reduce((sum, loc) => sum + loc.available, 0);
    const hasNegativeInventory = locations.some((loc) => loc.available < 0);
    const isStale = locations.some((loc) => isStaleData(loc.lastSyncedAt));

    const demandMetrics = demandMetricsMap.get(firstSnapshot.inventoryItemId ?? "") || null;

    if (totalAvailable <= 0) {
      findings.push({
        id: `finding-${variantId}-out-of-stock`,
        variantId,
        productId: firstSnapshot.productId,
        productTitle: firstSnapshot.productTitle,
        variantTitle: firstSnapshot.variantTitle,
        sku: firstSnapshot.sku,
        locationId: null,
        locationName: null,
        findingType: "OUT_OF_STOCK",
        severity: "critical",
        availableQuantity: totalAvailable,
        demandMetrics,
        daysRemaining: 0,
        estimatedStockoutDate: now,
        reorderPoint: null,
        targetStock: null,
        suggestedReorderQuantity: null,
        leadTimeDays: settings.defaultLeadTimeDays,
        safetyStock: null,
        evidence: [`Total available inventory across all locations: ${totalAvailable}`],
        warnings: hasNegativeInventory ? ["Negative inventory detected at one or more locations"] : [],
        calculatedAt: now,
      });
      continue;
    }

    if (demandMetrics && demandMetrics.isReliable && demandMetrics.averageDailyDemand > 0) {
      const daysRemaining = calculateDaysRemaining(totalAvailable, demandMetrics.averageDailyDemand);
      const safetyStock = calculateSafetyStock(demandMetrics.averageDailyDemand, settings.safetyStockDays);
      const reorderPoint = calculateReorderPoint(demandMetrics.averageDailyDemand, settings.defaultLeadTimeDays, safetyStock);
      const targetStock = calculateTargetStock(demandMetrics.averageDailyDemand, settings.targetInventoryCoverageDays, safetyStock);
      const suggestedReorderQuantity = calculateSuggestedReorderQuantity(targetStock, totalAvailable, settings.minimumOrderQuantity);

      let estimatedStockoutDate: Date | null = null;
      if (daysRemaining !== null && daysRemaining > 0) {
        estimatedStockoutDate = new Date(now);
        estimatedStockoutDate.setDate(estimatedStockoutDate.getDate() + daysRemaining);
      }

      if (totalAvailable <= settings.lowStockThreshold) {
        findings.push({
          id: `finding-${variantId}-low-stock`,
          variantId,
          productId: firstSnapshot.productId,
          productTitle: firstSnapshot.productTitle,
          variantTitle: firstSnapshot.variantTitle,
          sku: firstSnapshot.sku,
          locationId: null,
          locationName: null,
          findingType: "LOW_STOCK",
          severity: "warning",
          availableQuantity: totalAvailable,
          demandMetrics,
          daysRemaining,
          estimatedStockoutDate,
          reorderPoint,
          targetStock,
          suggestedReorderQuantity,
          leadTimeDays: settings.defaultLeadTimeDays,
          safetyStock,
          evidence: [
            `Available: ${totalAvailable} (threshold: ${settings.lowStockThreshold})`,
            `Avg daily demand: ${demandMetrics.averageDailyDemand.toFixed(2)}`,
            `Days remaining: ${daysRemaining !== null ? daysRemaining : "N/A"}`,
          ],
          warnings: hasNegativeInventory ? ["Negative inventory detected at one or more locations"] : [],
          calculatedAt: now,
        });
      }

      if (daysRemaining !== null && daysRemaining <= settings.defaultLeadTimeDays + settings.safetyStockDays) {
        findings.push({
          id: `finding-${variantId}-stockout-risk`,
          variantId,
          productId: firstSnapshot.productId,
          productTitle: firstSnapshot.productTitle,
          variantTitle: firstSnapshot.variantTitle,
          sku: firstSnapshot.sku,
          locationId: null,
          locationName: null,
          findingType: "STOCKOUT_RISK",
          severity: "critical",
          availableQuantity: totalAvailable,
          demandMetrics,
          daysRemaining,
          estimatedStockoutDate,
          reorderPoint,
          targetStock,
          suggestedReorderQuantity,
          leadTimeDays: settings.defaultLeadTimeDays,
          safetyStock,
          evidence: [
            `Days remaining (${daysRemaining}) <= lead time + safety stock (${settings.defaultLeadTimeDays + settings.safetyStockDays})`,
            `Reorder point: ${reorderPoint}`,
            `Current available: ${totalAvailable}`,
          ],
          warnings: hasNegativeInventory ? ["Negative inventory detected at one or more locations"] : [],
          calculatedAt: now,
        });
      }

      if (daysRemaining !== null && daysRemaining > settings.targetInventoryCoverageDays * 2) {
        const excessQuantity = totalAvailable - targetStock;
        if (excessQuantity > 0) {
          findings.push({
            id: `finding-${variantId}-excess-inventory`,
            variantId,
            productId: firstSnapshot.productId,
            productTitle: firstSnapshot.productTitle,
            variantTitle: firstSnapshot.variantTitle,
            sku: firstSnapshot.sku,
            locationId: null,
            locationName: null,
            findingType: "EXCESS_INVENTORY",
            severity: "info",
            availableQuantity: totalAvailable,
            demandMetrics,
            daysRemaining,
            estimatedStockoutDate: null,
            reorderPoint,
            targetStock,
            suggestedReorderQuantity: 0,
            leadTimeDays: settings.defaultLeadTimeDays,
            safetyStock,
            evidence: [
              `Days remaining (${daysRemaining}) > 2x target coverage (${settings.targetInventoryCoverageDays * 2})`,
              `Target stock: ${targetStock}`,
              `Excess quantity: ${excessQuantity}`,
            ],
            warnings: [],
            calculatedAt: now,
          });
        }
      }

      if (totalAvailable >= reorderPoint && totalAvailable < targetStock) {
        findings.push({
          id: `finding-${variantId}-reorder-recommended`,
          variantId,
          productId: firstSnapshot.productId,
          productTitle: firstSnapshot.productTitle,
          variantTitle: firstSnapshot.variantTitle,
          sku: firstSnapshot.sku,
          locationId: null,
          locationName: null,
          findingType: "REORDER_RECOMMENDED",
          severity: "warning",
          availableQuantity: totalAvailable,
          demandMetrics,
          daysRemaining,
          estimatedStockoutDate,
          reorderPoint,
          targetStock,
          suggestedReorderQuantity,
          leadTimeDays: settings.defaultLeadTimeDays,
          safetyStock,
          evidence: [
            `Available (${totalAvailable}) between reorder point (${reorderPoint}) and target stock (${targetStock})`,
            `Suggested reorder: ${suggestedReorderQuantity}`,
          ],
          warnings: [],
          calculatedAt: now,
        });
      }
    } else {
      if (totalAvailable <= settings.lowStockThreshold) {
        findings.push({
          id: `finding-${variantId}-low-stock-no-demand`,
          variantId,
          productId: firstSnapshot.productId,
          productTitle: firstSnapshot.productTitle,
          variantTitle: firstSnapshot.variantTitle,
          sku: firstSnapshot.sku,
          locationId: null,
          locationName: null,
          findingType: "LOW_STOCK",
          severity: "warning",
          availableQuantity: totalAvailable,
          demandMetrics: null,
          daysRemaining: null,
          estimatedStockoutDate: null,
          reorderPoint: null,
          targetStock: null,
          suggestedReorderQuantity: null,
          leadTimeDays: settings.defaultLeadTimeDays,
          safetyStock: null,
          evidence: [`Available: ${totalAvailable} (threshold: ${settings.lowStockThreshold})`],
          warnings: [
            "No reliable demand history available",
            "Cannot calculate stockout risk or reorder quantities",
            hasNegativeInventory ? "Negative inventory detected at one or more locations" : "",
          ].filter(Boolean),
          calculatedAt: now,
        });
      }

      if (!demandMetrics || !demandMetrics.isReliable) {
        findings.push({
          id: `finding-${variantId}-insufficient-history`,
          variantId,
          productId: firstSnapshot.productId,
          productTitle: firstSnapshot.productTitle,
          variantTitle: firstSnapshot.variantTitle,
          sku: firstSnapshot.sku,
          locationId: null,
          locationName: null,
          findingType: "INSUFFICIENT_HISTORY",
          severity: "info",
          availableQuantity: totalAvailable,
          demandMetrics,
          daysRemaining: null,
          estimatedStockoutDate: null,
          reorderPoint: null,
          targetStock: null,
          suggestedReorderQuantity: null,
          leadTimeDays: settings.defaultLeadTimeDays,
          safetyStock: null,
          evidence: demandMetrics
            ? [`Orders in period: ${demandMetrics.dataPoints}`, `Analysis period: ${demandMetrics.analysisPeriodDays} days`]
            : ["No sales history found in analysis period"],
          warnings: ["Demand-based calculations unavailable"],
          calculatedAt: now,
        });
      }
    }

    if (demandMetrics && demandMetrics.isReliable) {
      if (demandMetrics.totalUnitsSold === 0 && totalAvailable > 0) {
        findings.push({
          id: `finding-${variantId}-potential-dead-stock`,
          variantId,
          productId: firstSnapshot.productId,
          productTitle: firstSnapshot.productTitle,
          variantTitle: firstSnapshot.variantTitle,
          sku: firstSnapshot.sku,
          locationId: null,
          locationName: null,
          findingType: "POTENTIAL_DEAD_STOCK",
          severity: "warning",
          availableQuantity: totalAvailable,
          demandMetrics,
          daysRemaining: null,
          estimatedStockoutDate: null,
          reorderPoint: null,
          targetStock: null,
          suggestedReorderQuantity: 0,
          leadTimeDays: settings.defaultLeadTimeDays,
          safetyStock: null,
          evidence: [
            `Zero units sold in ${settings.deadStockAnalysisDays} days`,
            `Available inventory: ${totalAvailable}`,
            `Analysis period: ${demandMetrics.analysisPeriodDays} days`,
          ],
          warnings: ["Requires manual review before discontinuing"],
          calculatedAt: now,
        });
      }

      if (
        demandMetrics.averageDailyDemand > 0 &&
        demandMetrics.averageDailyDemand < 0.1 &&
        totalAvailable > settings.targetInventoryCoverageDays * demandMetrics.averageDailyDemand
      ) {
        findings.push({
          id: `finding-${variantId}-slow-moving`,
          variantId,
          productId: firstSnapshot.productId,
          productTitle: firstSnapshot.productTitle,
          variantTitle: firstSnapshot.variantTitle,
          sku: firstSnapshot.sku,
          locationId: null,
          locationName: null,
          findingType: "SLOW_MOVING",
          severity: "info",
          availableQuantity: totalAvailable,
          demandMetrics,
          daysRemaining: calculateDaysRemaining(totalAvailable, demandMetrics.averageDailyDemand),
          estimatedStockoutDate: null,
          reorderPoint: null,
          targetStock: null,
          suggestedReorderQuantity: null,
          leadTimeDays: settings.defaultLeadTimeDays,
          safetyStock: null,
          evidence: [
            `Low demand: ${demandMetrics.averageDailyDemand.toFixed(3)} units/day`,
            `Available: ${totalAvailable}`,
            `Analysis period: ${demandMetrics.analysisPeriodDays} days`,
          ],
          warnings: [],
          calculatedAt: now,
        });
      }
    }

    if (isStale) {
      findings.push({
        id: `finding-${variantId}-stale-data`,
        variantId,
        productId: firstSnapshot.productId,
        productTitle: firstSnapshot.productTitle,
        variantTitle: firstSnapshot.variantTitle,
        sku: firstSnapshot.sku,
        locationId: null,
        locationName: null,
        findingType: "STALE_DATA",
        severity: "info",
        availableQuantity: totalAvailable,
        demandMetrics: null,
        daysRemaining: null,
        estimatedStockoutDate: null,
        reorderPoint: null,
        targetStock: null,
        suggestedReorderQuantity: null,
        leadTimeDays: null,
        safetyStock: null,
        evidence: ["Inventory data older than 24 hours"],
        warnings: ["Analysis may be based on outdated information"],
        calculatedAt: now,
      });
    }
  }

  const summary = {
    outOfStock: findings.filter((f) => f.findingType === "OUT_OF_STOCK").length,
    lowStock: findings.filter((f) => f.findingType === "LOW_STOCK").length,
    stockoutRisk: findings.filter((f) => f.findingType === "STOCKOUT_RISK").length,
    slowMoving: findings.filter((f) => f.findingType === "SLOW_MOVING").length,
    potentialDeadStock: findings.filter((f) => f.findingType === "POTENTIAL_DEAD_STOCK").length,
    excessInventory: findings.filter((f) => f.findingType === "EXCESS_INVENTORY").length,
    reorderRecommended: findings.filter((f) => f.findingType === "REORDER_RECOMMENDED").length,
    insufficientHistory: findings.filter((f) => f.findingType === "INSUFFICIENT_HISTORY").length,
    missingData: findings.filter((f) => f.findingType === "MISSING_DATA").length,
    staleData: findings.filter((f) => f.findingType === "STALE_DATA").length,
    negativeInventory: findings.filter((f) => f.warnings.some((w) => w.includes("Negative"))).length,
  };

  return {
    findings,
    summary,
    dataQuality: {
      totalVariantsAnalyzed: variantGroups.size,
      variantsWithDemandData: Array.from(demandMetricsMap.values()).filter((d) => d.isReliable).length,
      variantsWithInventoryData: snapshots.length,
      oldestInventorySync: oldestSync,
      analysisPeriodDays: settings.slowMovingAnalysisDays,
    },
    settings,
  };
}

export async function getShopSettings(shopId: string): Promise<ShopSettings> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  return (shop?.settings as ShopSettings) || {};
}

export async function updateShopSettings(shopId: string, settings: Partial<ShopSettings>): Promise<ShopSettings> {
  const current = await getShopSettings(shopId);
  const updated = { ...current, ...settings };
  await prisma.shop.update({
    where: { id: shopId },
    data: { settings: updated },
  });
  return updated;
}

export { DEFAULT_SETTINGS };