import SeoHead from "../../src/components/SeoHead";
import ContactCard from "../../src/components/share/ContactCard";

export async function getStaticProps() {
  const { loadExperiences, publicServerClient } = await import("../../src/lib/publicContent.mjs");
  const { currentRole } = await import("../../src/lib/currentRole.mjs");
  const { publicProfile } = await import("../../src/lib/share/model.mjs");
  const rows = await loadExperiences(publicServerClient()).catch(() => []);
  return { props: { profile: publicProfile(currentRole(rows)) }, revalidate: rows.length ? 300 : 30 };
}

export default function CardPage({ profile }) {
  const role = [profile.title, profile.company].filter(Boolean).join(" at ");
  return <><SeoHead title="Yuqi Guo, contact card" description={`${role}. Save Yuqi Guo to your contacts, or open his website, LinkedIn, GitHub and résumé.`} url="/card" /><ContactCard profile={profile} /></>;
}
CardPage.hasCustomSeo = true;
