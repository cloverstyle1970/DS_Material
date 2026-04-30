import sitesJson from "@/data/sites.json";

export interface SiteRecord {
  id: number;
  name: string;
  companyType: string | null;
  contractType: string | null;
  contractDate: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  primaryInspector: string | null;
  subInspector: string | null;
  subInspector2: string | null;
  sitePhone: string | null;
  siteMobile: string | null;
  fax: string | null;
  managerPhone: string | null;
  managerEmail: string | null;
  address: string | null;
  entryInfo: string | null;
  vendor: string | null;
  customerEmail: string | null;
  jobNo: string | null;
  note: string | null;
  emergencyDevice: string | null;
  emergencyDevices: { number: string; note: string }[] | null;
  warrantyCount: number | null;
  warrantyUnits: string | null;
  warrantyStart: string | null;
  warrantyEnd: string | null;
}

let sites: SiteRecord[] = sitesJson as SiteRecord[];

export function getSites(query?: string): SiteRecord[] {
  if (!query) return sites;
  const q = query.toLowerCase();
  return sites.filter(s =>
    s.name.toLowerCase().includes(q) ||
    (s.primaryInspector?.toLowerCase().includes(q) ?? false) ||
    (s.subInspector?.toLowerCase().includes(q) ?? false) ||
    (s.address?.toLowerCase().includes(q) ?? false) ||
    (s.jobNo?.toLowerCase().includes(q) ?? false) ||
    (s.companyType?.toLowerCase().includes(q) ?? false) ||
    (s.vendor?.toLowerCase().includes(q) ?? false)
  );
}

export function addSite(data: Omit<SiteRecord, "id">): SiteRecord {
  const id = sites.length > 0 ? Math.max(...sites.map(s => s.id)) + 1 : 1;
  const site = { id, ...data };
  sites = [site, ...sites];
  return site;
}

export function updateSite(id: number, patch: Partial<SiteRecord>): SiteRecord | null {
  const idx = sites.findIndex(s => s.id === id);
  if (idx === -1) return null;
  sites[idx] = { ...sites[idx], ...patch };
  return sites[idx];
}

export function deleteSite(id: number): boolean {
  const idx = sites.findIndex(s => s.id === id);
  if (idx === -1) return false;
  sites.splice(idx, 1);
  return true;
}
