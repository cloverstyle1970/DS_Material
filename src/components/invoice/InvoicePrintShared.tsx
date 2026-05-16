"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface InvoiceRow {
  id: number;
  invoice_no: string;
  quote_id: number;
  invoice_type: "세금계산서" | "거래명세서";
  issued_at: string;
  issued_by_name: string | null;
  status: "발행" | "취소";
  supply_amount: number;
  vat_amount: number;
  total_amount: number;
  customer_name: string | null;
  customer_biz_no: string | null;
  site_name: string | null;
  note: string | null;
}

export interface QuoteForInvoice {
  id: number;
  quote_no: string;
  quote_date: string;
  site_name: string | null;
  elevator_name: string | null;
  work_title: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  total_amount: number;
}

export interface QuoteItemForInvoice {
  id: number;
  material_id: string | null;
  material_name: string;
  spec: string | null;
  unit: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  remark: string | null;
  elevator_name: string | null;
}

export interface CompanyInfo {
  company_name: string | null;
  company_biz_no: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_ceo: string | null;
}

export function useInvoiceData(invoiceId: number) {
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [quote, setQuote]     = useState<QuoteForInvoice | null>(null);
  const [items, setItems]     = useState<QuoteItemForInvoice[]>([]);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (!Number.isFinite(invoiceId)) { setError("잘못된 ID"); setLoading(false); return; }
    (async () => {
      setLoading(true);
      const inv = await supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
      if (inv.error || !inv.data) { setError(`발행 정보 로드 실패: ${inv.error?.message ?? "not found"}`); setLoading(false); return; }
      const i = inv.data as InvoiceRow;
      setInvoice(i);
      const [q, it, c] = await Promise.all([
        supabase.from("quotes")
          .select("id, quote_no, quote_date, site_name, elevator_name, work_title, customer_name, customer_phone, total_amount")
          .eq("id", i.quote_id).maybeSingle(),
        supabase.from("quote_items").select("*").eq("quote_id", i.quote_id).order("sort_order"),
        supabase.from("quote_settings")
          .select("company_name, company_biz_no, company_address, company_phone, company_email, company_ceo")
          .eq("id", 1).maybeSingle(),
      ]);
      setQuote((q.data ?? null) as QuoteForInvoice | null);
      setItems((it.data ?? []) as QuoteItemForInvoice[]);
      setCompany((c.data ?? null) as CompanyInfo | null);
      setLoading(false);
    })();
  }, [invoiceId]);

  return { invoice, quote, items, company, loading, error };
}

export function fmtNum(n: number): string { return n.toLocaleString(); }
export function fmtDate(iso: string): string {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}년 ${m[2]}월 ${m[3]}일` : String(iso);
}
