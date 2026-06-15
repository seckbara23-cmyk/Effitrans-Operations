/**
 * Finance shared types (Phase 1.11). Client + server safe.
 */
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
};

export type PaymentInput = {
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  paidAt?: string | null;
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
};

export type FinanceKpis = {
  outstanding: number;
  overdueCount: number;
  draftCount: number;
  issuedCount: number;
};

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
