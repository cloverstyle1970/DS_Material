-- 인센티브 내역 기록 테이블
-- 회계/세무 > 인센티브 페이지에서 사용
-- 파생값(Nego/순수자재비/인센티브)은 저장하지 않고 클라이언트에서 재계산:
--   Nego(40%) = (quote - fixed) * 0.4
--   순수자재비 = material - Nego
--   인센티브   = 순수자재비 * 0.02
--
-- 회사 × 지역 매트릭스 (앱 상수):
--   DS: 화정, 일산, 파주, 기타
--   TK: 화정, 일산, 파주

create table if not exists public.incentive_records (
  id          uuid primary key default gen_random_uuid(),
  month       text not null,                        -- YYYY-MM
  issue_date  date,                                 -- 계산서·입금표 발행일 (기록 근거)
  company     text not null default '',             -- 회사 (DS/TK)
  region      text not null default '',             -- 지역 (화정/일산/파주/기타)
  site        text not null default '',             -- 현장명 (managed_sites 참조)
  contract    text not null default '',             -- 계약 내역
  quote       numeric(14,2) not null default 0,     -- 견적가
  fixed       numeric(14,2) not null default 0,     -- 확정가
  material    numeric(14,2) not null default 0,     -- 자재비
  manager     text not null default '',             -- 담당자
  remark      text not null default '',             -- 비고
  sort_order  integer not null default 0,           -- 월·회사·지역 내 표시 순서
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- idempotent 컬럼 추가 (기존 스키마 호환)
alter table public.incentive_records
  add column if not exists company    text not null default '';
alter table public.incentive_records
  add column if not exists region     text not null default '';
alter table public.incentive_records
  add column if not exists issue_date date;

create index if not exists idx_incentive_records_month
  on public.incentive_records(month, company, region, sort_order);

-- updated_at 자동 갱신 트리거
create or replace function public.tg_incentive_records_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_incentive_records_touch on public.incentive_records;
create trigger trg_incentive_records_touch
  before update on public.incentive_records
  for each row execute function public.tg_incentive_records_touch();

-- RLS (개발 단계 표준: 전체 허용)
alter table public.incentive_records enable row level security;

drop policy if exists allow_all_incentive_records on public.incentive_records;
create policy allow_all_incentive_records on public.incentive_records
  for all using (true) with check (true);

-- 검증
select
  'incentive_records' as table_name,
  (select count(*) from public.incentive_records) as row_count,
  (select count(*) from pg_indexes where schemaname='public' and tablename='incentive_records') as index_count;
