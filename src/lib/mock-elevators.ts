import elevatorsJson from "@/data/elevators.json";

export interface ElevatorRecord {
  id: number;
  siteName: string;
  unitName: string | null;
  elevatorNo: string | null;
}

const elevators: ElevatorRecord[] = elevatorsJson as ElevatorRecord[];

function sortByUnitName(list: ElevatorRecord[]): ElevatorRecord[] {
  return [...list].sort((a, b) =>
    (a.unitName ?? "").localeCompare(b.unitName ?? "", "ko", { numeric: true, sensitivity: "base" })
  );
}

export function getElevators(siteName?: string): ElevatorRecord[] {
  const list = siteName ? elevators.filter(e => e.siteName === siteName) : elevators;
  return sortByUnitName(list);
}

export function getAllElevators(): ElevatorRecord[] {
  return sortByUnitName(elevators);
}

export function addElevator(data: Omit<ElevatorRecord, "id">): ElevatorRecord {
  const id = elevators.length > 0 ? Math.max(...elevators.map(e => e.id)) + 1 : 1;
  const record: ElevatorRecord = { id, ...data };
  elevators.push(record);
  return record;
}

export function updateElevator(id: number, patch: Partial<Omit<ElevatorRecord, "id">>): ElevatorRecord | null {
  const idx = elevators.findIndex(e => e.id === id);
  if (idx < 0) return null;
  elevators[idx] = { ...elevators[idx], ...patch };
  return elevators[idx];
}

export function deleteElevator(id: number): boolean {
  const idx = elevators.findIndex(e => e.id === id);
  if (idx < 0) return false;
  elevators.splice(idx, 1);
  return true;
}
