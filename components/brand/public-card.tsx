/**
 * Public digital business card (DBC-3). SERVER component — no client JS, no trackers.
 * ---------------------------------------------------------------------------
 * Renders the public-safe CardModel. Everything comes from the Brand Center; no tenant/
 * user/db id is present. The whistleblower URL is only a "Report Confidentially" button
 * href, never visible text. Downloads (vCard / QR PNG) are native links to public routes —
 * no authentication. Accessible: semantic headings, alt text, keyboard-native links,
 * high-contrast on the employee's own palette.
 */
import type { CardModel } from "@/lib/brand/card/model";

function digits(v: string): string {
  return v.replace(/[^0-9+]/g, "");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "block", padding: "4px 0" }}>
      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7280" }}>{label}</span>
      <div style={{ fontSize: 15 }}>{children}</div>
    </div>
  );
}

export function PublicCard({ card, token, qrSvg }: { card: CardModel; token: string; qrSvg: string }) {
  const { company, employee, colors } = card;
  const link = (href: string, text: string) => (
    <a href={href} style={{ color: colors.green, textDecoration: "none" }}>{text}</a>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#f1f5f9", padding: "24px 16px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", color: colors.anthracite }}>
      <article style={{ maxWidth: 480, margin: "0 auto", background: "#ffffff", borderRadius: 16, overflow: "hidden", boxShadow: "0 8px 30px rgba(0,0,0,0.08)" }}>
        <header style={{ background: colors.green, color: "#ffffff", padding: "22px 20px", textAlign: "center" }}>
          {company.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt={company.logoAlt} height={40} style={{ display: "inline-block", marginBottom: 10, maxWidth: "70%" }} />
          )}
          {employee.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={employee.photoUrl} alt={`Photo de ${employee.name}`} width={84} height={84} style={{ display: "block", margin: "6px auto 0", borderRadius: "50%", border: "3px solid rgba(255,255,255,0.6)", objectFit: "cover" }} />
          )}
          <h1 style={{ margin: "10px 0 2px", fontSize: 22 }}>{employee.name}</h1>
          {employee.title && <p style={{ margin: 0, fontSize: 14, opacity: 0.95 }}>{employee.title}</p>}
          {employee.department && <p style={{ margin: 0, fontSize: 12, opacity: 0.85 }}>{employee.department}</p>}
          <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 700 }}>{company.name}</p>
        </header>

        <section style={{ padding: "16px 20px" }} aria-label="Coordonnées">
          {employee.phoneOffice && <Row label="Bureau">{link(`tel:${digits(employee.phoneOffice)}`, employee.phoneOffice)}</Row>}
          {employee.phoneMobile && <Row label="Mobile">{link(`tel:${digits(employee.phoneMobile)}`, employee.phoneMobile)}</Row>}
          {employee.whatsapp && <Row label="WhatsApp">{link(`https://wa.me/${digits(employee.whatsapp)}`, employee.whatsapp)}</Row>}
          <Row label="E-mail">{link(`mailto:${employee.email}`, employee.email)}</Row>
          {company.website && <Row label="Site web">{link(company.website, company.website.replace(/^https?:\/\//, ""))}</Row>}
          {company.address && <Row label="Adresse">{company.address}</Row>}
        </section>

        {card.memberships.length > 0 && (
          <section style={{ padding: "0 20px 12px" }} aria-label="Réseaux internationaux">
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7280", marginBottom: 6 }}>Réseaux</div>
            <div>
              {card.memberships.map((m) =>
                m.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={m.name} src={m.logoUrl} alt={m.logoAlt} height={26} style={{ display: "inline-block", marginRight: 12, verticalAlign: "middle" }} />
                ) : (
                  <span key={m.name} style={{ display: "inline-block", marginRight: 12, fontSize: 12, color: "#6b7280" }}>{m.name}</span>
                ),
              )}
            </div>
          </section>
        )}

        <section style={{ padding: "8px 20px 16px", textAlign: "center" }} aria-label="Actions">
          <div dangerouslySetInnerHTML={{ __html: qrSvg }} style={{ width: 150, height: 150, margin: "0 auto 10px" }} aria-label={`QR code vers la carte de ${employee.name}`} role="img" />
          <a href={`/card/${token}/vcard`} style={{ display: "inline-block", margin: 4, padding: "9px 14px", background: colors.green, color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>Ajouter aux contacts (vCard)</a>
          <a href={`/card/${token}/qr.png`} style={{ display: "inline-block", margin: 4, padding: "9px 14px", border: `1px solid ${colors.green}`, color: colors.green, borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>Télécharger le QR</a>
        </section>

        {card.compliance.portalUrl && (
          <section style={{ padding: "0 20px 16px", textAlign: "center" }} aria-label="Conformité">
            <div style={{ fontSize: 12, fontWeight: 700 }}>{card.compliance.title}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>{card.compliance.subtitle}</div>
            <a href={card.compliance.portalUrl} style={{ display: "inline-block", padding: "7px 14px", background: colors.anthracite, color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 12, fontWeight: 700 }}>{card.compliance.buttonLabel}</a>
          </section>
        )}

        <footer style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: colors.green }}>{card.sustainability}</p>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: "#6b7280" }}>{company.footer}</p>
        </footer>
      </article>
    </main>
  );
}
