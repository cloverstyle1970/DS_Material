-- 자재별 구입처(매입처) 2개 지정 지원
-- - materials 테이블에 vendor1_id / vendor2_id 컬럼 추가
-- - vendors(id) 참조. 거래처 삭제 시 SET NULL (자재는 유지)
-- - 자재등록/자재수정 폼에서 매입 거래처를 검색·선택하여 저장

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS vendor1_id INTEGER REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor2_id INTEGER REFERENCES public.vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_materials_vendor1_id ON public.materials(vendor1_id);
CREATE INDEX IF NOT EXISTS idx_materials_vendor2_id ON public.materials(vendor2_id);

-- 확인
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'materials'
  AND column_name IN ('vendor1_id', 'vendor2_id')
ORDER BY column_name;
