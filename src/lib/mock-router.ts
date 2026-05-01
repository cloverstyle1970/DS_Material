// Client-side virtual router for static GitHub Pages deployment.
// Maps /api/* URL patterns to mock-*.ts functions directly, bypassing HTTP.

import { supabase } from "./supabase";
import type { SiteRecord } from "./mock-sites";
import type { ElevatorRecord } from "./mock-elevators";
import type { VendorRecord } from "./mock-vendors";
import type { UserRecord } from "./mock-users";
import type { MaterialRecord } from "./mock-materials";
import type { TransactionRecord } from "./mock-transactions";
import {
  getCategories, addMajor, updateMajor, deleteMajor,
  addMid, updateMid, deleteMid,
  addSub, updateSub, deleteSub,
} from "./mock-categories";
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
  if (path === "/api/materials") {
    const q = params.get("q");
    const matType = params.get("matType") as "DS" | "TK" | null;
    let query = supabase.from("materials").select("*").order("name");
    if (matType === "DS") query = query.like("id", "D%");
    if (matType === "TK") query = query.not("id", "like", "D%");
    const { data, error } = await query;
    if (error) throw new MockApiError(error.message, 500);
    let list = (data ?? []).map(dbToMaterial);
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
  if (path === "/api/categories")        return getCategories();
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
    let query = supabase.from("elevators").select("*").order("unit_name");
    if (site) query = query.eq("site_name", site);
    const { data, error } = await query;
    if (error) throw new MockApiError(error.message, 500);
    return (data ?? []).map(dbToElevator);
  }
  if (path === "/api/transactions") {
    const type = params.get("type");
    let query = supabase.from("transactions").select("*").order("created_at", { ascending: false });
    if (type === "입고" || type === "출고") query = query.eq("type", type);
    const { data, error } = await query;
    if (error) throw new MockApiError(error.message, 500);
    return (data ?? []).map(dbToTransaction);
  }
  if (path === "/api/material-requests") return getMaterialRequests(params.get("status") ?? undefined);
  if (path === "/api/purchase-orders")   return getPurchaseOrders(params.get("status") ?? undefined);
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
  throw new MockApiError("Not found", 404);
}

async function routePOST(path: string, body: AnyBody): Promise<unknown> {
  if (path === "/api/materials") {
    const { data, error } = await supabase.from("materials").insert(materialToDb(body)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToMaterial(data);
  }
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
  if (path === "/api/material-requests") return addMaterialRequest(body);
  if (path === "/api/purchase-orders")   return addPurchaseOrder(body);
  if (path === "/api/users") {
    const { data, error } = await supabase.from("users").insert(userToDb(body)).select().single();
    if (error) throw new MockApiError(error.message, 500);
    return dbToUser(data);
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
    const request = getMaterialRequests().find(r => r.id === numId);
    if (!request) throw new MockApiError("not found", 404);
    if (action === "처리중") return updateMaterialRequest(numId, { status: "처리중" });
    if (action === "출고처리") {
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
      const updated = updatePurchaseOrder(numId, { status: "입고완료", receivedAt: new Date().toISOString() });
      return { order: updated, transaction: record };
    }
    if (action === "취소") return updatePurchaseOrder(numId, { status: "취소" });
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
