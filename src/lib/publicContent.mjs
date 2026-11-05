// Public portfolio content for list pages (home, /works-list, /blogs). Pages read it in getStaticProps so
// the first HTML already holds the project and blog cards: crawlers, link previews, recruiters' tools and
// visitors without JavaScript see the same lists as everyone else. The browser still refreshes them after
// load. Reads go through the public (anon) key, so row-level security decides what is visible exactly as
// in the browser, and only the columns the cards show are read, so article bodies never ride along.
import { createClient } from "@supabase/supabase-js";

export const PROJECT_CARD_COLUMNS = "id, num, title, category, technology, year, image_url";
export const PROJECT_SYSTEM_COLUMNS = "id, project_id, title, eyebrow, maturity, sort_order, diagram_config";
export const BLOG_CARD_COLUMNS = "id, title, category, date, description, image_url, tags";
export const LIFE_BLOG_CARD_COLUMNS =
  "id, title, image_url, category, published_at, description, require_login, created_at, updated_at, tags";
export const EXPERIENCE_COLUMNS = "*";

// List pages are regenerated in the background at most this often (Next.js ISR).
export const LIST_REVALIDATE_SECONDS = 300;
const READ_TIMEOUT_MS = 8000;

let serverClient = null;

// A Supabase client for server-side reads with the public key, or null when it is not configured.
export function publicServerClient(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!serverClient) {
    serverClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return serverClient;
}

async function read(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const { data, error } = await query.abortSignal(controller.signal);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
}

// The first active subsystem of each project (rows arrive sorted by sort_order), keyed by project id.
export function firstSystemByProject(systems) {
  return (Array.isArray(systems) ? systems : []).reduce((byProject, system) => {
    if (system && system.project_id != null && !byProject[system.project_id]) byProject[system.project_id] = system;
    return byProject;
  }, {});
}

// Published project cards, newest first, with the subsystem that draws each card's cover.
export async function loadProjectCards(client, { featuredOnly = false } = {}) {
  if (!client) return { projects: [], systems: {} };
  let query = client
    .from("Projects")
    .select(PROJECT_CARD_COLUMNS)
    .eq("publication_status", "PUBLISHED")
    .order("num", { ascending: false });
  if (featuredOnly) query = query.eq("featured", true);
  const projects = await read(query);
  if (!projects.length) return { projects, systems: {} };
  const systems = await read(
    client
      .from("project_subsystems")
      .select(PROJECT_SYSTEM_COLUMNS)
      .in("project_id", projects.map((project) => project.id))
      .eq("active", true)
      .order("sort_order", { ascending: true })
  );
  return { projects, systems: firstSystemByProject(systems) };
}

export async function loadTechBlogCards(client) {
  if (!client) return [];
  return read(client.from("Blogs").select(BLOG_CARD_COLUMNS).order("date", { ascending: false }));
}

export async function loadLifeBlogCards(client, { ascending = false } = {}) {
  if (!client) return [];
  return read(client.from("life_blogs").select(LIFE_BLOG_CARD_COLUMNS).order("created_at", { ascending }));
}

export async function loadExperiences(client) {
  if (!client) return [];
  return read(client.from("experience").select(EXPERIENCE_COLUMNS).order("date", { ascending: false }));
}

// Runs a loader and falls back to `empty` on any failure: the page still renders and the browser
// fetches the lists itself, as it did before.
export async function orEmpty(load, empty, label = "content") {
  try {
    return await load();
  } catch (error) {
    console.warn(`[publicContent] ${label} unavailable at build:`, error?.message || error);
    return empty;
  }
}
