export const GET_SHOP_INFO = `#graphql
  query GetShopInfo {
    shop {
      id
      name
      email
      currencyCode
      ianaTimezone
      plan {
        displayName
      }
      myshopifyDomain
    }
  }
`;

export const GET_PRODUCTS = `#graphql
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          status
          tags
          publishedAt
          templateSuffix
          descriptionHtml
          createdAt
          updatedAt
          variants(first: 50) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryPolicy
                position
                taxable
                createdAt
                updatedAt
                inventoryItem {
                  id
                  requiresShipping
                  measurement {
                    weight {
                      value
                      unit
                    }
                  }
                }
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const GET_LOCATIONS = `#graphql
  query GetLocations($first: Int!, $after: String) {
    locations(first: $first, after: $after) {
      edges {
        node {
          id
          name
          address {
            address1
            address2
            city
            province
            provinceCode
            country
            countryCode
            zip
            phone
          }
          isActive
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const GET_INVENTORY_LEVELS = `#graphql
  query GetInventoryLevels($first: Int!, $after: String, $query: String) {
    inventoryItems(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          unitCost {
            amount
            currencyCode
          }
          tracked
          inventoryLevels(first: 50) {
            edges {
              node {
                id
                updatedAt
                location {
                  id
                }
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const GET_INVENTORY_LEVELS_BY_LOCATION = `#graphql
  query GetInventoryLevelsByLocation($first: Int!, $after: String, $locationId: ID!) {
    location(id: $locationId) {
      id
      inventoryLevels(first: $first, after: $after) {
        edges {
          node {
            id
            updatedAt
            item {
              id
            }
            location {
              id
            }
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export const GET_ORDERS = `#graphql
  query GetOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      edges {
        node {
          id
          name
          createdAt
          updatedAt
          processedAt
          cancelledAt
          financialStatus
          fulfillmentStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          subtotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalTaxSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                sku
                quantity
                variant {
                  id
                  product {
                    id
                  }
                }
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;