/**
 * Pure comparison of two Beds24 calendar snapshots. No I/O, so it is unit-tested.
 *
 * Beds24 returns each room's calendar as ranges ({ from, to, price1, ... }).
 * Snapshots keep those ranges as they came; the comparison expands both to
 * single nights and reports what moved, merged back into readable date runs.
 */

export type CalendarRange = {
  from: string;
  to: string;
  numAvail?: number | null;
  minStay?: number | null;
  override?: string | null;
  price1?: number | null;
};

export type CalendarRoom = { roomId: number; propertyId: number; name?: string; calendar?: CalendarRange[] };

export type Snapshot = { takenAt: string; from: string; to: string; rooms: CalendarRoom[] };

export type Field = "price" | "minStay" | "closed" | "availability";

export type Change = {
  roomId: number;
  propertyId: number;
  room: string;
  field: Field;
  from: string; // first night
  to: string; // last night
  nights: number;
  before: string;
  after: string;
};

type Night = { price: number | null; minStay: number | null; closed: string | null; avail: number | null };

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function nights(room: CalendarRoom, from: string, to: string): Map<string, Night> {
  const out = new Map<string, Night>();
  for (const r of room.calendar ?? []) {
    for (let d = r.from < from ? from : r.from; d <= r.to && d <= to; d = addDays(d, 1)) {
      out.set(d, {
        price: r.price1 ?? null,
        minStay: r.minStay ?? null,
        // "none" means open; anything else (blackout, exclude, ...) closes the night
        closed: r.override && r.override !== "none" ? r.override : null,
        avail: r.numAvail ?? null,
      });
    }
  }
  return out;
}

const show = (field: Field, v: number | string | null) =>
  // No currency symbol: properties can be priced in different currencies.
  v === null ? (field === "closed" ? "open" : "—") : field === "closed" ? `closed (${v})` : String(v);

/**
 * What changed between two snapshots, for nights from `today` on.
 * `explained` holds "<roomId>|<night>" for nights touched by a booking made,
 * changed or cancelled since the last snapshot; availability moves there are
 * normal and not reported.
 */
export function compare(prev: Snapshot, next: Snapshot, today: string, explained: Set<string> = new Set()): Change[] {
  const start = [today, prev.from, next.from].sort().at(-1)!;
  const end = [prev.to, next.to].sort()[0];
  const before = new Map(prev.rooms.map((r) => [r.roomId, r]));
  const changes: Change[] = [];

  for (const room of next.rooms) {
    const old = before.get(room.roomId);
    if (!old) continue; // a new room is not a change to an existing calendar
    const a = nights(old, start, end);
    const b = nights(room, start, end);

    for (const field of ["price", "minStay", "closed", "availability"] as Field[]) {
      const key = field === "availability" ? "avail" : field;
      let run: Change | null = null;
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const x = a.get(d)?.[key as keyof Night] ?? null;
        const y = b.get(d)?.[key as keyof Night] ?? null;
        const moved = x !== y && !(field === "availability" && explained.has(`${room.roomId}|${d}`));
        const label = moved ? [show(field, x), show(field, y)] : null;
        if (label && run && run.before === label[0] && run.after === label[1] && addDays(run.to, 1) === d) {
          run.to = d;
          run.nights++;
          continue;
        }
        if (run) changes.push(run);
        run = label
          ? { roomId: room.roomId, propertyId: room.propertyId, room: room.name || `Room ${room.roomId}`, field, from: d, to: d, nights: 1, before: label[0], after: label[1] }
          : null;
      }
      if (run) changes.push(run);
    }
  }
  return changes;
}

/** Nights a booking occupies: arrival up to the night before departure. */
export function bookedNights(roomId: number, arrival?: string, departure?: string): string[] {
  if (!roomId || !arrival) return [];
  const last = departure && departure > arrival ? addDays(departure, -1) : arrival;
  const out: string[] = [];
  for (let d = arrival; d <= last && out.length < 400; d = addDays(d, 1)) out.push(`${roomId}|${d}`);
  return out;
}

export { addDays };
