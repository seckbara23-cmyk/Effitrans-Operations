import type { SVGProps } from "react";

/**
 * A small, consistent set of line icons (1.6px stroke) drawn in-house so the
 * product stays free of childish or mismatched icon packs. All inherit
 * `currentColor` and a 24px viewBox.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={20}
      height={20}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconTower(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3v4" />
      <path d="M8 7h8l-1 13H9L8 7Z" />
      <path d="M6 10h12" />
      <path d="M5 7l-2 2m18-2 2 2" />
    </Base>
  );
}

/** Phase 5.0E-3C — marks "Mon Travail" as THE primary destination. Nothing else. */
export function IconStar(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />
    </Base>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.5" />
      <path d="M18 14a6 6 0 0 1 3 5" />
    </Base>
  );
}

export function IconContainer(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="7" width="18" height="11" rx="1" />
      <path d="M7 7v11M11 7v11M15 7v11M19 7v11" />
      <path d="M5 18v2M19 18v2" />
    </Base>
  );
}

export function IconStamp(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 3h6a2 2 0 0 1 2 2c0 1.5-1 2.5-1.5 4-.3 1 .5 2 1.5 2H7c1 0 1.8-1 1.5-2C8 7.5 7 6.5 7 5a2 2 0 0 1 2-2Z" />
      <path d="M5 17h14" />
      <rect x="4" y="19" width="16" height="2" rx="1" />
    </Base>
  );
}

export function IconDocument(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </Base>
  );
}

export function IconTask(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="m8.5 12 2.2 2.2L16 9" />
    </Base>
  );
}

export function IconFinance(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 20h18" />
      <path d="M6 20V10M11 20V5M16 20v-7M20 20V8" />
    </Base>
  );
}

export function IconReport(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Base>
  );
}

export function IconGear(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </Base>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </Base>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
      <path d="M10.5 19a1.8 1.8 0 0 0 3 0" />
    </Base>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Base>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Base>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m9 6 6 6-6 6" />
    </Base>
  );
}

export function IconShip(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 18c1.5 1.2 3 1.2 4.5 0 1.5 1.2 3 1.2 4.5 0 1.5 1.2 3 1.2 4.5 0 1.5 1.2 3 1.2 4.5 0" />
      <path d="M5 15l1.5-4.5a1 1 0 0 1 1-.7h9a1 1 0 0 1 1 .7L19 15" />
      <path d="M12 4v6M9 7h6" />
    </Base>
  );
}

export function IconPlane(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10 4 4 14h4l2 6 2-6 2 2 2-2-2-2 4 1-2-7-6 1-2-3Z" />
    </Base>
  );
}

export function IconTruck(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 6h11v9H3z" />
      <path d="M14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </Base>
  );
}

export function IconBuilding(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16" />
      <path d="M14 9h4a1 1 0 0 1 1 1v11" />
      <path d="M3 21h18" />
      <path d="M8 8h2M8 12h2M8 16h2" />
    </Base>
  );
}

export function IconContact(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="10" r="2.2" />
      <path d="M8.5 16a3.5 3.5 0 0 1 7 0" />
      <path d="M4 8h2M4 16h2" />
    </Base>
  );
}

export function IconHistory(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </Base>
  );
}

export function IconRoute(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8 18h6a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h6" />
    </Base>
  );
}

export function IconPin(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Base>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Base>
  );
}

export function IconBlock(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6.5 6.5 11 11" />
    </Base>
  );
}

export function IconQuote(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h4M9 16h6" />
      <path d="M12.5 10.5h-1.8a1.2 1.2 0 0 0 0 2.4h1a1.2 1.2 0 0 1 0 2.4H9" />
    </Base>
  );
}

export function IconCard(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h3" />
    </Base>
  );
}

export function IconScale(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3v18" />
      <path d="M7 21h10" />
      <path d="M5 6h14" />
      <path d="m5 6-2.5 5a3 3 0 0 0 5 0L5 6Z" />
      <path d="m19 6-2.5 5a3 3 0 0 0 5 0L19 6Z" />
    </Base>
  );
}

export function IconCoins(props: IconProps) {
  return (
    <Base {...props}>
      <ellipse cx="9" cy="7" rx="6" ry="2.6" />
      <path d="M3 7v5c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V7" />
      <path d="M9 14.6V17c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6v-5c0-1.4-2.7-2.6-6-2.6" />
    </Base>
  );
}

export function IconWorkflow(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="6" height="5" rx="1" />
      <rect x="15" y="15" width="6" height="5" rx="1" />
      <path d="M6 9v3a3 3 0 0 0 3 3h6" />
    </Base>
  );
}

export function IconTag(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" />
      <circle cx="8" cy="8" r="1.4" />
    </Base>
  );
}

export function IconShield(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
      <path d="m9.5 12 1.8 1.8L15 10" />
    </Base>
  );
}

export function IconCertificate(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="4" width="16" height="12" rx="1.5" />
      <path d="M7 8h10M7 11h6" />
      <circle cx="12" cy="17" r="2.5" />
      <path d="m10.5 19-1 3 2.5-1.4L14.5 22l-1-3" />
    </Base>
  );
}

export function IconDepartment(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-2h12v2" />
    </Base>
  );
}

export function IconList(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </Base>
  );
}

/** Install / download-to-device glyph (Phase 8.5 compact PWA install control). */
export function IconInstall(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 16.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" />
    </Base>
  );
}
