import { ArrowDownToLine, BellPlus, Bot, ChevronDown, CornerDownRight, ExternalLink, FileText, Filter, Folder, Home, List, MapPin, Monitor, MousePointerClick, Play, SearchCheck, Smartphone, Sparkles, Tablet } from 'lucide-react';
import { connectionSummary, formatSeconds, pageTimeline, sessionHeadline, timeOnPage } from '../../lib/visitorSessions.mjs';
import { eventTimestamp, mapLink, referrerOrigin } from '../../lib/visitorWorkbench.mjs';
import { CopyValue } from './VisitorWorkbench';
import styles from './VisitorSessions.module.css';

const zoned = zone => (zone === 'UTC' ? { timeZone: 'UTC' } : {});
const valid = value => { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date : null; };
const clock = (value, zone, seconds = true) => {
  const date = valid(value);
  return date ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), ...zoned(zone) }).format(date) : '';
};
const day = (value, zone) => { const date = valid(value); return date ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...zoned(zone) }).format(date) : ''; };
const span = ms => (ms < 1000 ? 'under a second' : formatSeconds(ms / 1000));
const sentence = text => text.charAt(0).toUpperCase() + text.slice(1);
// A project or article address ends in a long ID; the title already says which one it is.
const shortPath = path => String(path || '').replace(/([0-9a-f]{8})-[0-9a-f-]{20,}$/i, '$1…');

const DEVICE_ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };
const ROW_ICONS = { open: CornerDownRight, scroll: ArrowDownToLine, play: Play, click: MousePointerClick, action: Sparkles };

// The four checkpoints the site records. Filled segments are checkpoints the visitor reached.
function ScrollMeter({ percent }) {
  if (percent == null) return null;
  return <span className={styles.meter} title="Furthest scroll checkpoint on this page. It shows how far the page was scrolled, not that it was read.">
    <span className={styles.segments} aria-hidden="true">{[25, 50, 75, 100].map(mark => <i key={mark} data-on={percent >= mark || undefined} />)}</span>
    <span className={styles.meterText}>Scrolled {percent}%</span>
  </span>;
}

function watched(media) {
  if (media.watchedSeconds == null) return 'Played';
  const total = media.durationSeconds ? ` of ${formatSeconds(media.durationSeconds)}` : '';
  return `${media.completed ? 'Watched all' : 'Watched'} ${formatSeconds(media.watchedSeconds)}${media.completed ? '' : total}`;
}

function Playback({ media, zone }) {
  const connection = connectionSummary(media);
  const share = media.coveragePercent != null ? Math.min(100, Math.round(media.coveragePercent)) : null;
  const facts = [
    ['Quality', media.qualities.length > 1 ? `${media.qualities.join(' → ')}` : media.quality || 'Not reported', media.qualities.length > 1 ? 'Changed during playback' : ''],
    ['Connection', connection ? sentence(connection) : 'Not reported by this browser', media.bitrateKbps != null ? `This quality needs ${Math.round(media.bitrateKbps / 100) / 10} Mbps` : ''],
    ['Buffering', media.stallCount ? `${media.stallCount} ${media.stallCount === 1 ? 'pause' : 'pauses'}` : 'None', media.stallCount && media.stallMs ? `${(media.stallMs / 1000).toFixed(1)} s waiting in total` : ''],
    media.startupMs != null ? ['First frame', `${(media.startupMs / 1000).toFixed(1)} s`, 'After play was asked for'] : null,
    ['Started by', media.trigger === 'viewport' ? 'Scrolling it into view' : media.trigger === 'hover' ? 'Hovering' : media.trigger === 'button' ? 'Pressing play' : 'Not recorded', ''],
    media.actions.length ? ['Player controls used', media.actions.map(action => action.replace(/_/g, ' ')).join(', '), ''] : null,
    media.errors ? ['Errors', String(media.errors), ''] : null,
  ].filter(Boolean);
  return <section className={styles.playback} data-slow={media.stallCount >= 2 || undefined}>
    <header>
      <span className={styles.playIcon} aria-hidden="true"><Play size={13} /></span>
      <div>
        <strong>{media.title || (media.placement === 'home_intro' ? 'Homepage introduction' : 'Video')}</strong>
        <span>{media.started ? `${watched(media)}${share != null && !media.completed ? `, ${share}% of it` : ''}${media.preview ? ' (silent preview)' : ''}` : 'Asked to play; no playback was recorded'}</span>
      </div>
      {(media.startedAt || media.firstSeen) && <time>{clock(media.startedAt || media.firstSeen, zone)}</time>}
    </header>
    {share != null && <span className={styles.watchBar} role="img" aria-label={`${share}% of the video watched`}><span style={{ width: `${share}%` }} /></span>}
    <dl className={styles.facts}>{facts.map(([label, value, note]) => <div key={label}><dt>{label}</dt><dd>{value}{note && <small>{note}</small>}</dd></div>)}</dl>
  </section>;
}

function PageVisit({ page, next, zone }) {
  const { reference } = page;
  const Icon = reference.href === '/' ? Home : reference.type === 'project' ? Folder : FileText;
  const plays = page.media.filter(media => media.started && !media.preview);
  const stay = timeOnPage(page, next);
  const timeline = pageTimeline(page);
  const expandable = timeline.length > 1 || page.media.length > 0;
  const head = <>
    <span className={styles.node} aria-hidden="true" />
    <span className={styles.cover} aria-hidden="true"><Icon size={17} />
      {reference.coverUrl && <img src={reference.coverUrl} alt="" width="44" height="44" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}</span>
    <span className={styles.pageCopy}>
      <strong>{reference.title}</strong>
      <small>{reference.type !== 'Page' ? `${sentence(reference.type)}, ` : ''}{shortPath(reference.path)}</small>
    </span>
    <span className={styles.signals}>
      <ScrollMeter percent={page.scroll} />
      {plays.length > 0 && <span className={styles.signal}><Play size={12} aria-hidden="true" />{watched(plays[0])}{plays[0].quality ? ` at ${plays[0].quality}` : ''}{plays.length > 1 ? `, +${plays.length - 1} more` : ''}</span>}
      {page.clicks.length > 0 && <span className={styles.signal}><MousePointerClick size={12} aria-hidden="true" />{page.clicks.length === 1 ? `Clicked ${page.clicks[0].label}` : `${page.clicks.length} clicks`}</span>}
      {page.actions.length > 0 && <span className={styles.signal}><Sparkles size={12} aria-hidden="true" />{page.actions.length === 1 ? page.actions[0].label : `${page.actions.length} actions`}</span>}
    </span>
    <span className={styles.when}>
      <time dateTime={page.first} title={eventTimestamp(page.first, zone)}>{clock(page.first, zone)}</time>
      {stay && <small title={stay.atLeast ? 'From opening the page to its last recorded event. The visitor may have stayed longer.' : 'From opening this page to opening the next one.'}>{stay.atLeast ? 'at least ' : ''}{span(stay.ms)}</small>}
    </span>
  </>;
  if (!expandable) return <li className={styles.page}><div className={styles.pageHead}>{head}<span className={styles.chevron} /></div></li>;
  return <li className={styles.page}><details>
    <summary className={styles.pageHead}>{head}<ChevronDown className={styles.chevron} size={16} aria-hidden="true" /></summary>
    <div className={styles.detail}>
      <ol className={styles.timeline} aria-label={`What happened on ${reference.title}`}>
        {timeline.map((row, index) => { const RowIcon = ROW_ICONS[row.kind]; return <li key={`${row.time}-${index}`} data-kind={row.kind}>
          <time dateTime={row.time} title={eventTimestamp(row.time, zone)}>{clock(row.time, zone)}</time>
          <span className={styles.rowIcon} aria-hidden="true"><RowIcon size={12} /></span>
          <span>{row.href ? <a href={row.href} target="_blank" rel="noopener noreferrer">{row.text}</a> : row.text}{row.detail && <small> {row.detail}</small>}</span>
        </li>; })}
      </ol>
      {page.media.filter(media => media.started || media.errors).map(media => <Playback key={media.key} media={media} zone={zone} />)}
      <p className={styles.count}>{page.eventCount} recorded {page.eventCount === 1 ? 'event' : 'events'} on this page{page.videosSeen ? `, and ${page.videosSeen} ${page.videosSeen === 1 ? 'video was' : 'videos were'} on screen` : ''}. Scroll depth is how far the page was scrolled, not proof that it was read.</p>
    </div>
  </details></li>;
}

/** The class for the element that holds the cards: spaced cards on a tinted ground. */
export const visitorSessionList = styles.list;

/** One visitor session: who came and from where, then every page in order with what happened on it. */
export function VisitorSessionCard({ session, zone, onFilter, onInspect, onAlert }) {
  const { visitor, representative: item } = session;
  const place = [visitor.city, visitor.region].filter(Boolean).join(', ');
  const map = mapLink(visitor), source = referrerOrigin(visitor.referrer);
  const DeviceIcon = visitor.bot === true ? Bot : DEVICE_ICONS[String(visitor.deviceType).toLowerCase()] || Monitor;
  const client = [visitor.browser, visitor.os].filter(Boolean).join(' on ');
  const sameDay = day(session.start, zone) === day(session.end, zone);
  const ids = [['Session ID', item.sessionId], ['Anonymous ID', item.anonymousId], ['Latest event ID', item.eventId], ['Latest event (ISO)', item.eventTime], ['Received (ISO)', item.serverTime]];
  return <article className={styles.card} data-session={session.sessionId || undefined} data-bot={visitor.bot === true || undefined}>
    <header className={styles.head}>
      <span className={styles.device} title={visitor.bot === true ? 'Classified as automated traffic' : visitor.deviceType || 'Device not recorded'}><DeviceIcon size={18} aria-hidden="true" /></span>
      <div className={styles.who}>
        <h3>{visitor.city
          ? <button type="button" title="Show only visitors from this city" onClick={() => onFilter({ city: visitor.city, country: visitor.country || '' })}>{place}</button>
          : place || visitor.country || 'Unknown location'}
          {(place || visitor.country) && <span>{place && visitor.country ? `${visitor.country}, ` : ''}approximate</span>}
          {map && <a href={map} target="_blank" rel="noopener noreferrer" title="Open the approximate location in Google Maps" aria-label="Open the approximate location in Google Maps"><MapPin size={14} aria-hidden="true" /></a>}
          {visitor.bot === true && <em>Detected bot</em>}</h3>
        <p className={styles.summary}>{sessionHeadline(session)}</p>
      </div>
      <p className={styles.time}>
        <time dateTime={session.start} title={eventTimestamp(session.start, zone)}>{day(session.start, zone)}, {clock(session.start, zone, false)}</time>
        <span>{session.durationMs >= 1000 ? <>until <time dateTime={session.end} title={eventTimestamp(session.end, zone)}>{sameDay ? '' : `${day(session.end, zone)}, `}{clock(session.end, zone, false)}</time>, {span(session.durationMs)}</> : 'A single moment'}</span>
      </p>
    </header>

    <ul className={styles.traits} aria-label="About this visitor">
      {client && <li><button type="button" title="Show only this kind of device" disabled={!visitor.deviceType} onClick={() => onFilter({ device: visitor.deviceType })}><DeviceIcon size={13} aria-hidden="true" />{client}</button></li>}
      <li>{source
        ? <><button type="button" title="Show only visitors from this source" onClick={() => onFilter({ referrer: source.domain })}><CornerDownRight size={13} aria-hidden="true" />From {source.domain}</button>
          <a href={source.href} target="_blank" rel="noopener noreferrer" title="Open the source website" aria-label="Open the source website"><ExternalLink size={12} aria-hidden="true" /></a></>
        : <span><CornerDownRight size={13} aria-hidden="true" />{visitor.referrer ? 'From an unrecognised source' : 'Came directly'}</span>}</li>
      {visitor.ipAddress && <li><button type="button" title="Search records for this IP address" onClick={() => onFilter({ query: visitor.ipAddress })}><Filter size={12} aria-hidden="true" />{visitor.ipAddress}</button><CopyValue value={visitor.ipAddress} label="IP address" /></li>}
    </ul>

    {session.mayStartEarlier && <p className={styles.partial}>Older records were not read for this list, so this session may have started earlier. Open its timeline for the full session.</p>}
    {!session.sessionId && <p className={styles.partial}>No session ID was recorded with this event, so it stands alone.</p>}

    <ol className={styles.pages} aria-label="Pages in the order they were opened">
      {session.pages.map((page, index) => <PageVisit key={page.key} page={page} next={session.pages[index + 1]} zone={zone} />)}
    </ol>

    <footer className={styles.foot}>
      <details className={styles.ids}><summary>Identifiers<ChevronDown size={13} aria-hidden="true" /></summary>
        <dl>{ids.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{value || 'Not recorded'}</code><CopyValue value={value} label={label} /></dd></div>)}</dl>
        <p>A shared IP address does not establish a shared identity.</p>
      </details>
      <div className={styles.actions}>
        <button type="button" onClick={() => onAlert(item)}><BellPlus size={14} aria-hidden="true" />Create alert</button>
        <button type="button" onClick={() => onInspect(item, 'evidence')}><SearchCheck size={14} aria-hidden="true" />Classification evidence</button>
        <button type="button" data-primary disabled={!item.sessionId} onClick={() => onInspect(item, 'timeline')}><List size={14} aria-hidden="true" />Timeline</button>
      </div>
    </footer>
  </article>;
}
