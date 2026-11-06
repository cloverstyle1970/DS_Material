-- ============================================================
-- TK/DS 현장수·관리대수 차이 원인 분석
-- 자재관리(639) vs 유지보수(621) = 18개 차이
-- Supabase Dashboard → SQL Editor 에서 실행
-- ============================================================

-- 1) company_type 전체 값 분포 (어떤 값들이 있는지 확인)
SELECT
  COALESCE(company_type, '(NULL)') AS company_type,
  COUNT(*)                         AS site_count
FROM managed_sites
GROUP BY company_type
ORDER BY site_count DESC;

-- ============================================================
-- 2) TK 현장 중 team_id 배정 여부 (유지보수가 필터하는지 확인)
SELECT
  CASE WHEN team_id IS NULL THEN '팀 미배정' ELSE '팀 배정' END AS team_status,
  COUNT(*) AS site_count,
  SUM(elev.elev_cnt) AS elev_count
FROM managed_sites ms
LEFT JOIN (
  SELECT site_id, COUNT(*) AS elev_cnt
  FROM site_elevators
  GROUP BY site_id
) elev ON elev.site_id = ms.id
WHERE ms.company_type = 'TK'
GROUP BY (team_id IS NULL)
ORDER BY team_status;

-- ============================================================
-- 3) 팀 미배정 TK 현장 목록 (어떤 현장들이 차이를 만드는지)
SELECT
  ms.id,
  ms.site_name,
  ms.company_type,
  ms.team_id,
  COUNT(se.id) AS elev_count
FROM managed_sites ms
LEFT JOIN site_elevators se ON se.site_id = ms.id
WHERE ms.company_type = 'TK'
  AND ms.team_id IS NULL
GROUP BY ms.id, ms.site_name, ms.company_type, ms.team_id
ORDER BY ms.site_name;

-- ============================================================
-- 4) DS + 자사 합산 현황 (DS 측 비교용)
SELECT
  company_type,
  COUNT(*) AS site_count,
  (
    SELECT COUNT(*) FROM site_elevators se
    WHERE se.site_id = ANY(
      ARRAY(SELECT id FROM managed_sites WHERE company_type = ms_outer.company_type)
    )
  ) AS elev_count
FROM managed_sites ms_outer
WHERE company_type IN ('TK', 'DS', '자사')
GROUP BY company_type
ORDER BY site_count DESC;

-- ============================================================
-- 5) 최종 요약 (자재관리 기준 집계)
SELECT
  CASE
    WHEN company_type = 'TK'          THEN 'TK'
    WHEN company_type IN ('DS','자사') THEN 'DS'
    ELSE '기타(' || COALESCE(company_type, 'NULL') || ')'
  END AS 구분,
  COUNT(DISTINCT ms.id)   AS 현장수,
  COUNT(se.id)            AS 관리대수
FROM managed_sites ms
LEFT JOIN site_elevators se ON se.site_id = ms.id
GROUP BY 구분
ORDER BY 현장수 DESC;
