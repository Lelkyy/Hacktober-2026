import type { LineBadge } from "./lineColor.ts";

/**
 * A transit stop: a round pin with a bus (or trolley) inside, ringed in the colours of the lines
 * that call there (one arc per line). Its lines' names sit beside it as chips once you're zoomed in
 * or the stop is selected, so it's clear which buses stop here without opening it.
 */

/** Inside of every stop pin: dark, so the white bus reads at any size and the line colours ring it. */
const PIN_FILL = "#1d2b22";
/** Chips beside a pin before the rest collapse into "+N". */
const MAX_CHIPS = 4;

/** The pin itself (no chips), as SVG markup in a 32×32 box. */
function pinSvg(lines: LineBadge[], size: number): string {
  const colors = lines.length ? lines.map((l) => l.color) : ["#4A6497"];
  const r = 12.5;
  const around = 2 * Math.PI * r;
  const each = around / colors.length;
  const gap = colors.length > 1 ? 1.6 : 0;
  // Arcs start at the top and go clockwise.
  const arcs = colors
    .map(
      (c, i) =>
        `<circle cx="16" cy="16" r="${r}" fill="none" stroke="${escape(c)}" stroke-width="5" ` +
        `stroke-dasharray="${(each - gap).toFixed(2)} ${(around - each + gap).toFixed(2)}" ` +
        `stroke-dashoffset="${(-i * each).toFixed(2)}" transform="rotate(-90 16 16)"/>`,
    )
    .join("");
  const trolley = lines.length > 0 && lines.every((l) => l.mode === "trolley");
  return `<svg class="stop-pin" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="16" cy="16" r="15.5" fill="#fff"/>
    ${arcs}
    <circle cx="16" cy="16" r="9.6" fill="${PIN_FILL}"/>
    ${trolley ? TROLLEY_GLYPH : BUS_GLYPH}
  </svg>`;
}

/** A bus from the front: body, windscreen, headlights, wheels. */
const BUS_GLYPH = `<g fill="#fff">
  <rect x="11.6" y="10.2" width="8.8" height="10" rx="1.8"/>
  <rect x="12.9" y="11.6" width="6.2" height="3.6" rx="0.7" fill="${PIN_FILL}"/>
  <circle cx="13.6" cy="18" r="0.75" fill="${PIN_FILL}"/>
  <circle cx="18.4" cy="18" r="0.75" fill="${PIN_FILL}"/>
  <rect x="12.4" y="20" width="2" height="1.8" rx="0.6"/>
  <rect x="17.6" y="20" width="2" height="1.8" rx="0.6"/>
</g>`;

/** A trolley from the front: pantograph, body, windscreen, wheels. */
const TROLLEY_GLYPH = `<g fill="#fff">
  <path d="M13.8 8.6h4.4M16 8.6v2" stroke="#fff" stroke-width="1.1" stroke-linecap="round" fill="none"/>
  <rect x="11.6" y="10.6" width="8.8" height="9.4" rx="2.2"/>
  <rect x="12.9" y="12" width="6.2" height="3.4" rx="0.7" fill="${PIN_FILL}"/>
  <path d="M13 21.6l1-1.6M19 21.6l-1-1.6" stroke="#fff" stroke-width="1.1" stroke-linecap="round" fill="none"/>
</g>`;

/** The lines' names, in their colours, with "+N" for any beyond the first few. */
function chipsHtml(lines: LineBadge[]): string {
  const named = lines.filter((l) => l.mark);
  if (!named.length) return "";
  const shown = named.slice(0, MAX_CHIPS);
  const more = named.length - shown.length;
  return (
    `<span class="stop-chips" aria-hidden="true">` +
    shown.map((l) => `<span class="stop-chip" style="--chip:${escape(l.color)}">${escape(l.mark)}</span>`).join("") +
    (more > 0 ? `<span class="stop-chip more">+${more}</span>` : "") +
    `</span>`
  );
}

/** The stop pin for the stop's panel heading. */
export function StopBadge({ lines, size = 28 }: { lines: LineBadge[]; size?: number }) {
  return <span className="stop-badge" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: pinSvg(lines, size) }} />;
}

/**
 * Map marker for a stop, centred on it: the pin, an arrow for the way buses face as they arrive
 * (`approach`, degrees from north; left off when lines disagree), and the lines' chips when `labels`.
 */
export function stopBadgeElement(lines: LineBadge[], selected = false, approach?: number, size = 24, labels = false): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `stop-mark ${selected ? "on" : ""}`;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.setProperty("--size", `${size}px`);
  if (approach !== undefined) el.dataset.approach = String(approach);
  const arrow = approach !== undefined ? `<span class="stop-approach" style="--heading:${approach}deg" aria-hidden="true"></span>` : "";
  el.innerHTML = `${arrow}<span class="stop-badge">${pinSvg(lines, size)}</span>${labels || selected ? chipsHtml(lines) : ""}`;
  return el;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
