import type { LngLat } from "@campus/core";

/**
 * Where you are. Follows you as soon as the browser allows it (from the start,
 * if you allowed it before), and asks for permission the first time a request needs it.
 */
export class Location {
  private at: LngLat | null = null;
  private watching = false;
  private denied = false;

  constructor(
    /** Campus [west, south, east, north]: farther away, routes can't start from you. */
    private readonly bbox: [number, number, number, number],
    private readonly onMove: (at: LngLat) => void,
  ) {}

  /** Start following without asking, if the browser already allows it. */
  async start(): Promise<void> {
    // ?at=-117.2376,32.8811 pretends you're there: for demos and testing away from campus.
    const fake = new URLSearchParams(location.search).get("at")?.split(",").map(Number);
    if (fake?.length === 2 && fake.every(Number.isFinite)) {
      this.moved([fake[0], fake[1]]);
      this.watching = true;
      return;
    }
    if (!navigator.geolocation || !navigator.permissions) return;
    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      if (status.state === "granted") this.follow();
      if (status.state === "denied") this.denied = true;
      status.onchange = () => {
        this.denied = status.state === "denied";
        if (status.state === "granted") this.follow();
      };
    } catch {
      // No permissions API: wait for the first request.
    }
  }

  /** Where you are now, asking for permission if needed. Null when unknown or denied. */
  async get(): Promise<LngLat | null> {
    if (this.at) return this.at;
    if (this.denied || !navigator.geolocation) return null;
    const at = await new Promise<LngLat | null>((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) => resolve([p.coords.longitude, p.coords.latitude]),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) this.denied = true;
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
      ),
    );
    if (at) {
      this.moved(at);
      this.follow();
    }
    return at;
  }

  onCampus(at: LngLat): boolean {
    const [w, s, e, n] = this.bbox;
    return at[0] >= w && at[0] <= e && at[1] >= s && at[1] <= n;
  }

  private follow(): void {
    if (this.watching) return;
    this.watching = true;
    navigator.geolocation.watchPosition(
      (p) => this.moved([p.coords.longitude, p.coords.latitude]),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
  }

  private moved(at: LngLat): void {
    this.at = at;
    this.onMove(at);
  }
}
