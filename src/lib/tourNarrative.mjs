// Recorded narration for the editorial chapters. Re-record (scripts/generate-tour-narration.py) and bump the
// version whenever the copy above changes; tests/tour-narrative.test.mjs fails while a recording is stale.
export const NARRATION_VERSION = "v4"

const chapters = {
    hero: ["Meet the person.", "Every system starts with a person. This one starts with Yuqi. I'll show you the work, the thinking, and the life around it.", "What connects Yuqi's projects and engineering interests?", "认识一个人。", "每个系统背后都有一个人。这里是育奇的世界：作品、思考，以及代码以外的生活。", "育奇的项目和工程兴趣之间有什么联系？", "mint"],
    about: ["Beyond the headline.", "A title is a starting point, not the whole story. Here is the person behind the projects.", "How does Yuqi describe his engineering focus? Cite his public profile.", "不止一个头衔。", "头衔只是起点。看看这些项目背后的人，以及他关注什么。", "育奇的工程方向是什么？请引用他的公开资料。", "peach"],
    background: ["The path here.", "Experience gives the work its context. Follow the roles and education, then open the CV for the full picture.", "Connect Yuqi's public work experience to the skills demonstrated in his projects.", "走到这里的路。", "经历让作品有了上下文。从工作与教育背景出发，再到简历里看完整的脉络。", "育奇的公开工作经历与项目中展现的能力有什么联系？", "mint"],
    projects: ["Don't take my word for it.", "The work is right here. Pick something that catches your eye; let's get closer to what it actually does.", "What problem does this project solve, and what evidence supports its architecture claims?", "让作品自己说话。", "作品就在这里。选一个让你好奇的，我们一起看看它真正解决了什么问题。", "这个项目解决了什么问题？哪些资料能支持它的架构设计？", "mint"],
    techblogs: ["Inside the thinking.", "Code shows the result. Writing opens up the reasoning. Follow a question into the article behind it.", "What is the main engineering trade-off in this article? Cite the original text.", "走进思考过程。", "代码呈现结果，文字展开推理。带着一个问题，走进文章里的设计取舍。", "这篇文章最关键的工程取舍是什么？请引用原文。", "lavender"],
    life: ["A life outside the editor.", "A different side of the same person. These are the stories beyond systems and software.", "What does this life story reveal about Yuqi? Use only its publicly accessible content.", "编辑器之外。", "同一个人的另一面。这些故事发生在系统与软件之外。", "这篇生活故事展现了育奇的哪一面？只使用公开可访问的内容。", "peach"],
    realtime: ["A site that stays awake.", "This isn't just a collection of screenshots. Here, the page connects to live services. Look at the data, then follow it to the dashboard.", "Explain which live services power this section and cite their implementation evidence.", "一个仍在运行的网站。", "这里不只是截图。页面连接着实时服务，从眼前的数据继续走进仪表盘。", "这一部分由哪些实时服务支持？请引用实现资料。", "lavender"],
    contact: ["The next part is a conversation.", "You've seen the work and met the person. A collaboration, a question, or simply hello: this is where the next chapter starts.", "Summarize Yuqi's public contact options and professional interests without inventing availability.", "下一章，从对话开始。", "看过作品，也认识了这个人。合作、问题，或者简单的一声你好，下一章从这里开始。", "总结育奇公开的联系方式和职业兴趣，不推测他的求职状态。", "peach"],
}

export function tourNarrative(step, language = "en") {
    const entry = chapters[step?.id]
    // AI-generated plans retain their own narrative, rather than inheriting a different chapter's claims.
    if (!entry || !step?.editorial) return { title: step?.title || "", line: step?.content || "", question: "", tone: "mint" }
    const offset = language === "zh" ? 3 : 0
    return { title: entry[offset], line: entry[offset + 1], question: entry[offset + 2], tone: entry[6] }
}

const zhSteps = {
    hero: { title: "郭育奇", meta: "软件工程 · 微服务 · 分布式系统" },
    about: { title: "关于我", meta: "个人简介 · 工程方向 · 当前职位" },
    background: { title: "我的经历", meta: "工作经历 · 教育背景 · 技术基础", action: "查看简历" },
    projects: { title: "我的项目", meta: "分布式系统 · AI 平台 · 生产运维", action: "浏览全部项目" },
    techblogs: { title: "技术博客", meta: "系统设计 · 后端 · 基础设施", action: "阅读技术文章" },
    life: { title: "我的生活", meta: "旅行 · 摄影 · 代码之外", action: "看看生活故事" },
    realtime: { title: "实时数据", meta: "实时服务 · 访客洞察 · 可观测性", action: "打开数据分析" },
    contact: { title: "联系我", meta: "招聘 · 合作 · 直接联系" },
}

/** Chinese chapter titles, notes and links for the editorial tour; other steps are returned unchanged. */
export function localizeTourStep(step, language = "en") {
    const zh = language === "zh" && step?.editorial ? zhSteps[step.id] : null
    if (!zh) return step
    return {
        ...step,
        title: zh.title,
        meta: zh.meta,
        action: step.action && zh.action ? { ...step.action, label: zh.action } : step.action,
    }
}

/** What Mr. Pot says for a step: the same headline and line the dock shows. */
export function narrationText(step, language = "en") {
    const story = tourNarrative(step, language)
    if (!story.title && !story.line) return ""
    if (language === "zh") return `${story.title}${story.line}`
    return [story.title, story.line].filter(Boolean).join(story.title.endsWith(".") ? " " : ". ")
}

/** The recorded narration for an editorial chapter, or null (AI-generated steps use the browser voice). */
export function narrationAudio(step, language = "en") {
    if (!step?.editorial || !chapters[step.id]) return null
    return `/assets/audio/tour/${NARRATION_VERSION}/${language === "zh" ? "zh" : "en"}/${step.id}.mp3`
}

/** How long autoplay lingers on a step when it is not narrated: long enough to read it, at least 6.5 s. */
export function readingTime(step, language = "en") {
    const text = narrationText(step, language)
    const perCharacter = language === "zh" ? 190 : 55
    return Math.max(6500, Math.round(text.length * perCharacter) + 1500)
}

/** Every recorded line, by language and chapter: the input of scripts/generate-tour-narration.py. */
export function narrationScript() {
    return Object.fromEntries(["en", "zh"].map(language => [language, Object.fromEntries(
        Object.keys(chapters).map(id => [id, narrationText({ id, editorial: true }, language)])
    )]))
}
