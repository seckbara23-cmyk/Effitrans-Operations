import "server-only";

/**
 * Social master → PNG (Brand Center social hardening). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Rasterizes THE SAME CommunicationSpec the SVG serializer consumes — computed
 * once by composeCommunication — through Next's bundled `next/og` engine
 * (satori + resvg; ships inside Next 14, NO new dependency). Never a browser
 * screenshot: the layout is the governed spec, the engine only paints it.
 *
 * The spec's absolute geometry maps 1:1 onto absolutely-positioned elements:
 * rect → div, image → img (objectFit contain, like preserveAspectRatio meet),
 * text → div at the spec's TOP coordinate with lineHeight 1. Fonts: the
 * engine's bundled Noto Sans (weights are approximated by the single face —
 * the vector master remains the typographically exact artifact; the PNG is the
 * platform-upload convenience at EXACT template dimensions).
 *
 * Windows note: next/og's compiled bundle resolves its wasm/font assets with a
 * POSIX path trick that throws in plain Node on Windows. It works in the Next
 * runtime and on Linux (CI, Vercel) — the test suite therefore proves PNG
 * bytes in CI and self-skips locally on Windows, exactly like the RLS suites.
 */
import type { CommunicationModel } from "./model";
import { composeCommunication, type CommunicationSpec } from "./svg";

type OgNode = { type: string; props: Record<string, unknown> };

/** The spec, as a satori element tree. Exported for the no-drift tests. */
export function specToOgTree(spec: CommunicationSpec): OgNode {
  const children: OgNode[] = spec.items.map((it) => {
    if (it.t === "rect") {
      return {
        type: "div",
        props: {
          style: {
            position: "absolute", left: it.x, top: it.y, width: it.w, height: it.h,
            backgroundColor: it.fill, opacity: it.opacity ?? 1, display: "flex",
          },
        },
      };
    }
    if (it.t === "image") {
      return {
        type: "img",
        props: {
          src: it.href, alt: it.alt,
          style: { position: "absolute", left: it.x, top: it.y, width: it.w, height: it.h, objectFit: "contain", objectPosition: "left center" },
        },
      };
    }
    return {
      type: "div",
      props: {
        style: {
          position: "absolute", left: it.x, top: it.top, fontSize: it.size,
          fontWeight: it.weight, color: it.fill, opacity: it.opacity ?? 1,
          lineHeight: 1, whiteSpace: "nowrap", display: "flex",
        },
        children: it.text,
      },
    };
  });
  return {
    type: "div",
    props: {
      style: {
        width: "100%", height: "100%", position: "relative", display: "flex",
        backgroundColor: spec.background,
      },
      children,
    },
  };
}

/** Rasterize a social master at EXACT template dimensions. */
export async function renderCommunicationPng(m: CommunicationModel): Promise<Uint8Array> {
  const spec = composeCommunication(m);
  const { ImageResponse } = await import("next/og");
  const res = new ImageResponse(specToOgTree(spec) as never, {
    width: spec.width,
    height: spec.height,
  });
  return new Uint8Array(await res.arrayBuffer());
}
