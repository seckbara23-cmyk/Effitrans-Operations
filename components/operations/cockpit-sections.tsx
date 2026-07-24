import { getOperationsCockpit } from "@/lib/operations/reader";
import { CockpitSummaryCards } from "./cockpit-summary";
import { CockpitAttentionPanel } from "./cockpit-attention-panel";
import { OperationsQueueCard } from "./operations-queue-card";
import { TransitOverviewCard } from "./transit-overview-card";
import { FinancePipelineCard } from "./finance-pipeline-card";
import { WorkloadPanel } from "./workload-panel";
import { CockpitSectionShell } from "./cockpit-section-shell";
import { ProcessTowerSection } from "@/components/process/process-tower";
import { MessagingSummaryCard } from "@/components/dashboard/messaging-summary-card";
import { DashboardBreakdown } from "@/components/dashboard/dashboard-breakdown";

/**
 * Centre d'Opérations — cockpit sections (Phase 10.0C). Async SERVER component.
 * ---------------------------------------------------------------------------
 * Reads the composition layer ONCE (getOperationsCockpit) and renders every
 * section it authorized. Sections it returned null are omitted (no permission /
 * no data — the reader already decided). Ordered by the ratified hierarchy:
 * immediate attention → today's operational state → department queues → team
 * coordination → supporting breakdowns. This component does NO data aggregation.
 */
export async function CockpitSections() {
  const c = await getOperationsCockpit();

  return (
    <div className="space-y-6">
      {/* Immediate attention */}
      <CockpitSummaryCards indicators={c.summary} />
      {c.alerts && <CockpitAttentionPanel alerts={c.alerts} />}

      {/* Today's operational state */}
      {c.operations && <OperationsQueueCard operations={c.operations} />}
      {c.operations?.processTower && (
        <CockpitSectionShell title="Circuit officiel" subtitle="Étapes du processus en attente d'action.">
          <ProcessTowerSection tower={c.operations.processTower} />
        </CockpitSectionShell>
      )}
      {c.transit && <TransitOverviewCard transit={c.transit} />}

      {/* Department queues — Finance */}
      {c.finance && <FinancePipelineCard finance={c.finance} />}

      {/* Team coordination */}
      {c.workload && <WorkloadPanel workload={c.workload} />}

      {/* Messaging signal (full center lives at /messages) */}
      {c.messaging?.summary && <MessagingSummaryCard summary={c.messaging.summary} />}

      {/* Supporting breakdown — status / transport mode */}
      {c.operations?.files && <DashboardBreakdown overview={c.operations.files} />}
    </div>
  );
}
