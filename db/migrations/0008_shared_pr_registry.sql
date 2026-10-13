-- Source-owned dependencies remain enforceable even before the prerequisite
-- repository is imported. No FK or import order can silently drop a gate.
ALTER TABLE roadmap_units ADD COLUMN external_dependencies JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(external_dependencies)='array');
ALTER TABLE roadmap_units ADD COLUMN external_prerequisites JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(external_prerequisites)='array');
ALTER TABLE roadmap_units ADD COLUMN source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(source_metadata)='object');
CREATE FUNCTION registry_prerequisites_satisfied(target_repository BIGINT,target_unit TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
  SELECT COALESCE((SELECT jsonb_array_length(w.external_prerequisites)=0 AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(w.external_dependencies) d(value)
    LEFT JOIN repositories r ON r.full_name=d.value->>'repository'
    LEFT JOIN roadmap_units p ON p.repository_id=r.repository_id AND p.unit_id=d.value->>'unitId'
    WHERE p.unit_id IS NULL OR p.approved IS NOT TRUE OR p.state NOT IN ('MERGED','ACCEPTED')
  ) FROM roadmap_units w WHERE w.repository_id=target_repository AND w.unit_id=target_unit),FALSE)
$$;
