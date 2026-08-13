export type OtoDeliveryOption = {
  deliveryOptionId: number;
  deliveryCompanyName: string;
  deliveryOptionName: string;
  serviceType: string;
  price: number;
  avgDeliveryTime: string;
  maxFreeWeight: number;
  extraWeightPerKg: number;
  maxOrderValue: number;
  maxCODValue: number;
  codCharge: number;
  returnFee: number;
  insurancePolicy?: string;
  pickupCutOffTime?: string;
  trackingType?: string;
  pickupDropoff?: string;
  logo?: string;
  estimatedDays?: number;
};

export type OtoDeliveryFeeResponse = {
  traceId?: string;
  success: boolean;
  deliveryCompany?: OtoDeliveryOption[];
  errorMessage?: string;
};

export type OtoRateQuote = {
  optionId: number;
  companyName: string;
  optionName: string;
  price: number;
  estimatedDays: string | null;
  codCharge: number;
  maxFreeWeight: number;
  extraWeightPerKg: number;
  maxCODValue: number;
  maxOrderValue: number;
  pickupDropoff: string;
  logo?: string;
};

export type OtoAccountInfo = {
  companyId: string;
  storeName: string;
  packageName: string;
  remainingCredit: number;
  currency: string;
  validityDate?: string;
  phone?: string;
  email?: string;
  success?: boolean;
};

export type OtoTokenPair = {
  access_token: string;
  refresh_token?: string;
  success: boolean;
  token_type?: string;
  expires_in?: string;
};
