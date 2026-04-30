import vendorsJson from "@/data/vendors.json";

export type VendorType = "매입" | "매출" | "공통";

export interface VendorRecord {
  id: number;
  vendorCode: string | null;
  name: string;
  bizNo: string | null;
  representative: string | null;
  bizType: string | null;
  bizItem: string | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  invoiceManager: string | null;
  invoiceEmail: string | null;
  type: VendorType;
}

const vendors: VendorRecord[] = vendorsJson as VendorRecord[];

export function getVendors(query?: string, type?: VendorType | "전체"): VendorRecord[] {
  let list = vendors;
  if (type && type !== "전체") {
    list = list.filter(v => v.type === type || v.type === "공통");
  }
  if (!query) return list;
  const q = query.trim().toLowerCase();
  return list.filter(v =>
    v.name.toLowerCase().includes(q) ||
    (v.representative?.toLowerCase().includes(q) ?? false) ||
    (v.address?.toLowerCase().includes(q) ?? false) ||
    (v.phone?.toLowerCase().includes(q) ?? false) ||
    (v.bizNo?.toLowerCase().includes(q) ?? false) ||
    (v.vendorCode?.toLowerCase().includes(q) ?? false)
  );
}

let nextId = vendors.length + 1;

export function addVendor(data: Omit<VendorRecord, "id">): VendorRecord {
  const record = { id: nextId++, ...data };
  vendors.push(record);
  return record;
}

export function updateVendor(id: number, patch: Partial<VendorRecord>): VendorRecord | null {
  const idx = vendors.findIndex(v => v.id === id);
  if (idx === -1) return null;
  vendors[idx] = { ...vendors[idx], ...patch };
  return vendors[idx];
}

export function deleteVendor(id: number): boolean {
  const idx = vendors.findIndex(v => v.id === id);
  if (idx === -1) return false;
  vendors.splice(idx, 1);
  return true;
}
