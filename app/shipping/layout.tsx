import { ShippingNav } from "@/components/shipping/shipping-nav";

/**
 * Ocean Shipping workspace layout (Phase 7.2C). Wraps every /shipping route with the shared
 * sub-navigation + breadcrumb so no implemented surface is unreachable or orphaned. Nested
 * inside the app shell; adds routing/composition only (no data, no auth — each page gates
 * itself).
 */
export default function ShippingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fade-in">
      <ShippingNav />
      {children}
    </div>
  );
}
