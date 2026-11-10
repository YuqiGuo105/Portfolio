export function publicArchitectureEvolution(data) {
  return {
    schemaVersion: 1,
    source: "https://www.yuqi.site/architecture#evolution",
    milestones: data.milestones.map(item => ({
      id: item.id, date: item.date, type: item.type, title: item.title, summary: item.summary,
      url: `https://www.yuqi.site/architecture#evolution/${item.id}`,
      sections: item.sections.map(section => ({ label: section.label, text: section.text })),
      evidence: item.evidence.map(evidence => ({
        title: evidence.text,
        url: `https://github.com/${data.owner}/${evidence.repo}/commit/${evidence.sha}`,
      })),
    })),
    note: "Curated public architecture history with commit evidence, not live deployment status or private incident logs.",
  };
}
