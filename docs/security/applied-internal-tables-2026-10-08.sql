-- Applied to production Blog with explicit owner approval.
-- Migration: harden_verified_internal_table_access
-- No row data was changed. Function privileges are a separate review.
SET LOCAL lock_timeout = '5s';
DO $hardening$
DECLARE name text; target regclass;
BEGIN
 FOREACH name IN ARRAY ARRAY['Chat',
'admin_users',
'chat_history',
'conversation',
'message',
'agent_run',
'agent_step',
'model_call_log',
'tool_call_log',
'retrieval_log',
'handoff_ticket',
'outbox_event',
'safety_event',
'content_versions',
'content_admin_audit_logs',
'content_event_outbox',
'indexing_jobs',
'mcp_webhook_subscriptions',
'mcp_webhook_deliveries',
'alert_rules',
'alert_rule_revisions',
'incidents',
'sessions',
'funnel_steps',
'behavior_events',
'analytics_kafka_inbox',
'analytics_rollup_sessions',
'analytics_visit_throttle',
'analytics_event_outbox',
'visitor_intent_policies',
'visitor_intent_signal_rules',
'visitor_intent_snapshots',
'visitor_journey_funnel_rules',
'visitor_journey_steps',
'visitor_attribution_rules',
'content_intent_metadata',
'content_intent_type_defaults',
'admin_flyway_schema_history',
'agent_flyway_history',
'notification_flyway_schema_history',
'flyway_schema_history',
'analytics_aggregator_flyway_history',
'analytics_alerts_flyway_history'] LOOP
  target := to_regclass(format('public.%I', name));
  IF target IS NULL THEN RAISE EXCEPTION 'Missing internal table: %', name; END IF;
  IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=target) THEN RAISE EXCEPTION 'Existing policies require review: %', name; END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=target AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'Column grants require review: %', name; END IF;
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM anon, authenticated, PUBLIC',target);
  IF has_table_privilege('anon',target,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_table_privilege('authenticated',target,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR NOT has_table_privilege('service_role',target,'SELECT')
   OR NOT has_table_privilege('service_role',target,'INSERT')
   OR NOT has_table_privilege('service_role',target,'UPDATE')
   OR NOT has_table_privilege('service_role',target,'DELETE')
  THEN RAISE EXCEPTION 'Unexpected privileges: %',name; END IF;
 END LOOP;
END $hardening$;
