// Local review catalog. Production publishing remains owned by the media service.
import renditions from './local-renditions.mjs';
import blogDemos from './local-blog-demos.mjs';
export const LOCAL_DEMOS = Object.freeze([
  {
    id: 'platform-walkthrough',
    contentId: 'project:7c3715bf-7722-4df5-9e83-5d7e9493ea2c',
    title: 'Portfolio Platform',
    summary: 'A visit through the portfolio and its backend projects.',
    href: '/work-single/7c3715bf-7722-4df5-9e83-5d7e9493ea2c',
    src: '/demos/platform-walkthrough.mp4',
    preview: '/demos/platform-hover.mp4',
    poster: '/demos/platform-walkthrough.webp',
    seconds: 19.208333,
    width: 1600,
    height: 900,
    bytes: 2061119,
    chapters: [
      { seconds: 0, title: 'Home' },
      { seconds: 4.6, title: 'Projects' },
      { seconds: 8.1, title: 'Backend' },
      { seconds: 13.4, title: 'Project overview' },
    ],
  },
  {
    id: 'open-source', contentId: 'project:0470298d-c74d-4d4b-be33-d948b033002a',
    title: 'Open Source Contribution', summary: 'Eight merged PRs across RxJava, Google ADK Java, Kubernetes Java Client, Spring AI Alibaba and Google LangExtract. Actual GitHub PR pages.',
    href: '/work-single/0470298d-c74d-4d4b-be33-d948b033002a',
    src: '/demos/open-source.mp4', preview: '/demos/open-source-hover.mp4', poster: '/demos/open-source.webp',
    seconds: 6, width: 1280, height: 720,
    chapters: [
      { seconds: 0, title: 'RxJava #8399', href: 'https://github.com/ReactiveX/RxJava/pull/8399' },
      { seconds: 0.75, title: 'ADK #1381', href: 'https://github.com/google/adk-java/pull/1381' },
      { seconds: 1.5, title: 'ADK #923', href: 'https://github.com/google/adk-java/pull/923' },
      { seconds: 2.25, title: 'Kubernetes #4868', href: 'https://github.com/kubernetes-client/java/pull/4868' },
      { seconds: 3, title: 'Kubernetes #4751', href: 'https://github.com/kubernetes-client/java/pull/4751' },
      { seconds: 3.75, title: 'Kubernetes #4746', href: 'https://github.com/kubernetes-client/java/pull/4746' },
      { seconds: 4.5, title: 'Alibaba #4491', href: 'https://github.com/alibaba/spring-ai-alibaba/pull/4491' },
      { seconds: 5.25, title: 'LangExtract #385', href: 'https://github.com/google/langextract/pull/385' },
    ],
  },
  {
    id: 'content-intelligence', contentId: 'project:8edf9020-39b6-4db4-83b3-43c459bef1cf',
    title: 'Content Intelligence Platform', summary: 'Architecture animation: publishing through Postgres, Outbox and Kafka to search and grounded AI.',
    href: '/work-single/8edf9020-39b6-4db4-83b3-43c459bef1cf',
    src: '/demos/content-intelligence.mp4', preview: '/demos/content-intelligence-hover.mp4', poster: '/demos/content-intelligence.webp',
    seconds: 24, width: 1280, height: 720,
    chapters: [{ seconds: 0, title: 'Publish' }, { seconds: 5, title: 'Outbox + Kafka' }, { seconds: 10, title: 'Indexing' }, { seconds: 16, title: 'Search + AI' }],
  },
  {
    id: 'talknest', contentId: 'project:7e42b9d7-c888-429e-8b61-5a6888bf6699',
    title: 'TalkNest', summary: 'Messages and call controls captured from the live app\'s interactive preview. Sample conversations, no live call.',
    href: '/work-single/7e42b9d7-c888-429e-8b61-5a6888bf6699',
    src: '/demos/talknest.mp4', preview: '/demos/talknest-hover.mp4', poster: '/demos/talknest.webp',
    seconds: 14, width: 1280, height: 720,
    chapters: [{ seconds: 0, title: 'Conversations' }, { seconds: 4.8, title: 'Message' }, { seconds: 7.6, title: 'Call preview' }],
  },
  {
    id: 'notifications', contentId: 'project:c049c604-50bd-4265-9318-866fd5f1a69e',
    title: 'Subscription & Notification Platform', summary: 'Choose subscription interests and notification channels.',
    href: '/work-single/c049c604-50bd-4265-9318-866fd5f1a69e',
    src: '/demos/notifications.mp4', preview: '/demos/notifications-hover.mp4', poster: '/demos/notifications.webp',
    seconds: 10, width: 1280, height: 720, bytes: 74265,
    chapters: [{ seconds: 0, title: 'Subscription' }, { seconds: 3.6, title: 'Interests' }, { seconds: 6.8, title: 'Channels' }],
  },
].map(demo => ({ ...demo, bytes: demo.bytes ?? renditions[demo.id][0].bytes, qualities: renditions[demo.id] })).concat(blogDemos));

export function localDemos(env = process.env) {
  return env.NODE_ENV === 'development' && env.MEDIA_LOCAL_REVIEW === '1' && !env.VERCEL && !env.K_SERVICE
    ? LOCAL_DEMOS : [];
}

export const LOCAL_INTRO = Object.freeze({
  id: 'yuqi-intro', title: 'Yuqi Guo introduction', seconds: 60,
  src: '/demos/yuqi-intro.mp4', captions: '/demos/yuqi-intro.vtt',
  poster: '/demos/yuqi-intro.webp', bytes: renditions['yuqi-intro'][0].bytes, width: 1280, height: 720,
  qualities: renditions['yuqi-intro'],
});

export function localIntro(env = process.env) {
  return localDemos(env).length ? LOCAL_INTRO : null;
}

export function demoForContent(demos, contentId) {
  return demos.find(demo => demo.contentId === contentId) || null;
}

export function formatVideoTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function canPreviewOnHover({ pointerType, fineHover, reducedMotion, saveData }) {
  return pointerType !== 'touch' && fineHover === true && !reducedMotion && !saveData;
}
