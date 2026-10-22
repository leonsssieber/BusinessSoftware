import type { Comparison } from "./domain/compare";
import type { ExtractedQuote } from "./domain/extract";

export type RfqStatus = "draft" | "open" | "awarded" | "closed" | "cancelled";
export type InvitationStatus = "pending" | "sent" | "viewed" | "quoted" | "declined";

export interface SupplierDto {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  categories: string[];
  notes: string | null;
  archived: boolean;
  createdAt: string;
  stats: { invited: number; quoted: number; won: number; avgResponseHours: number | null };
}

export interface LastPrice {
  unitPrice: number;
  supplierName: string | null;
  date: string;
}

export interface RfqItemDto {
  id: string;
  position: number;
  description: string;
  qty: number;
  unit: string;
  partNumber: string | null;
  notes: string | null;
  allowSubstitutes: boolean;
  lastPaid: LastPrice | null;
}

export interface InvitationDto {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierEmail: string | null;
  contactName: string | null;
  status: InvitationStatus;
  sentAt: string | null;
  viewedAt: string | null;
  respondedAt: string | null;
  lastRemindedAt: string | null;
  reminderCount: number;
  declineReason: string | null;
  portalUrl: string;
}

export interface QuoteLineDto {
  itemId: string;
  unitPrice: number | null;
  leadDays: number | null;
  substitute: string | null;
  note: string | null;
}

export interface QuoteDto {
  id: string;
  supplierId: string;
  supplierName: string;
  source: "portal" | "email" | "manual";
  status: "submitted" | "needs_review";
  freight: number;
  tax: number;
  validUntil: string | null;
  notes: string | null;
  contactName: string | null;
  reference: string | null;
  receivedAt: string;
  late: boolean;
  lines: QuoteLineDto[];
}

export interface PoLineDto {
  itemId: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  substitute: string | null;
  ext: number;
}

export interface PurchaseOrderDto {
  id: string;
  number: number;
  label: string;
  rfqId: string;
  rfqLabel: string;
  rfqTitle: string;
  jobName: string | null;
  siteAddress: string | null;
  needBy: string | null;
  supplierId: string;
  supplierName: string;
  supplierEmail: string | null;
  status: "draft" | "sent";
  subtotal: number;
  freight: number;
  total: number;
  notes: string | null;
  createdAt: string;
  sentAt: string | null;
  lines: PoLineDto[];
}

export interface RfqSummaryDto {
  id: string;
  number: number;
  label: string;
  title: string;
  jobName: string | null;
  status: RfqStatus;
  needBy: string | null;
  dueAt: string | null;
  createdAt: string;
  sentAt: string | null;
  awardedAt: string | null;
  itemCount: number;
  invited: number;
  responded: number;
  quoted: number;
  needsReview: number;
  bestTotal: number | null;
  awardedTotal: number | null;
}

export interface ActivityDto {
  kind: string;
  message: string;
  createdAt: string;
  rfqId?: string | null;
  rfqLabel?: string | null;
}

export interface RfqDetailDto extends RfqSummaryDto {
  siteAddress: string | null;
  notes: string | null;
  items: RfqItemDto[];
  invitations: InvitationDto[];
  quotes: QuoteDto[];
  comparison: Comparison;
  purchaseOrders: PurchaseOrderDto[];
  activity: ActivityDto[];
}

export interface PortalDto {
  company: { name: string; address: string | null; phone: string | null };
  supplier: { name: string; contactName: string | null };
  rfq: {
    label: string;
    title: string;
    jobName: string | null;
    siteAddress: string | null;
    needBy: string | null;
    dueAt: string | null;
    notes: string | null;
    acceptingQuotes: boolean;
  };
  items: { id: string; description: string; qty: number; unit: string; partNumber: string | null; notes: string | null; allowSubstitutes: boolean }[];
  quote: QuoteDto | null;
  declined: boolean;
}

export interface DashboardDto {
  stats: {
    openRequests: number;
    waitingOnSuppliers: number;
    quotesThisMonth: number;
    savedThisMonth: number;
    avgResponseHours: number | null;
  };
  attention: { kind: "review" | "ready" | "overdue" | "draft"; rfqId: string; label: string; message: string }[];
  open: RfqSummaryDto[];
  activity: ActivityDto[];
}

export interface PriceRowDto {
  itemKey: string;
  description: string;
  unit: string;
  lastPaid: LastPrice | null;
  lowest: LastPrice | null;
  observations: number;
  history: { unitPrice: number; date: string; awarded: boolean; supplierName: string | null }[];
}

export interface ExtractResponse extends ExtractedQuote {
  aiAvailable: boolean;
}
