import { describe, it, expect } from "vitest";
import { assembleCopilotContext, type AssembleInput, type CopilotAccess } from "@/lib/copilot/context";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import type { FileDetail } from "@/lib/files/types";
import type { DocumentItem } from "@/lib/documents/types";
import type { CustomsRecord } from "@/lib/customs/types";
import type { TransportRecord } from "@/lib/transport/types";
import type { FinanceForFile } from "@/lib/finance/types";
import type { TaskListItem } from "@/lib/tasks/types";
import type { DossierSla } from "@/lib/sla/service";

const FILE: FileDetail = {
  id: "file-1",
  tenantId: "tenant-1",
  fileNumber: "IMP-2026-001",
  type: "IMP",
  clientId: "client-1",
  clientName: "ACME SARL",
  status: "IN_PROGRESS",
  priority: "high",
  openedAt: "2026-06-01T08:00:00.000Z",
  createdAt: "2026-05-30T08:00:00.000Z",
  shipment: {
    transportMode: "SEA",
    incoterm: "CIF",
    origin: "Shanghai",
    destination: "Dakar",
    cargoType: "Électronique",
    carrierName: "Maersk",
    vesselOrFlight: "Vessel X",
    blAwbRef: "BL123",
    containerRef: "CONT456",
  },
  history: [],
};

const DOCS: DocumentItem[] = [
  { typeCode: "INVOICE", typeLabel: "Facture", status: "APPROVED", expiryDate: null, sharedWithClient: true } as DocumentItem,
  { typeCode: "PACKING", typeLabel: "Liste de colisage", status: "UPLOADED", expiryDate: null, sharedWithClient: false } as DocumentItem,
  { typeCode: "PACKING", typeLabel: "Liste de colisage", status: "PENDING_REVIEW", expiryDate: null, sharedWithClient: false } as DocumentItem,
];

function lifecycleFor(file: FileDetail): ReturnType<typeof getDossierLifecycle> {
  return getDossierLifecycle({
    fileId: file.id,
    file: { status: file.status, type: file.type },
    documents: DOCS.map((d) => ({ status: d.status })),
    missingRequired: [{ label: "Connaissement" }],
    customs: { status: "DECLARED", required: true },
    transport: { status: "PLANNED" },
    invoices: [],
    podApproved: false,
  });
}

const FULL_ACCESS: CopilotAccess = {
  documents: true,
  customs: true,
  transport: true,
  finance: true,
  tasks: true,
};

function baseInput(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    file: FILE,
    access: FULL_ACCESS,
    lifecycle: lifecycleFor(FILE),
    openHandoff: null,
    documents: DOCS,
    missingDocuments: [{ code: "BL", label: "Connaissement" }],
    customs: { status: "DECLARED", required: true, declarationNumber: "D-99", customsOffice: "Dakar Port" } as CustomsRecord,
    missingCustomsDocuments: [{ code: "X", label: "Certificat origine" }],
    transport: { status: "PLANNED", driverName: "Mr Diop", deliveryLocation: "Pikine" } as TransportRecord,
    finance: {
      hasIssued: true,
      outstanding: 1500,
      invoices: [
        { invoiceNumber: "F-1", status: "ISSUED", currency: "XOF", total: 2000, paid: 500, balance: 1500, overdue: true, dueDate: "2026-06-10" },
      ],
    } as unknown as FinanceForFile,
    tasks: [
      { title: "Vérifier BL", status: "TODO", priority: "HIGH", dueAt: "2026-06-20", assignedToEmail: "a@b.com" } as TaskListItem,
      { title: "Clore", status: "DONE", priority: "LOW", dueAt: null, assignedToEmail: null } as TaskListItem,
    ],
    sla: {
      stage: { currentDepartment: "customs", currentStage: "customs_declaration", enteredAt: null, ageHours: 50, ageDays: 2 },
      status: "warning",
      threshold: { warningHours: 72, criticalHours: 144 },
    } as DossierSla,
    ...overrides,
  };
}

describe("assembleCopilotContext — dossier mapping", () => {
  it("maps the dossier header and shipment fields", () => {
    const ctx = assembleCopilotContext(baseInput());
    expect(ctx.dossier.fileNumber).toBe("IMP-2026-001");
    expect(ctx.dossier.type).toBe("IMP");
    expect(ctx.dossier.clientName).toBe("ACME SARL");
    expect(ctx.dossier.origin).toBe("Shanghai");
    expect(ctx.dossier.destination).toBe("Dakar");
    expect(ctx.dossier.containerRef).toBe("CONT456");
  });

  it("tolerates a null shipment", () => {
    const ctx = assembleCopilotContext(baseInput({ file: { ...FILE, shipment: null } }));
    expect(ctx.dossier.transportMode).toBeNull();
    expect(ctx.dossier.origin).toBeNull();
  });
});

describe("assembleCopilotContext — documents packaging", () => {
  it("counts approved and pending-review documents and maps missing required", () => {
    const ctx = assembleCopilotContext(baseInput());
    expect(ctx.documents.included).toBe(true);
    if (!ctx.documents.included) return;
    expect(ctx.documents.data.total).toBe(3);
    expect(ctx.documents.data.approved).toBe(1);
    expect(ctx.documents.data.pendingReview).toBe(2);
    expect(ctx.documents.data.missingRequired).toEqual(["Connaissement"]);
  });
});

describe("assembleCopilotContext — tasks packaging", () => {
  it("counts open (TODO/IN_PROGRESS/BLOCKED) tasks", () => {
    const ctx = assembleCopilotContext(baseInput());
    if (!ctx.tasks.included) throw new Error("tasks should be included");
    expect(ctx.tasks.data.total).toBe(2);
    expect(ctx.tasks.data.open).toBe(1);
  });
});

describe("assembleCopilotContext — permission gating", () => {
  it("omits sections the caller cannot read (no data leaked)", () => {
    const ctx = assembleCopilotContext(
      baseInput({ access: { documents: false, customs: false, transport: false, finance: true, tasks: false } }),
    );
    expect(ctx.documents.included).toBe(false);
    expect(ctx.customs.included).toBe(false);
    expect(ctx.transport.included).toBe(false);
    expect(ctx.tasks.included).toBe(false);
    expect(ctx.finance.included).toBe(true);
    // A non-included section exposes no `data` field at all.
    expect((ctx.documents as { data?: unknown }).data).toBeUndefined();
  });
});

describe("assembleCopilotContext — sla section", () => {
  it("includes SLA when present", () => {
    const ctx = assembleCopilotContext(baseInput());
    if (!ctx.sla.included) throw new Error("sla should be included");
    expect(ctx.sla.data.status).toBe("warning");
    expect(ctx.sla.data.department).toBe("customs");
    expect(ctx.sla.data.warningHours).toBe(72);
  });

  it("marks SLA not-included when absent", () => {
    const ctx = assembleCopilotContext(baseInput({ sla: null }));
    expect(ctx.sla.included).toBe(false);
  });
});

describe("assembleCopilotContext — customs/transport presence", () => {
  it("flags absent customs/transport records as present:false", () => {
    const ctx = assembleCopilotContext(baseInput({ customs: null, transport: null }));
    if (!ctx.customs.included || !ctx.transport.included) throw new Error("sections gated by access only");
    expect(ctx.customs.data.present).toBe(false);
    expect(ctx.transport.data.present).toBe(false);
  });
});
