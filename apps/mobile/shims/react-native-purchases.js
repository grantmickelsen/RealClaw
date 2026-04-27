/**
 * Web shim for react-native-purchases (RevenueCat).
 * RevenueCat uses StoreKit/Play Billing — not available in browsers.
 * All methods are no-ops that return safe empty values.
 */

const LOG_LEVEL = { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };

const Purchases = {
  setLogLevel: () => {},
  configure: () => {},
  getOfferings: async () => ({ current: null, all: {} }),
  purchasePackage: async () => { throw new Error('Purchases not available on web'); },
  restorePurchases: async () => ({ activeSubscriptions: [], allPurchasedProductIdentifiers: [], entitlements: { active: {}, all: {} }, nonSubscriptionTransactions: [] }),
  getCustomerInfo: async () => ({ activeSubscriptions: [], allPurchasedProductIdentifiers: [], entitlements: { active: {}, all: {} }, nonSubscriptionTransactions: [] }),
  addCustomerInfoUpdateListener: () => ({ remove: () => {} }),
};

exports.default = Purchases;
exports.LOG_LEVEL = LOG_LEVEL;
