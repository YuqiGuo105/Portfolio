import { useMemo } from "react";
import Link from "next/link";
import { FileText, Github, Globe, Linkedin, MessageSquare, Share2, UserPlus } from "lucide-react";
import { cardShareContent, openShare } from "../../lib/share/open.mjs";
import { qrPath } from "../../lib/share/qr.mjs";
import { buildVCard, vcardForQr } from "../../lib/share/vcard.mjs";
import styles from "../../../styles/SharePages.module.css";

const ICONS = { LinkedIn: Linkedin, GitHub: Github };
const bare = url => url.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "");

function Row({ icon: Icon, label, value, href, external }) {
  const body = <><span className={styles.rowIcon} aria-hidden="true"><Icon size={19} strokeWidth={1.8} /></span><span className={styles.rowText}><span className={styles.rowLabel}>{label}</span><span className={styles.rowValue}>{value}</span></span></>;
  return <li>{external ? <a className={styles.item} href={href} target="_blank" rel="noopener noreferrer">{body}</a> : <Link href={href}><a className={styles.item}>{body}</a></Link>}</li>;
}

export default function ContactCard({ profile }) {
  const qr = useMemo(() => qrPath(vcardForQr(profile), { level: "L", quiet: 4 }), [profile]);
  const vcard = useMemo(() => `data:text/vcard;charset=utf-8,${encodeURIComponent(buildVCard(profile))}`, [profile]);
  const role = [profile.title, profile.company].filter(Boolean).join(" at ");
  return (
    <main className={`${styles.root} ${styles.card}`}>
      <div className={styles.cardInner}>
        <div className={styles.cardMain}>
          <div className={styles.banner}><Link href="/"><a className={styles.home}>yuqi.site</a></Link></div>
          <header className={styles.who}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.portrait} src={profile.photo} alt="" width={112} height={112} />
            <h1 className={styles.name}>{profile.name}</h1>
            <p className={styles.also} lang="zh">{profile.nickname}</p>
            <p className={styles.role}>{role}</p>
          </header>
          <div className={styles.cardBody}>
            <div className={styles.saveRow}>
              <a className={styles.primary} href={vcard} download="yuqi-guo.vcf"><UserPlus size={20} aria-hidden="true" /> Save to contacts</a>
              <button type="button" className={styles.secondary} onClick={() => openShare(cardShareContent(profile))} aria-label="Share this card" title="Share this card"><Share2 size={18} aria-hidden="true" /></button>
            </div>
            <ul className={styles.list}>
              <Row icon={Globe} label="Website" value="yuqi.site" href="/" />
              {profile.links.map(link => <Row key={link.label} icon={ICONS[link.label] || Globe} label={link.label} value={bare(link.url)} href={link.url} external />)}
              <Row icon={FileText} label="Résumé" value="yuqi.site/cv" href="/cv" />
              <Row icon={MessageSquare} label="Message" value="Talk with me" href="/talk" />
            </ul>
          </div>
        </div>
        <aside className={styles.scan}>
          <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR code that adds Yuqi Guo to your contacts" shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="#ffffff" /><path d={qr.d} fill="#1c2528" /></svg>
          <p><strong>Scan to add me to your contacts</strong><span>Yuqi Guo · yuqi.site</span></p>
        </aside>
      </div>
    </main>
  );
}
