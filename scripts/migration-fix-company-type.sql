-- sites.company_type "자사" → "DS" 통일
-- 실행 전: SELECT company_type, count(*) FROM sites GROUP BY company_type;
-- 기대값: TKE=627, 자사=310, null=3

UPDATE sites
SET company_type = 'DS'
WHERE company_type = '자사';

-- 확인
SELECT company_type, COUNT(*) FROM sites GROUP BY company_type ORDER BY company_type;
