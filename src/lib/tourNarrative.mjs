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
