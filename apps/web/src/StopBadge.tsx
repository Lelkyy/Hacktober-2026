/** A stop logo: one line colour, or a 2/3-colour pie when several lines call. */
export function StopBadge({
  colors,
  label,
  size = 28,
  selected = false,
}: {
  colors: string[];
  label?: string;
  size?: number;
  selected?: boolean;
}) {
  return (
    <span className={`stop-badge ${selected ? "on" : ""}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width={size} height={size}>
        {pie(colors)}
        <circle cx="16" cy="16" r="15" fill="none" stroke="#fff" strokeWidth="2" />
        {colors.length === 1 && label ? (
          <text x="16" y="16.5" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={label.length > 2 ? 9 : 11} fontWeight="800">
            {label}
          </text>
        ) : null}
      </svg>
    </span>
  );
}

/** Same logo as a MapLibre marker element. */
export function stopBadgeElement(colors: string[], label?: string, selected = false): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `stop-mark ${selected ? "on" : ""}`;
  el.innerHTML = `<span class="stop-badge ${selected ? "on" : ""}" style="width:28px;height:28px" aria-hidden="true">
    <svg viewBox="0 0 32 32" width="28" height="28">${svgPie(colors)}${
      colors.length === 1 && label
        ? `<text x="16" y="16.5" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="${label.length > 2 ? 9 : 11}" font-weight="800">${escape(label)}</text>`
        : ""
    }</svg></span>`;
  return el;
}

function pie(colors: string[]) {
  return wedges(colors).map((s, i) => <path key={i} d={s.d} fill={s.fill} />);
}

function svgPie(colors: string[]): string {
  return (
    wedges(colors)
      .map((s) => `<path d="${s.d}" fill="${s.fill}"/>`)
      .join("") + `<circle cx="16" cy="16" r="15" fill="none" stroke="#fff" stroke-width="2"/>`
  );
}

function wedges(colors: string[]): { d: string; fill: string }[] {
  const list = colors.slice(0, 3);
  if (list.length <= 1) return [{ d: "M16,1 A15,15 0 1 1 15.999,1 Z", fill: list[0] ?? "#4A6497" }];
  const step = 360 / list.length;
  return list.map((fill, i) => ({ d: wedge(i * step, (i + 1) * step), fill }));
}

function wedge(startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(startDeg, 16);
  const [x2, y2] = polar(endDeg, 16);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M16,16 L${x1},${y1} A16,16 0 ${large} 1 ${x2},${y2} Z`;
}

function polar(deg: number, r: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [Math.round((16 + r * Math.cos(a)) * 100) / 100, Math.round((16 + r * Math.sin(a)) * 100) / 100];
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
