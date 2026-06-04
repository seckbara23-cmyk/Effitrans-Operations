import type { DocType } from "@/lib/documents";
import {
  IconDocument,
  IconList,
  IconShip,
  IconPlane,
  IconCertificate,
  IconShield,
  IconStamp,
  IconCard,
  IconReport,
  IconWorkflow,
  IconTag,
  IconTruck,
  IconCoins,
} from "@/lib/icons";

export const docTypeIcon: Record<
  DocType,
  React.ComponentType<{ className?: string }>
> = {
  invoice: IconDocument,
  packing: IconList,
  bl: IconShip,
  awb: IconPlane,
  origin: IconCertificate,
  sanitary: IconShield,
  tax: IconStamp,
  ninea: IconCard,
  rccm: IconReport,
  mandate: IconWorkflow,
  import_auth: IconShield,
  declaration: IconStamp,
  bae: IconTag,
  delivery: IconTruck,
  insurance: IconCoins,
};

export function DocTypeIcon({
  type,
  className,
}: {
  type: DocType;
  className?: string;
}) {
  const Icon = docTypeIcon[type];
  return <Icon className={className} />;
}
