export function knowledgeMutation({ title, question, content, status, answerVisibility, expectedRevision }) {
  return {
    document: { title, question, content },
    policy: { status, answerVisibility },
    ...(expectedRevision ? { preconditions: { revision: expectedRevision } } : {}),
  };
}

export function createKnowledgeApi(request) {
  return {
    list: ({ query = '', scope = 'OWNED', status = 'ALL', limit = 25, offset = 0 } = {}) =>
      request('POST', '/api/admin/knowledge/search', { filter: { query, scope, status }, page: { size: limit, offset } }),
    get: id => request('GET', `/api/admin/knowledge/${encodeURIComponent(id)}`),
    getBatch: ids => {
      if (!Array.isArray(ids) || !ids.length || ids.length > 25) throw new Error('Choose 1-25 knowledge records.');
      return request('POST', '/api/admin/knowledge/batch-get', { ids });
    },
    create: (body, key) => request('POST', '/api/admin/knowledge', knowledgeMutation(body), key),
    update: (id, body, key) => request('PUT', `/api/admin/knowledge/${encodeURIComponent(id)}`, knowledgeMutation(body), key),
    remove: (id, revision, key) => request('DELETE',
      `/api/admin/knowledge/${encodeURIComponent(id)}?expectedRevision=${encodeURIComponent(revision)}`, undefined, key),
  };
}
