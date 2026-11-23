import fs from 'node:fs/promises';
import path from 'node:path';

export async function localArticleDraft(project, env = process.env) {
  if (env.NODE_ENV !== 'development' || env.MEDIA_LOCAL_REVIEW !== '1' || env.VERCEL || env.K_SERVICE
    || !/^[a-f0-9-]{36}$/.test(project.id)) return project;
  try {
    const draft = JSON.parse(await fs.readFile(path.join(process.cwd(), 'docs/content-drafts', `${project.id}.json`), 'utf8'));
    if (draft.id !== project.id || draft.sourceUpdatedAt !== project.updated_at) return project;
    return { ...project, content: draft.content, summary: draft.summary, technology: draft.technology };
  } catch (error) {
    if (error.code === 'ENOENT') return project;
    throw error;
  }
}
