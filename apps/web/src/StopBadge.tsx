import type { LineBadge } from "./lineColor.ts";

let clipSeq = 0;

/** One square. Several lines share it as side-by-side color stripes. A single line also shows its name. */
export function StopBadge({
  lines,
  size = 28,
  selected = false,
}: {
  lines: LineBadge[];
  size?: number;
  selected?: boolean;
}) {
  const list = lines.length ? lines : [{ color: "#4A6497", mark: "", short: "" }];
  const id = `stop-sq-${++clipSeq}`;
  const mark = list.length === 1 ? list[0].mark : "";
  const font = mark.length > 2 ? 9 : 11;
  return (
    <span className={`stop-badge ${selected ? "on" : ""}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width={size} height={size}>
        <defs>
          <clipPath id={id}>
            <rect x="1" y="1" width="30" height="30" rx="5" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${id})`}>{bandRects(list.map((l) => l.color)).map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} />)}</g>
        <rect x="1" y="1" width="30" height="30" rx="5" fill="none" stroke="#fff" strokeWidth="2" />
        {mark ? (
          <text x="16" y="16.5" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={font} fontWeight="800">
            {mark}
          </text>
        ) : null}
      </svg>
    </span>
  );
}

/**
 * Map marker. Several lines share one striped square until the stop is clicked, then they open
 * into named squares side by side. The marker stays centered on the stop either way.
 * `approach` is the way a bus faces as it arrives (degrees from north).
 */
export function stopBadgeElement(lines: LineBadge[], selected = false, approach?: number, size = 28): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `stop-mark ${selected ? "on" : ""}`;
  el.style.height = `${size}px`;
  const list = lines.length ? lines : [{ color: "#4A6497", mark: "", short: "" }];
  const expand = selected && list.length > 1;
  const gap = 3;
  el.style.width = expand ? `${list.length * size + (list.length - 1) * gap}px` : `${size}px`;
  if (approach !== undefined) {
    el.dataset.approach = String(approach);
    el.style.setProperty("--line", list[0]?.color ?? "#243024");
  }
  const arrow = approach !== undefined ? `<span class="stop-approach" style="--heading:${approach}deg" aria-hidden="true"></span>` : "";
  if (expand) {
    const squares = list.map((line) => squareSvg(line.color, line.mark, size)).join("");
    el.innerHTML = `<span class="stop-logos on">${arrow}${squares}</span>`;
    return el;
  }
  const id = `stop-sq-${++clipSeq}`;
  const mark = list.length === 1 ? list[0].mark : "";
  const font = mark.length > 2 ? (size < 26 ? 8 : 9) : 11;
  const text = mark
    ? `<text x="16" y="16.5" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="${font}" font-weight="800">${escape(mark)}</text>`
    : "";
  const bands = bandRects(list.map((l) => l.color))
    .map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${escape(b.fill)}"/>`)
    .join("");
  el.innerHTML = `<span class="stop-badge ${selected ? "on" : ""}" style="width:${size}px;height:${size}px" aria-hidden="true">
    ${arrow}
    <svg viewBox="0 0 32 32" width="${size}" height="${size}">
      <defs><clipPath id="${id}"><rect x="1" y="1" width="30" height="30" rx="5"/></clipPath></defs>
      <g clip-path="url(#${id})">${bands}</g>
      <rect x="1" y="1" width="30" height="30" rx="5" fill="none" stroke="#fff" stroke-width="2"/>
      ${text}
    </svg></span>`;
  return el;
}

function squareSvg(color: string, mark: string, size: number): string {
  const id = `stop-sq-${++clipSeq}`;
  const font = mark.length > 2 ? (size < 26 ? 8 : 9) : 11;
  const text = mark
    ? `<text x="16" y="16.5" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="${font}" font-weight="800">${escape(mark)}</text>`
    : "";
  return `<span class="stop-badge" style="width:${size}px;height:${size}px" aria-hidden="true">
    <svg viewBox="0 0 32 32" width="${size}" height="${size}">
      <defs><clipPath id="${id}"><rect x="1" y="1" width="30" height="30" rx="5"/></clipPath></defs>
      <g clip-path="url(#${id})"><rect x="0" y="0" width="32" height="32" fill="${escape(color)}"/></g>
      <rect x="1" y="1" width="30" height="30" rx="5" fill="none" stroke="#fff" stroke-width="2"/>
      ${text}
    </svg></span>`;
}

function bandRects(colors: string[]): { x: number; y: number; w: number; h: number; fill: string }[] {
  const list = colors.length ? colors : ["#4A6497"];
  if (list.length === 1) return [{ x: 0, y: 0, w: 32, h: 32, fill: list[0] }];
  const w = 32 / list.length;
  return list.map((c, i) => ({ x: i * w, y: 0, w, h: 32, fill: c }));
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
