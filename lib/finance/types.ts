/**
 * Finance shared types (Phase 1.11; 1.15A verification). Client + server safe.
 */
import type { VerificationStatus } from "./verification";
import type { IntentStatus, ProviderName } from "./payment-intent";

export type InvoiceStatus = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";

export type PaymentMethod =
  | "CASH"
  | "BANK_TRANSFER"
  | "CHEQUE"
  | "WAVE"
  | "ORANGE_MONEY"
  | "OTHER";

export type Charge = {
  id: string;
  fileId: string;
  description: string;
  quantity: number;
  unitAmount: number;
  taxRate: number;
  currency: string;
};

export type ChargeInput = {
  description: string;
  quantity?: number;
  unitAmount?: number;
  taxRate?: number;
};

export type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitAmount: number;
  taxRate: number;
};

export type InvoiceLineInput = {
  description: string;
  quantity?: number;
  unitAmount?: number;
  taxRate?: number;
  chargeId?: string | null;
};

export type Payment = {
  id: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  paidAt: string;
  reversed: boolean;
  providerName: string | null;
  providerReference: string | null;
  verificationStatus: VerificationStatus;
};

export type PaymentInput = {
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  paidAt?: string | null;
  providerName?: string | null;
  providerReference?: string | null;
};

export type InvoiceDetail = {
  id: string;
  fileId: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  notes: string | null;
  lines: InvoiceLine[];
  payments: Payment[];
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  overdue: boolean;
};

export type InvoiceQueueItem = {
  id: string;
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  dueDate: string | null;
  overdue: boolean;
};

export type FinanceForFile = {
  charges: Charge[];
  invoices: InvoiceDetail[];
  hasIssued: boolean;
  outstanding: number;
  /** Phase 1.15B — online payment intents per invoice + provider availability. */
  intents: PaymentIntentView[];
  paymentsEnabled: boolean;
  usableProviders: ProviderName[];
};

export type FinanceKpis = {
  outstanding: number;
  overdueCount: number;
  draftCount: number;
  issuedCount: number;
};

/** One payment row in the reconciliation view (Phase 1.15A), with invoice context. */
export type ReconciliationPayment = {
  id: string;
  invoiceId: string;
  fileId: string;
  invoiceNumber: string | null;
  fileNumber: string | null;
  clientName: string | null;
  amount: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  providerName: string | null;
  providerReference: string | null;
  paidAt: string;
  verificationStatus: VerificationStatus;
  reversed: boolean;
  missingReference: boolean;
};

/** A payment_intent projected for the UI (Phase 1.15B). Client-safe. */
export type PaymentIntentView = {
  id: string;
  invoiceId: string;
  fileId: string | null;
  invoiceNumber: string | null;
  fileNumber: string | null;
  clientName: string | null;
  provider: ProviderName;
  amount: number;
  currency: string;
  status: IntentStatus;
  checkoutUrl: string | null;
  providerReference: string | null;
  expiresAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export type ReconciliationData = {
  counts: {
    pending: number;
    verified: number;
    rejected: number;
    missingReference: number;
  };
  pending: ReconciliationPayment[];
  missingReference: ReconciliationPayment[];
  recentlyResolved: ReconciliationPayment[];
  onlineIntents: PaymentIntentView[];
  outstanding: InvoiceQueueItem[];
  outstandingTotal: number;
  currency: string;
};

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
