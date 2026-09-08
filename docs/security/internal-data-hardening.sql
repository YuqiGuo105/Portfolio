-- Internal data is accessible through authenticated server APIs only.
-- Deliberately leave table-owner and service_role access unchanged.
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  table_name text;
  relation regclass;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Chat',
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
    'analytics_alerts_flyway_history'
  ] LOOP
    relation := to_regclass(format('public.%I', table_name));
    IF relation IS NULL THEN
      RAISE EXCEPTION 'Expected internal table missing: %', table_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = relation) THEN
      RAISE EXCEPTION 'Review existing RLS policies before changing %', table_name;
    END IF;
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM anon, authenticated, PUBLIC', relation);
    IF has_table_privilege('anon', relation, 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', relation, 'SELECT,INSERT,UPDATE,DELETE')
       OR NOT has_table_privilege('service_role', relation, 'SELECT')
       OR NOT has_table_privilege('service_role', relation, 'INSERT')
       OR NOT has_table_privilege('service_role', relation, 'UPDATE')
       OR NOT has_table_privilege('service_role', relation, 'DELETE') THEN
      RAISE EXCEPTION 'Unexpected privilege state for %', table_name;
    END IF;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.rebuild_visitor_pin_cells() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_visitor_log_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_visitor_logs_to_pin_cells() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.chat_history_search(text, integer, integer) FROM PUBLIC, anon, authenticated;

