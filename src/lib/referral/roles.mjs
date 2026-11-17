// Keep the first role in the legacy fields; extra roles travel with the same request and resume.
export const ROLE_FIELDS = ['roleTitle', 'jobUrl', 'jobId', 'location', 'requirements'];
export const roleFieldKey = (index, key) => index === 0 ? key : `additionalRoles.${index - 1}.${key}`;

export const postingLinks = value => String(value || '').split(/[,，\n]+/).map(link => link.trim()).filter(Boolean);

// The form has one comma-separated links field; storage keeps each opening separate.
export function expandPostingLinks(request) {
  const [jobUrl = '', ...links] = postingLinks(request.jobUrl);
  return { ...request, jobUrl, additionalRoles: links.map((link, index) =>
    request.additionalRoles?.find(role => role.jobUrl === link)
    || { roleTitle: `Opening ${index + 2}`, jobUrl: link, jobId: '', location: '', requirements: '' }) };
}

export function requestRoles(request) {
  return [Object.fromEntries(ROLE_FIELDS.map(key => [key, request[key] ?? ''])), ...(request.additionalRoles || [])];
}

export function storedRoles(row) {
  return requestRoles({ roleTitle: row.role_title, jobUrl: row.job_url, jobId: row.job_id,
    location: row.location, requirements: row.requirements, additionalRoles: row.additional_roles });
}
