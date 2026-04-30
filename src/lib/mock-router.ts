// Client-side virtual router for static GitHub Pages deployment.
// Maps /api/* URL patterns to mock-*.ts functions directly, bypassing HTTP.

import { getMaterials, addMaterial, updateStock, updateMaterial } from "./mock-materials";
import { getVendors, addVendor, updateVendor, deleteVendor, VendorType } from "./mock-vendors";
import { supabase } from "./supabase";
import type { SiteRecord } from "./mock-sites";
import type { ElevatorRecord } from "./mock-elevators";
import {
  getCategories, addMajor, updateMajor, deleteMajor,
  addMid, updateMid, deleteMid,
  addSub, updateSub, deleteSub,
} from "./mock-categories";
import { getTransactions, addTransaction } from "./mock-transactions";
import { getMaterialRequests, addMaterialRequest, updateMaterialRequest } from "./mock-material-requests";
import { getPurchaseOrders, addPurchaseOrder, updatePurchaseOrder } from "./mock-purchase-orders";
import { getUsers, addUser, updateUser, deleteUser } from "./mock-users";
import { DashboardStats, RecentRequest } from "./types";

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

export class MockApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MOCK_STATS: DashboardStats = {
  todayRequests: 7,
  pendingRequests: 3,
  lowStockMaterials: 5,
  totalMaterials: 248,
};

const MOCK_REQUESTS: RecentRequest[] = [
  { id: "1", materialName: "도어 클로저",    siteName: "서울중앙빌딩",     hoGiNo: "1호기", userName: "김철수", qty: 1, status: "pending",    requestedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
  { id: "2", materialName: "안전스위치",     siteName: "강남타워",         hoGiNo: "3호기", userName: "이영희", qty: 2, status: "dispatched", requestedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
  { id: "3", materialName: "제어반 기판",    siteName: "부산해운대빌딩",   hoGiNo: "2호기", userName: "박민수", qty: 1, status: "pending",    requestedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString() },
  { id: "4", materialName: "와이어 로프",    siteName: "인천공항물류센터", hoGiNo: "5호기", userName: "최지영", qty: 1, status: "completed",  requestedAt: new Date(Date.now() - 1000 * 60 * 180).toISOString() },
  { id: "5", materialName: "가이드 슈",      siteName: "서울중앙빌딩",     hoGiNo: "2호기", userName: "김철수", qty: 4, status: "pending",    requestedAt: new Date(Date.now() - 1000 * 60 * 240).toISOString() },
];

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
  if (path === "/api/dashboard") return { stats: MOCK_STATS, recentRequests: MOCK_REQUESTS };
  if (path === "/api/materials")         return getMaterials(params.get("q") ?? undefined, (params.get("matType") as "DS" | "TK") || undefined);
  if (path === "/api/categories")        return getCategories();
  if (path === "/api/sites") {
    const { data, error } = await supabase.from("sites").select("*").order("name");
    if (error) throw new MockApiError(error.message, 500);
    return (data ?? []).map(dbToSite);
  }
  if (path === "/api/vendors")           return getVendors(params.get("q") ?? undefined, (params.get("type") as VendorType | "전체") || undefined);
  if (path === "/api/elevators") {
    const site = params.get("site");
    let query = supabase.from("elevators").select("*").order("unit_name");
    if (site) query = query.eq("site_name", site);
    const { data, error } = await query;
    if (error) throw new MockApiError(error.message, 500);
    return (data ?? []).map(dbToElevator);
  }
  if (path === "/api/transactions")      return getTransactions(params.get("type") ?? undefined);
  if (path === "/api/material-requests") return getMaterialRequests(params.get("status") ?? undefined);
  if (path === "/api/purchase-orders")   return getPurchaseOrders(params.get("status") ?? undefined);
  if (path === "/api/users")             return getUsers(params.get("q") ?? undefined);
  throw new MockApiError("Not found", 404);
}

async function routePOST(path: string, body: AnyBody): Promise<unknown> {
  if (path === "/api/materials") return addMaterial(body);
  if (path === "/api/categories") {
    const { level, majorCode, midCode, label } = body;
    if (level === "major") return addMajor(label);
    if (level === "mid")   return addMid(majorCode, label);
    if (level === "sub")   return addSub(majorCode, midCode, label);
    throw new MockApiError("invalid level", 400);
  }
  if (path === "/api/sites") {
    const { data, error } = await supabase.from("sites").insert(siteToDb(body)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToSite(data);
  }
  if (path === "/api/vendors")  return addVendor(body);
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
    const { record, error } = addTransaction(body);
    if (error) throw new MockApiError(error, 400);
    return record;
  }
  if (path === "/api/material-requests") return addMaterialRequest(body);
  if (path === "/api/purchase-orders")   return addPurchaseOrder(body);
  if (path === "/api/users")             return addUser(body);
  throw new MockApiError("Not found", 404);
}

async function routePATCH(path: string, body: AnyBody): Promise<unknown> {
  const materialId = extractId(path, "/api/materials");
  if (materialId) {
    const id = decodeURIComponent(materialId);
    if (Object.keys(body).length === 1 && "stockQty" in body) {
      const updated = updateStock(id, Number(body.stockQty));
      if (!updated) throw new MockApiError("not found", 404);
      return updated;
    }
    const { stockQty, name, alias, modelNo, unit, buyPrice, sellPrice, storageLoc, isRepair } = body;
    const updated = updateMaterial(id, {
      ...(name       !== undefined && { name }),
      ...(alias      !== undefined && { alias:      alias      || null }),
      ...(modelNo    !== undefined && { modelNo:    modelNo    || null }),
      ...(unit       !== undefined && { unit:       unit       || null }),
      ...(buyPrice   !== undefined && { buyPrice:   buyPrice   !== "" ? Number(buyPrice)   : null }),
      ...(sellPrice  !== undefined && { sellPrice:  sellPrice  !== "" ? Number(sellPrice)  : null }),
      ...(storageLoc !== undefined && { storageLoc: storageLoc || null }),
      ...(stockQty   !== undefined && { stockQty:   Number(stockQty) }),
      ...(isRepair   !== undefined && { isRepair }),
    });
    if (!updated) throw new MockApiError("not found", 404);
    return updated;
  }

  if (path === "/api/categories") {
    const { level, majorCode, midCode, code, label } = body;
    if (level === "major") { updateMajor(code, label);           return { ok: true }; }
    if (level === "mid")   { updateMid(majorCode, code, label);  return { ok: true }; }
    if (level === "sub")   { updateSub(majorCode, midCode, code, label); return { ok: true }; }
    throw new MockApiError("invalid level", 400);
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
    const updated = updateVendor(Number(vendorId), body);
    if (!updated) throw new MockApiError("not found", 404);
    return updated;
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
    const request = getMaterialRequests().find(r => r.id === numId);
    if (!request) throw new MockApiError("not found", 404);
    if (action === "처리중") return updateMaterialRequest(numId, { status: "처리중" });
    if (action === "출고처리") {
      const records = [];
      for (const item of request.items) {
        const { record, error } = addTransaction({
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
      const updated = updateMaterialRequest(numId, {
        status: "완료",
        processedAt: new Date().toISOString(),
        processorId,
        processorName,
      });
      return { request: updated, transactions: records };
    }
    if (action === "취소") {
      return updateMaterialRequest(numId, {
        status: "취소",
        processedAt: new Date().toISOString(),
        processorId,
        processorName,
      });
    }
    throw new MockApiError("unknown action", 400);
  }

  const orderId = extractId(path, "/api/purchase-orders");
  if (orderId) {
    const numId = Number(orderId);
    const { action, userId, userName } = body;
    const order = getPurchaseOrders().find(o => o.id === numId);
    if (!order) throw new MockApiError("not found", 404);
    if (action === "입고완료") {
      const { record, error } = addTransaction({
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
      const updated = updatePurchaseOrder(numId, { status: "입고완료", receivedAt: new Date().toISOString() });
      return { order: updated, transaction: record };
    }
    if (action === "취소") return updatePurchaseOrder(numId, { status: "취소" });
    throw new MockApiError("unknown action", 400);
  }

  const userId = extractId(path, "/api/users");
  if (userId) {
    const updated = updateUser(Number(userId), body);
    if (!updated) throw new MockApiError("not found", 404);
    return updated;
  }

  throw new MockApiError("Not found", 404);
}

async function routeDELETE(path: string, body: AnyBody): Promise<unknown> {
  if (path === "/api/categories") {
    const { level, majorCode, midCode, code } = body ?? {};
    if (level === "major") { deleteMajor(code);             return { ok: true }; }
    if (level === "mid")   { deleteMid(majorCode, code);    return { ok: true }; }
    if (level === "sub")   { deleteSub(majorCode, midCode, code); return { ok: true }; }
    throw new MockApiError("invalid level", 400);
  }

  const vendorId = extractId(path, "/api/vendors");
  if (vendorId) {
    if (!deleteVendor(Number(vendorId))) throw new MockApiError("not found", 404);
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
    if (!deleteUser(Number(userId))) throw new MockApiError("not found", 404);
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
