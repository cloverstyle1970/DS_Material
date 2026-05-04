// Client-side virtual router for static GitHub Pages deployment.
// Maps /api/* URL patterns to mock-*.ts functions directly, bypassing HTTP.

import { supabase } from "./supabase";
import type { SiteRecord } from "./mock-sites";
import type { ElevatorRecord } from "./mock-elevators";
import type { VendorRecord } from "./mock-vendors";
import type { UserRecord } from "./mock-users";
import type { MaterialRecord } from "./mock-materials";
import type { TransactionRecord } from "./mock-transactions";
import type { CategoryStore } from "./mock-categories";
import type { MaterialRequestRecord } from "./mock-material-requests";
import type { PurchaseOrderRecord } from "./mock-purchase-orders";
import { DashboardStats, RecentRequest } from "./types";
import { generateMaterialCode } from "./category-codes";

// ── 공사일정 모듈 (In-Memory Mock) ─────────────────────────────────
export interface ConstructionRequest {
  id: number;
  status: "요청" | "접수" | "일정등록됨" | "완료";
  siteName: string;
  elevatorName: string;
  requesterName: string;
  details: string;
  requestedAt: string;
}

export interface ConstructionSchedule {
  id: number;
  requestId: number | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  siteName: string;
  elevatorName: string;
  details: string;
  workers: string;
  manager: string;
}

let nextConstReqId = 1;
let nextConstSchedId = 1;
export const mockConstRequests: ConstructionRequest[] = [];
export const mockConstSchedules: ConstructionSchedule[] = [];

// ── Supabase 변환 헬퍼 ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbToSite(r: any): SiteRecord {
  return {
    id:                r.id,
    name:              r.name,
    companyType:       r.company_type       ?? null,
    contractType:      r.contract_type      ?? null,
    contractDate:      r.contract_date      ?? null,
    contractStart:     r.contract_start     ?? null,
    contractEnd:       r.contract_end       ?? null,
    primaryInspector:  r.primary_inspector  ?? null,
    subInspector:      r.sub_inspector      ?? null,
    subInspector2:     r.sub_inspector2     ?? null,
    sitePhone:         r.site_phone         ?? null,
    siteMobile:        r.site_mobile        ?? null,
    fax:               r.fax                ?? null,
    managerPhone:      r.manager_phone      ?? null,
    managerEmail:      r.manager_email      ?? null,
    address:           r.address            ?? null,
    entryInfo:         r.entry_info         ?? null,
    vendor:            r.vendor             ?? null,
    customerEmail:     r.customer_email     ?? null,
    jobNo:             r.job_no             ?? null,
    note:              r.note               ?? null,
    emergencyDevice:   r.emergency_device   ?? null,
    emergencyDevices:  r.emergency_devices  ?? [],
    warrantyCount:     r.warranty_count     ?? null,
    warrantyUnits:     r.warranty_units     ?? null,
    warrantyStart:     r.warranty_start     ?? null,
    warrantyEnd:       r.warranty_end       ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function siteToDb(d: any): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (d.name              !== undefined) obj.name               = d.name;
  if (d.companyType       !== undefined) obj.company_type       = d.companyType;
  if (d.contractType      !== undefined) obj.contract_type      = d.contractType;
  if (d.contractDate      !== undefined) obj.contract_date      = d.contractDate;
  if (d.contractStart     !== undefined) obj.contract_start     = d.contractStart;
  if (d.contractEnd       !== undefined) obj.contract_end       = d.contractEnd;
  if (d.primaryInspector  !== undefined) obj.primary_inspector  = d.primaryInspector;
  if (d.subInspector      !== undefined) obj.sub_inspector      = d.subInspector;
  if (d.subInspector2     !== undefined) obj.sub_inspector2     = d.subInspector2;
  if (d.sitePhone         !== undefined) obj.site_phone         = d.sitePhone;
  if (d.siteMobile        !== undefined) obj.site_mobile        = d.siteMobile;
  if (d.fax               !== undefined) obj.fax                = d.fax;
  if (d.managerPhone      !== undefined) obj.manager_phone      = d.managerPhone;
  if (d.managerEmail      !== undefined) obj.manager_email      = d.managerEmail;
  if (d.address           !== undefined) obj.address            = d.address;
  if (d.entryInfo         !== undefined) obj.entry_info         = d.entryInfo;
  if (d.vendor            !== undefined) obj.vendor             = d.vendor;
  if (d.customerEmail     !== undefined) obj.customer_email     = d.customerEmail;
  if (d.jobNo             !== undefined) obj.job_no             = d.jobNo;
  if (d.note              !== undefined) obj.note               = d.note;
  if (d.emergencyDevice   !== undefined) obj.emergency_device   = d.emergencyDevice;
  if (d.emergencyDevices  !== undefined) obj.emergency_devices  = d.emergencyDevices;
  if (d.warrantyCount     !== undefined) obj.warranty_count     = d.warrantyCount;
  if (d.warrantyUnits     !== undefined) obj.warranty_units     = d.warrantyUnits;
  if (d.warrantyStart     !== undefined) obj.warranty_start     = d.warrantyStart;
  if (d.warrantyEnd       !== undefined) obj.warranty_end       = d.warrantyEnd;
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbToElevator(r: any): ElevatorRecord {
  return {
    id:          r.id,
    siteName:    r.site_name   ?? "",
    unitName:    r.unit_name   ?? null,
    elevatorNo:  r.elevator_no ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function elevatorToDb(d: any): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (d.siteName   !== undefined) obj.site_name   = d.siteName;
  if (d.unitName   !== undefined) obj.unit_name   = d.unitName;
  if (d.elevatorNo !== undefined) obj.elevator_no = d.elevatorNo;
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbToVendor(r: any): VendorRecord {
  return {
    id:              r.id,
    vendorCode:      r.vendor_code      ?? null,
    name:            r.name,
    bizNo:           r.biz_no           ?? null,
    representative:  r.representative   ?? null,
    bizType:         r.biz_type         ?? null,
    bizItem:         r.biz_item         ?? null,
    postalCode:      r.postal_code      ?? null,
    address:         r.address          ?? null,
    phone:           r.phone            ?? null,
    fax:             r.fax              ?? null,
    invoiceManager:  r.invoice_manager  ?? null,
    invoiceEmail:    r.invoice_email    ?? null,
    type:            r.type             ?? "매입",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function vendorToDb(d: any): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (d.vendorCode     !== undefined) obj.vendor_code     = d.vendorCode;
  if (d.name           !== undefined) obj.name            = d.name;
  if (d.bizNo          !== undefined) obj.biz_no          = d.bizNo;
  if (d.representative !== undefined) obj.representative  = d.representative;
  if (d.bizType        !== undefined) obj.biz_type        = d.bizType;
  if (d.bizItem        !== undefined) obj.biz_item        = d.bizItem;
  if (d.postalCode     !== undefined) obj.postal_code     = d.postalCode;
  if (d.address        !== undefined) obj.address         = d.address;
  if (d.phone          !== undefined) obj.phone           = d.phone;
  if (d.fax            !== undefined) obj.fax             = d.fax;
  if (d.invoiceManager !== undefined) obj.invoice_manager = d.invoiceManager;
  if (d.invoiceEmail   !== undefined) obj.invoice_email   = d.invoiceEmail;
  if (d.type           !== undefined) obj.type            = d.type;
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbToUser(r: any): UserRecord {
  return {
    id:          r.id,
    name:        r.name,
    dept:        r.dept        ?? null,
    rank:        r.rank        ?? null,
    ssn:         r.ssn         ?? null,
    cert:        r.cert        ?? null,
    hireDate:    r.hire_date   ?? null,
    resignDate:  r.resign_date ?? null,
    phone:       r.phone       ?? null,
    status:      r.status      ?? null,
    address:     r.address     ?? null,
    permissions: r.permissions ?? [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userToDb(d: any): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (d.id          !== undefined) obj.id          = d.id;
  if (d.name        !== undefined) obj.name        = d.name;
  if (d.dept        !== undefined) obj.dept        = d.dept;
  if (d.rank        !== undefined) obj.rank        = d.rank;
  if (d.ssn         !== undefined) obj.ssn         = d.ssn;
  if (d.cert        !== undefined) obj.cert        = d.cert;
  if (d.hireDate    !== undefined) obj.hire_date   = d.hireDate;
  if (d.resignDate  !== undefined) obj.resign_date = d.resignDate;
  if (d.phone       !== undefined) obj.phone       = d.phone;
  if (d.status      !== undefined) obj.status      = d.status;
  if (d.address     !== undefined) obj.address     = d.address;
  if (d.permissions !== undefined) obj.permissions = d.permissions;
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbToMaterial(r: any): MaterialRecord {
  return {
    id:          r.id,
    categoryCode: r.category_code,
    name:        r.name,
    alias:       r.alias       ?? null,
    modelNo:     r.model_no    ?? null,
    unit:        r.unit        ?? null,
    buyPrice:    r.buy_price   ?? null,
    sellPrice:   r.sell_price  ?? null,
    storageLoc:  r.storage_loc ?? null,
    stockQty:    r.stock_qty,
    isRepair:    r.is_repair,
    eCountCd:    r.e_count_cd  ?? null,
    createdAt:   r.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function materialToDb(d: any): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (d.id           !== undefined) obj.id           = d.id;
  if (d.categoryCode !== undefined) obj.category_code = d.categoryCode;
  if (d.name         !== undefined) obj.name         = d.name;
  if (d.alias        !== undefined) obj.alias        = d.alias;
  if (d.modelNo      !== undefined) obj.model_no     = d.modelNo;
  if (d.unit         !== undefined) obj.unit         = d.unit;
  if (d.buyPrice     !== undefined) obj.buy_price    = d.buyPrice;
  if (d.sellPrice    !== undefined) obj.sell_price   = d.sellPrice;
  if (d.storageLoc   !== undefined) obj.storage_loc  = d.storageLoc;
  if (d.stockQty     !== undefined) obj.stock_qty    = d.stockQty;
  if (d.isRepair     !== undefined) obj.is_repair    = d.isRepair;
  if (d.eCountCd     !== undefined) obj.e_count_cd   = d.eCountCd;
  if (d.createdAt    !== undefined) obj.created_at   = d.createdAt;
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbToTransaction(r: any): TransactionRecord {
  return {
    id:           r.id,
    type:         r.type,
    materialId:   r.material_id,
    materialName: r.material_name,
    qty:          r.qty,
    prevStock:    r.prev_stock,
    afterStock:   r.after_stock,
    siteName:     r.site_name ?? null,
    note:         r.note      ?? null,
    userId:       r.user_id,
    userName:     r.user_name,
    createdAt:    r.created_at,
  };
}

async function supabaseAddTransaction(data: {
  type: "입고" | "출고";
  materialId: string; materialName: string; qty: number;
  siteName: string | null; note: string | null;
  userId: number; userName: string;
}): Promise<{ record?: TransactionRecord; error?: string }> {
  const { data: result, error } = await supabase.rpc("add_transaction", {
    p_type:          data.type,
    p_material_id:   data.materialId,
    p_material_name: data.materialName,
    p_qty:           data.qty,
    p_site_name:     data.siteName,
    p_note:          data.note,
    p_user_id:       data.userId,
    p_user_name:     data.userName,
  });
  if (error) return { error: error.message };
  if (result?.error) return { error: result.error };
  return { record: dbToTransaction(result.record) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbToRequest(r: any): MaterialRequestRecord {
  return {
    id:            r.id,
    status:        r.status,
    siteName:      r.site_name      ?? null,
    items:         r.items          ?? [],
    note:          r.note           ?? null,
    requesterId:   r.requester_id,
    requesterName: r.requester_name,
    requesterDept: r.requester_dept,
    requestedAt:   r.requested_at,
    processedAt:   r.processed_at   ?? null,
    processorId:   r.processor_id   ?? null,
    processorName: r.processor_name ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbToOrder(r: any): PurchaseOrderRecord {
  return {
    id:            r.id,
    status:        r.status,
    materialId:    r.material_id,
    materialName:  r.material_name,
    qty:           r.qty,
    vendorName:    r.vendor_name    ?? null,
    unitPrice:     r.unit_price     ?? null,
    requestId:     r.request_id     ?? null,
    siteName:      r.site_name      ?? null,
    elevatorName:  r.elevator_name  ?? null,
    requesterName: r.requester_name ?? null,
    note:          r.note           ?? null,
    userId:        r.user_id,
    userName:      r.user_name,
    orderedAt:     r.ordered_at,
    receivedAt:    r.received_at    ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function orderToDb(d: any): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (d.materialId    !== undefined) obj.material_id    = d.materialId;
  if (d.materialName  !== undefined) obj.material_name  = d.materialName;
  if (d.qty           !== undefined) obj.qty            = d.qty;
  if (d.vendorName    !== undefined) obj.vendor_name    = d.vendorName;
  if (d.unitPrice     !== undefined) obj.unit_price     = d.unitPrice;
  if (d.requestId     !== undefined) obj.request_id     = d.requestId;
  if (d.siteName      !== undefined) obj.site_name      = d.siteName;
  if (d.elevatorName  !== undefined) obj.elevator_name  = d.elevatorName;
  if (d.requesterName !== undefined) obj.requester_name = d.requesterName;
  if (d.note          !== undefined) obj.note           = d.note;
  if (d.userId        !== undefined) obj.user_id        = d.userId;
  if (d.userName      !== undefined) obj.user_name      = d.userName;
  if (d.status        !== undefined) obj.status         = d.status;
  if (d.receivedAt    !== undefined) obj.received_at    = d.receivedAt;
  return obj;
}

export class MockApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}


function parseUrl(url: string): { path: string; params: URLSearchParams } {
  const [path, qs = ""] = url.split("?");
  return { path, params: new URLSearchParams(qs) };
}

function extractId(path: string, prefix: string): string | null {
  const match = path.match(new RegExp(`^${prefix}/([^/]+)$`));
  return match ? match[1] : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBody = any;

async function routeGET(path: string, params: URLSearchParams): Promise<unknown> {
  if (path === "/api/dashboard") {
    const today = new Date().toISOString().split("T")[0];
    const [todayResult, pendingResult, lowStockResult, totalResult, recentResult, tkeSitesResult, dsSitesResult, elevatorsResult, sitesResult] = await Promise.all([
      supabase.from("material_requests").select("*", { count: "exact", head: true }).gte("requested_at", `${today}T00:00:00`),
      supabase.from("material_requests").select("*", { count: "exact", head: true }).eq("status", "신청"),
      supabase.from("materials").select("*", { count: "exact", head: true }).lte("stock_qty", 0),
      supabase.from("materials").select("*", { count: "exact", head: true }),
      supabase.from("material_requests").select("*").order("requested_at", { ascending: false }).limit(10),
      supabase.from("sites").select("*", { count: "exact", head: true }).eq("company_type", "TKE"),
      supabase.from("sites").select("*", { count: "exact", head: true }).eq("company_type", "DS"),
      supabase.from("elevators").select("*"),
      supabase.from("sites").select("name, company_type")
    ]);
    const tkeSites = tkeSitesResult.count ?? 0;
    const dsSites = dsSitesResult.count ?? 0;
    
    // 실제 등록된 호기 정보로 통계 계산
    const allElevators = elevatorsResult.data ?? [];
    const totalElevators = allElevators.length;
    
    const siteTypeMap = new Map<string, string>();
    (sitesResult.data ?? []).forEach((s: any) => siteTypeMap.set(s.name, s.company_type));

    let tkeElevators = 0;
    let dsElevators = 0;
    let otherElevators = 0;

    allElevators.forEach((e: any) => {
      const type = siteTypeMap.get(e.site_name);
      if (type === "TKE") tkeElevators++;
      else if (type === "DS") dsElevators++;
      else otherElevators++;
    });

    const stats: DashboardStats = {
      todayRequests:     todayResult.count     ?? 0,
      pendingRequests:   pendingResult.count   ?? 0,
      lowStockMaterials: lowStockResult.count  ?? 0,
      totalMaterials:    totalResult.count     ?? 0,
      totalSites:        tkeSites + dsSites,
      tkeSites,
      dsSites,
      totalElevators,
      tkeElevators,
      dsElevators,
      otherElevators,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recentRequests: RecentRequest[] = (recentResult.data ?? []).map((r: any) => ({
      id:           String(r.id),
      materialName: r.items?.[0]?.materialName ?? "자재",
      siteName:     r.site_name      ?? "",
      hoGiNo:       r.items?.[0]?.elevatorName ?? "",
      userName:     r.requester_name,
      qty:          r.items?.[0]?.qty ?? 0,
      status:       r.status === "완료" ? "completed" : r.status === "처리중" ? "dispatched" : ("pending" as const),
      requestedAt:  r.requested_at,
    }));
    return { stats, recentRequests };
  }
  if (path === "/api/materials") {
    const q = params.get("q");
    const matType = params.get("matType") as "DS" | "TK" | null;
    const PAGE = 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let query = supabase.from("materials").select("*").order("name").range(offset, offset + PAGE - 1);
      if (matType === "DS") query = query.like("id", "D%");
      if (matType === "TK") query = query.not("id", "like", "D%");
      const { data, error } = await query;
      if (error) throw new MockApiError(error.message, 500);
      const rows = data ?? [];
      all.push(...rows);
      if (rows.length < PAGE) break;
    }
    let list = all.map(dbToMaterial);
    if (q) {
      const qLower = q.toLowerCase();
      list = list.filter(m =>
        m.name.toLowerCase().includes(qLower) ||
        m.id.toLowerCase().includes(qLower) ||
        (m.alias?.toLowerCase().includes(qLower) ?? false) ||
        (m.modelNo?.toLowerCase().includes(qLower) ?? false) ||
        (m.storageLoc?.toLowerCase().includes(qLower) ?? false)
      );
    }
    return list;
  }
  if (path === "/api/categories") {
    const { data, error } = await supabase.from("categories").select("*").order("major_code").order("mid_code").order("code");
    if (error) throw new MockApiError(error.message, 500);
    const rows = data ?? [];
    const store: CategoryStore = { major: [], mid: {}, sub: {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.filter((r: any) => r.level === "major").forEach((r: any) => {
      store.major.push({ code: r.code, label: r.label });
      store.mid[r.code] = [];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.filter((r: any) => r.level === "mid").forEach((r: any) => {
      if (!store.mid[r.major_code]) store.mid[r.major_code] = [];
      store.mid[r.major_code].push({ code: r.code, label: r.label });
      store.sub[`${r.major_code}${r.code}`] = [];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.filter((r: any) => r.level === "sub").forEach((r: any) => {
      const key = `${r.major_code}${r.mid_code}`;
      if (!store.sub[key]) store.sub[key] = [];
      store.sub[key].push({ code: r.code, label: r.label });
    });
    return store;
  }
  if (path === "/api/sites") {
    const { data, error } = await supabase.from("sites").select("*").order("name");
    if (error) throw new MockApiError(error.message, 500);
    return (data ?? []).map(dbToSite);
  }
  if (path === "/api/vendors") {
    const q    = params.get("q")?.toLowerCase();
    const type = params.get("type") as "매입" | "매출" | "공통" | "전체" | null;
    let query = supabase.from("vendors").select("*").order("name");
    if (type && type !== "전체") query = query.in("type", [type, "공통"]);
    const { data, error } = await query;
    if (error) throw new MockApiError(error.message, 500);
    let list = (data ?? []).map(dbToVendor);
    if (q) list = list.filter(v =>
      v.name.toLowerCase().includes(q) ||
      (v.representative?.toLowerCase().includes(q) ?? false) ||
      (v.address?.toLowerCase().includes(q) ?? false) ||
      (v.phone?.toLowerCase().includes(q) ?? false) ||
      (v.bizNo?.toLowerCase().includes(q) ?? false) ||
      (v.vendorCode?.toLowerCase().includes(q) ?? false)
    );
    return list;
  }
  if (path === "/api/elevators") {
    const site = params.get("site");
    const PAGE = 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let query = supabase.from("elevators").select("*").order("unit_name").range(offset, offset + PAGE - 1);
      if (site) query = query.eq("site_name", site);
      const { data, error } = await query;
      if (error) throw new MockApiError(error.message, 500);
      const rows = data ?? [];
      all.push(...rows);
      if (rows.length < PAGE) break;
    }
    return all.map(dbToElevator);
  }
  if (path === "/api/transactions") {
    const type = params.get("type");
    let query = supabase.from("transactions").select("*").order("created_at", { ascending: false });
    if (type === "입고" || type === "출고") query = query.eq("type", type);
    const { data, error } = await query;
    if (error) throw new MockApiError(error.message, 500);
    return (data ?? []).map(dbToTransaction);
  }
  if (path === "/api/material-requests") {
    const status = params.get("status");
    let query = supabase.from("material_requests").select("*").order("requested_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw new MockApiError(error.message, 500);
    return (data ?? []).map(dbToRequest);
  }
  if (path === "/api/purchase-orders") {
    const status = params.get("status");
    let query = supabase.from("purchase_orders").select("*").order("ordered_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw new MockApiError(error.message, 500);
    return (data ?? []).map(dbToOrder);
  }
  if (path === "/api/users") {
    const q = params.get("q")?.toLowerCase();
    const { data, error } = await supabase.from("users").select("*").order("name");
    if (error) throw new MockApiError(error.message, 500);
    let list = (data ?? []).map(dbToUser);
    if (q) list = list.filter(u =>
      u.name.toLowerCase().includes(q) ||
      (u.dept?.toLowerCase().includes(q) ?? false) ||
      (u.rank?.toLowerCase().includes(q) ?? false) ||
      (u.phone?.includes(q) ?? false) ||
      String(u.id).includes(q)
    );
    return list;
  }
  if (path === "/api/construction-requests") {
    return [...mockConstRequests].reverse();
  }
  if (path === "/api/construction-schedules") {
    return [...mockConstSchedules];
  }
  throw new MockApiError("Not found", 404);
}

async function routePOST(path: string, body: AnyBody): Promise<unknown> {
  if (path === "/api/materials") {
    const { isDs, major, mid, sub, isRepair, name, alias, modelNo, unit, buyPrice, sellPrice, storageLoc, stockQty } = body;

    // 동일 분류 내 최대 일련번호 조회 후 +1 채번
    const prefix = isDs ? "D" : "_";
    const catPrefix = `${prefix}${major}${mid}${sub}`;
    const { data: existing } = await supabase.from("materials").select("id").like("id", `${catPrefix}%`);
    const seqs = (existing ?? [])
      .map((r: { id: string }) => r.id.length === 12 ? parseInt(r.id.slice(7, 11), 10) : NaN)
      .filter(Number.isFinite);
    const seq = seqs.length ? Math.max(...seqs) + 1 : 1;
    if (seq > 9999) throw new MockApiError("일련번호 초과 (최대 9999)", 400);

    const id = generateMaterialCode({ isDs, major, mid, sub, seq, isRepair });
    const row = {
      id,
      category_code: `${major}${mid}${sub}`,
      name,
      alias:       alias      || null,
      model_no:    modelNo    || null,
      unit:        unit       || null,
      buy_price:   buyPrice   !== "" && buyPrice   != null ? Number(buyPrice)  : null,
      sell_price:  sellPrice  !== "" && sellPrice  != null ? Number(sellPrice) : null,
      storage_loc: storageLoc || null,
      stock_qty:   Number(stockQty) || 0,
      is_repair:   isRepair,
    };
    const { data, error } = await supabase.from("materials").insert(row).select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToMaterial(data);
  }
  if (path === "/api/categories") {
    const { level, majorCode, midCode, label } = body;
    if (level === "major") {
      const { data: ex } = await supabase.from("categories").select("code").eq("level", "major");
      const nums = (ex ?? []).map((r: {code: string}) => parseInt(r.code, 10)).filter(Number.isFinite);
      const code = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0");
      const { data, error } = await supabase.from("categories").insert({ level, code, label, major_code: null, mid_code: null }).select().single();
      if (error) throw new MockApiError(error.message, 500);
      return { code: data.code, label: data.label };
    }
    if (level === "mid") {
      const { data: ex } = await supabase.from("categories").select("code").eq("level", "mid").eq("major_code", majorCode);
      const nums = (ex ?? []).map((r: {code: string}) => parseInt(r.code, 10)).filter(Number.isFinite);
      const code = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0");
      const { data, error } = await supabase.from("categories").insert({ level, code, label, major_code: majorCode, mid_code: null }).select().single();
      if (error) throw new MockApiError(error.message, 500);
      return { code: data.code, label: data.label };
    }
    if (level === "sub") {
      const { data: ex } = await supabase.from("categories").select("code").eq("level", "sub").eq("major_code", majorCode).eq("mid_code", midCode);
      const nums = (ex ?? []).map((r: {code: string}) => parseInt(r.code, 10)).filter(Number.isFinite);
      const code = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0");
      const { data, error } = await supabase.from("categories").insert({ level, code, label, major_code: majorCode, mid_code: midCode }).select().single();
      if (error) throw new MockApiError(error.message, 500);
      return { code: data.code, label: data.label };
    }
    throw new MockApiError("invalid level", 400);
  }
  if (path === "/api/sites") {
    const { data, error } = await supabase.from("sites").insert(siteToDb(body)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToSite(data);
  }
  if (path === "/api/vendors") {
    const { data, error } = await supabase.from("vendors").insert(vendorToDb(body)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToVendor(data);
  }
  if (path === "/api/elevators") {
    const { siteName, unitName, elevatorNo } = body;
    if (!siteName) throw new MockApiError("siteName 필수", 400);
    const { data, error } = await supabase.from("elevators")
      .insert({ site_name: siteName, unit_name: unitName || null, elevator_no: elevatorNo || null })
      .select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToElevator(data);
  }
  if (path === "/api/transactions") {
    const { record, error } = await supabaseAddTransaction(body);
    if (error) throw new MockApiError(error, 400);
    return record;
  }
  if (path === "/api/material-requests") {
    const { data, error } = await supabase.from("material_requests").insert({
      status: "신청",
      site_name:      body.siteName      ?? null,
      items:          body.items         ?? [],
      note:           body.note          ?? null,
      requester_id:   body.requesterId,
      requester_name: body.requesterName,
      requester_dept: body.requesterDept,
    }).select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToRequest(data);
  }
  if (path === "/api/purchase-orders") {
    const { data, error } = await supabase.from("purchase_orders").insert(orderToDb(body)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToOrder(data);
  }
  if (path === "/api/users") {
    const { data, error } = await supabase.from("users").insert(userToDb(body)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToUser(data);
  }
  if (path === "/api/construction-requests") {
    const record: ConstructionRequest = {
      id: nextConstReqId++,
      status: "요청",
      siteName: body.siteName || "",
      elevatorName: body.elevatorName || "",
      requesterName: body.requesterName || "",
      details: body.details || "",
      requestedAt: new Date().toISOString()
    };
    mockConstRequests.push(record);
    return record;
  }
  if (path === "/api/construction-schedules") {
    const record: ConstructionSchedule = {
      id: nextConstSchedId++,
      requestId: body.requestId || null,
      startDate: body.startDate,
      endDate: body.endDate || body.startDate,
      siteName: body.siteName || "",
      elevatorName: body.elevatorName || "",
      details: body.details || "",
      workers: body.workers || "",
      manager: body.manager || "",
    };
    mockConstSchedules.push(record);
    
    // 만약 공사요청에서 바로 등록된 경우, 공사요청 상태 변경
    if (record.requestId) {
      const req = mockConstRequests.find(r => r.id === record.requestId);
      if (req) req.status = "일정등록됨";
    }
    return record;
  }
  throw new MockApiError("Not found", 404);
}

async function routePATCH(path: string, body: AnyBody): Promise<unknown> {
  const materialId = extractId(path, "/api/materials");
  if (materialId) {
    const id = decodeURIComponent(materialId);
    const dbId = decodeURIComponent(id);
    if (Object.keys(body).length === 1 && "stockQty" in body) {
      const { data, error } = await supabase.from("materials")
        .update({ stock_qty: Number(body.stockQty) }).eq("id", dbId).select().single();
      if (error) throw new MockApiError(error.message, 500);
      if (!data) throw new MockApiError("not found", 404);
      return dbToMaterial(data);
    }
    const patch: Record<string, unknown> = {};
    const { stockQty, name, alias, modelNo, unit, buyPrice, sellPrice, storageLoc, isRepair } = body;
    if (name       !== undefined) patch.name         = name;
    if (alias      !== undefined) patch.alias        = alias      || null;
    if (modelNo    !== undefined) patch.model_no     = modelNo    || null;
    if (unit       !== undefined) patch.unit         = unit       || null;
    if (buyPrice   !== undefined) patch.buy_price    = buyPrice   !== "" ? Number(buyPrice)  : null;
    if (sellPrice  !== undefined) patch.sell_price   = sellPrice  !== "" ? Number(sellPrice) : null;
    if (storageLoc !== undefined) patch.storage_loc  = storageLoc || null;
    if (stockQty   !== undefined) patch.stock_qty    = Number(stockQty);
    if (isRepair   !== undefined) patch.is_repair    = isRepair;
    const { data, error } = await supabase.from("materials")
      .update(patch).eq("id", dbId).select().single();
    if (error) throw new MockApiError(error.message, 500);
    if (!data) throw new MockApiError("not found", 404);
    return dbToMaterial(data);
  }

  if (path === "/api/categories") {
    const { level, majorCode, midCode, code, label } = body;
    let q = supabase.from("categories").update({ label }).eq("level", level).eq("code", code);
    if (level === "mid" || level === "sub") q = q.eq("major_code", majorCode);
    if (level === "sub") q = q.eq("mid_code", midCode);
    const { error } = await q;
    if (error) throw new MockApiError(error.message, 500);
    return { ok: true };
  }

  const siteId = extractId(path, "/api/sites");
  if (siteId) {
    const { data, error } = await supabase.from("sites")
      .update(siteToDb(body)).eq("id", Number(siteId)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    if (!data) throw new MockApiError("not found", 404);
    return dbToSite(data);
  }

  const vendorId = extractId(path, "/api/vendors");
  if (vendorId) {
    const { data, error } = await supabase.from("vendors")
      .update(vendorToDb(body)).eq("id", Number(vendorId)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    if (!data) throw new MockApiError("not found", 404);
    return dbToVendor(data);
  }

  const elevatorId = extractId(path, "/api/elevators");
  if (elevatorId) {
    const { data, error } = await supabase.from("elevators")
      .update(elevatorToDb(body)).eq("id", Number(elevatorId)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    if (!data) throw new MockApiError("Not found", 404);
    return dbToElevator(data);
  }

  const reqId = extractId(path, "/api/material-requests");
  if (reqId) {
    const numId = Number(reqId);
    const { action, processorId, processorName } = body;
    if (action === "처리중") {
      const { data, error } = await supabase.from("material_requests")
        .update({ status: "처리중" }).eq("id", numId).select().single();
      if (error) throw new MockApiError(error.message, 500);
      return dbToRequest(data);
    }
    if (action === "출고처리") {
      const { data: req, error: fetchErr } = await supabase.from("material_requests")
        .select("*").eq("id", numId).single();
      if (fetchErr || !req) throw new MockApiError("not found", 404);
      const request = dbToRequest(req);
      const records = [];
      for (const item of request.items) {
        const { record, error } = await supabaseAddTransaction({
          type: "출고",
          materialId: item.materialId,
          materialName: item.materialName,
          qty: item.qty,
          siteName: request.siteName,
          note: `신청 #${numId} 출고처리${item.elevatorName ? ` (${item.elevatorName})` : ""}`,
          userId: processorId,
          userName: processorName,
        });
        if (error) throw new MockApiError(error, 400);
        records.push(record);
      }
      const { data: updated, error: updateErr } = await supabase.from("material_requests")
        .update({ status: "완료", processed_at: new Date().toISOString(), processor_id: processorId, processor_name: processorName })
        .eq("id", numId).select().single();
      if (updateErr) throw new MockApiError(updateErr.message, 500);
      return { request: dbToRequest(updated), transactions: records };
    }
    if (action === "취소") {
      const { data, error } = await supabase.from("material_requests")
        .update({ status: "취소", processed_at: new Date().toISOString(), processor_id: processorId, processor_name: processorName })
        .eq("id", numId).select().single();
      if (error) throw new MockApiError(error.message, 500);
      return dbToRequest(data);
    }
    throw new MockApiError("unknown action", 400);
  }

  const orderId = extractId(path, "/api/purchase-orders");
  if (orderId) {
    const numId = Number(orderId);
    const { action, userId, userName } = body;
    if (action === "입고완료") {
      const { data: ord, error: fetchErr } = await supabase.from("purchase_orders")
        .select("*").eq("id", numId).single();
      if (fetchErr || !ord) throw new MockApiError("not found", 404);
      const order = dbToOrder(ord);
      const { record, error } = await supabaseAddTransaction({
        type: "입고",
        materialId: order.materialId,
        materialName: order.materialName,
        qty: order.qty,
        siteName: null,
        note: `발주 #${numId} 입고완료`,
        userId,
        userName,
      });
      if (error) throw new MockApiError(error, 400);
      const { data: updated, error: updateErr } = await supabase.from("purchase_orders")
        .update({ status: "입고완료", received_at: new Date().toISOString() })
        .eq("id", numId).select().single();
      if (updateErr) throw new MockApiError(updateErr.message, 500);
      return { order: dbToOrder(updated), transaction: record };
    }
    if (action === "취소") {
      const { data, error } = await supabase.from("purchase_orders")
        .update({ status: "취소" }).eq("id", numId).select().single();
      if (error) throw new MockApiError(error.message, 500);
      return dbToOrder(data);
    }
    if (action === "수정") {
      const patch: Record<string, unknown> = {};
      if (body.qty !== undefined) patch.qty = Number(body.qty);
      if (body.siteName !== undefined) patch.site_name = body.siteName || null;
      if (body.elevatorName !== undefined) patch.elevator_name = body.elevatorName || null;
      if (body.vendorName !== undefined) patch.vendor_name = body.vendorName || null;
      if (body.unitPrice !== undefined) patch.unit_price = body.unitPrice ? Number(body.unitPrice) : null;
      if (body.note !== undefined) patch.note = body.note || null;
      if (body.requesterName !== undefined) patch.requester_name = body.requesterName || null;

      const { data, error } = await supabase.from("purchase_orders")
        .update(patch).eq("id", numId).select().single();
      if (error) throw new MockApiError(error.message, 500);
      return dbToOrder(data);
    }
    throw new MockApiError("unknown action", 400);
  }

  const userId = extractId(path, "/api/users");
  if (userId) {
    const { data, error } = await supabase.from("users")
      .update(userToDb(body)).eq("id", Number(userId)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    if (!data) throw new MockApiError("not found", 404);
    return dbToUser(data);
  }

  const txId = extractId(path, "/api/transactions");
  if (txId) {
    const numId = Number(txId);
    const { qty, siteName, note, userName } = body;
    const { data: tx, error: fetchErr } = await supabase.from("transactions").select("*").eq("id", numId).single();
    if (fetchErr || !tx) throw new MockApiError("not found", 404);
    
    const patch: Record<string, unknown> = {};
    if (siteName !== undefined) patch.site_name = siteName || null;
    if (note !== undefined) patch.note = note || null;
    if (userName !== undefined) patch.user_name = userName;

    if (qty !== undefined) {
      const newQty = Number(qty);
      const diff = newQty - tx.qty;
      if (diff !== 0) {
        const { data: mat, error: mErr } = await supabase.from("materials").select("stock_qty").eq("id", tx.material_id).single();
        if (mErr || !mat) throw new MockApiError("material not found", 404);
        
        let newStock = mat.stock_qty;
        if (tx.type === "입고") newStock += diff;
        else if (tx.type === "출고") newStock -= diff;

        await supabase.from("materials").update({ stock_qty: newStock }).eq("id", tx.material_id);
        patch.qty = newQty;
        patch.after_stock = tx.prev_stock + (tx.type === "입고" ? newQty : -newQty);
      }
    }

    const { data, error } = await supabase.from("transactions").update(patch).eq("id", numId).select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToTransaction(data);
  }

  const constReqEditId = extractId(path, "/api/construction-requests");
  if (constReqEditId) {
    const idx = mockConstRequests.findIndex(r => r.id === Number(constReqEditId));
    if (idx === -1) throw new MockApiError("not found", 404);
    const { siteName, elevatorName, details } = body;
    if (siteName !== undefined) mockConstRequests[idx].siteName = siteName;
    if (elevatorName !== undefined) mockConstRequests[idx].elevatorName = elevatorName;
    if (details !== undefined) mockConstRequests[idx].details = details;
    return mockConstRequests[idx];
  }

  throw new MockApiError("Not found", 404);
}

async function routeDELETE(path: string, body: AnyBody): Promise<unknown> {
  if (path === "/api/categories") {
    const { level, majorCode, midCode, code } = body ?? {};
    if (level === "major") {
      await supabase.from("categories").delete().eq("level", "sub").eq("major_code", code);
      await supabase.from("categories").delete().eq("level", "mid").eq("major_code", code);
      const { error } = await supabase.from("categories").delete().eq("level", "major").eq("code", code);
      if (error) throw new MockApiError(error.message, 500);
    } else if (level === "mid") {
      await supabase.from("categories").delete().eq("level", "sub").eq("major_code", majorCode).eq("mid_code", code);
      const { error } = await supabase.from("categories").delete().eq("level", "mid").eq("major_code", majorCode).eq("code", code);
      if (error) throw new MockApiError(error.message, 500);
    } else if (level === "sub") {
      const { error } = await supabase.from("categories").delete().eq("level", "sub").eq("major_code", majorCode).eq("mid_code", midCode).eq("code", code);
      if (error) throw new MockApiError(error.message, 500);
    } else throw new MockApiError("invalid level", 400);
    return { ok: true };
  }

  const matReqId = extractId(path, "/api/material-requests");
  if (matReqId) {
    const { error } = await supabase.from("material_requests").delete().eq("id", Number(matReqId));
    if (error) throw new MockApiError(error.message, 500);
    return { ok: true };
  }

  const vendorId = extractId(path, "/api/vendors");
  if (vendorId) {
    const { error } = await supabase.from("vendors").delete().eq("id", Number(vendorId));
    if (error) throw new MockApiError(error.message, 500);
    return { ok: true };
  }

  const siteId = extractId(path, "/api/sites");
  if (siteId) {
    const { error } = await supabase.from("sites").delete().eq("id", Number(siteId));
    if (error) throw new MockApiError(error.message, 500);
    return { ok: true };
  }

  const elevatorId = extractId(path, "/api/elevators");
  if (elevatorId) {
    const { error } = await supabase.from("elevators").delete().eq("id", Number(elevatorId));
    if (error) throw new MockApiError(error.message, 500);
    return { ok: true };
  }

  const userId = extractId(path, "/api/users");
  if (userId) {
    const { error } = await supabase.from("users").delete().eq("id", Number(userId));
    if (error) throw new MockApiError(error.message, 500);
    return { ok: true };
  }

  const txId = extractId(path, "/api/transactions");
  if (txId) {
    const numId = Number(txId);
    const { data: tx, error: fetchErr } = await supabase.from("transactions").select("*").eq("id", numId).single();
    if (fetchErr || !tx) throw new MockApiError("not found", 404);

    // 재고 원복
    const { data: mat, error: mErr } = await supabase.from("materials").select("stock_qty").eq("id", tx.material_id).single();
    if (mErr || !mat) throw new MockApiError("material not found", 404);
    
    let newStock = mat.stock_qty;
    if (tx.type === "입고") newStock -= tx.qty;
    else if (tx.type === "출고") newStock += tx.qty;
    await supabase.from("materials").update({ stock_qty: newStock }).eq("id", tx.material_id);

    // 발주/신청 상태 원복
    if (tx.note) {
      const ordMatch = tx.note.match(/발주 #(\d+) 입고완료/);
      if (ordMatch) {
        await supabase.from("purchase_orders").update({ status: "발주", received_at: null }).eq("id", Number(ordMatch[1]));
      }
      const reqMatch = tx.note.match(/신청 #(\d+) 출고처리/);
      if (reqMatch) {
        await supabase.from("material_requests").update({ status: "처리중" }).eq("id", Number(reqMatch[1]));
      }
    }

    const { error } = await supabase.from("transactions").delete().eq("id", numId);
    if (error) throw new MockApiError(error.message, 500);
    return { ok: true };
  }

  const constSchedId = extractId(path, "/api/construction-schedules");
  if (constSchedId) {
    const idx = mockConstSchedules.findIndex(s => s.id === Number(constSchedId));
    if (idx === -1) throw new MockApiError("not found", 404);
    const deleted = mockConstSchedules.splice(idx, 1)[0];
    if (deleted.requestId) {
      const req = mockConstRequests.find(r => r.id === deleted.requestId);
      if (req && req.status === "일정등록됨") req.status = "요청";
    }
    return { ok: true };
  }
  const constReqId = extractId(path, "/api/construction-requests");
  if (constReqId) {
    const idx = mockConstRequests.findIndex(r => r.id === Number(constReqId));
    if (idx === -1) throw new MockApiError("not found", 404);
    mockConstRequests.splice(idx, 1);
    return { ok: true };
  }

  throw new MockApiError("Not found", 404);
}

export const mockRouter = {
  get<T>(url: string): Promise<T> {
    const { path, params } = parseUrl(url);
    return routeGET(path, params) as Promise<T>;
  },
  post<T>(url: string, body: unknown): Promise<T> {
    const { path } = parseUrl(url);
    return routePOST(path, body) as Promise<T>;
  },
  patch<T>(url: string, body: unknown): Promise<T> {
    const { path } = parseUrl(url);
    return routePATCH(path, body) as Promise<T>;
  },
  put<T>(url: string, body: unknown): Promise<T> {
    const { path } = parseUrl(url);
    return routePATCH(path, body) as Promise<T>;
  },
  delete<T>(url: string, body?: unknown): Promise<T> {
    const { path } = parseUrl(url);
    return routeDELETE(path, body) as Promise<T>;
  },
};
