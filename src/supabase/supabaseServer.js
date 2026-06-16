// 仅在服务端（API routes）使用，绝不 import 到客户端组件
import { createClient } from '@supabase/supabase-js';

export const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // 不带 NEXT_PUBLIC_ 前缀，不暴露给浏览器
);
