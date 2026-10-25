import raw from "../../../data/rooms.json";
import type { Building } from "@campus/core";

const byCode = raw.rooms as Record<string, string[]>;

/** Classroom numbers listed for a building in the public Schedule of Classes. */
export function classroomsFor(building: Pick<Building, "aliases">): string[] {
  for (const alias of building.aliases) {
    const list = byCode[alias];
    if (list?.length) return list;
  }
  return [];
}
