export type Lang = 'en' | 'zh'

export const translations = {
  // ─── Nav ────────────────────────────────────────────────────
  'nav.home':       { en: 'Home',       zh: '首页' },
  'nav.events':     { en: 'Events',     zh: '活动' },
  'nav.blog':       { en: 'News',       zh: '新闻' },
  'nav.join':       { en: 'Join',       zh: '加入' },
  'nav.portal':     { en: 'My Portal',  zh: '会员中心' },
  'nav.login':      { en: 'Login',      zh: '登录' },
  'nav.logout':     { en: 'Logout',     zh: '退出' },
  'nav.donate':     { en: 'Donate',     zh: '捐赠' },
  'nav.hof':        { en: 'Hall of Fame', zh: '荣誉殿堂' },
  'nav.admin':      { en: 'Admin',      zh: '管理' },

  // ─── Hero ───────────────────────────────────────────────────
  'hero.title':     { en: 'Misty Mountain Runners', zh: '岚山跑团' },
  'hero.subtitle':  {
    en: 'New York\'s premier Chinese-American running community',
    zh: '纽约华人跑步社区',
  },
  'hero.cta.join':  { en: 'Join the Club',   zh: '加入跑团' },
  'hero.cta.events':{ en: 'View Events',     zh: '查看活动' },

  // ─── Stats ─────────────────────────────────────────────────
  'stats.members':  { en: '400+ Members',    zh: '400+ 会员' },
  'stats.runs':     { en: '12 Runs/Month',   zh: '每月12次' },
  'stats.team':     { en: 'NYRR Team',       zh: 'NYRR 队伍' },
  'stats.nonprofit':{ en: '501(c)(3)',        zh: '非盈利' },

  // ─── Events ─────────────────────────────────────────────────
  'events.title':   { en: 'Upcoming Events', zh: '近期活动' },
  'events.empty':   { en: 'No upcoming events.', zh: '暂无活动。' },
  'events.register':{ en: 'Register',        zh: '报名' },
  'events.details': { en: 'Details',         zh: '详情' },

  // ─── Join / Membership ──────────────────────────────────────
  'join.title':        { en: 'Become a Member', zh: '成为会员' },
  'join.individual':   { en: 'Individual',      zh: '个人会员' },
  'join.family':       { en: 'Family',          zh: '家庭会员' },
  'join.price.ind':    { en: '$30 / year',      zh: '$30 / 年' },
  'join.price.fam':    { en: '$50 / year',      zh: '$50 / 年' },
  'join.cta':          { en: 'Join Now',         zh: '立即加入' },
  'join.benefit1':     { en: 'Official MMR membership ID', zh: '官方会员编号' },
  'join.benefit2':     { en: 'NYRR club team eligibility', zh: 'NYRR 队伍资格' },
  'join.benefit3':     { en: 'Member-only group runs',     zh: '专属集体跑步' },
  'join.benefit4':     { en: 'Race gear discounts',        zh: '装备折扣' },

  // ─── Auth ────────────────────────────────────────────────────
  'auth.email.label':  { en: 'Email address',  zh: '邮箱地址' },
  'auth.email.ph':     { en: 'you@example.com',zh: '你的邮箱' },


  // ─── Portal ──────────────────────────────────────────────────
  'portal.dashboard':  { en: 'Dashboard',    zh: '概览' },
  'portal.nyrr':       { en: 'NYRR Results', zh: '比赛成绩' },
  'portal.events':     { en: 'Events',       zh: '活动' },
  'portal.profile':    { en: 'Profile',      zh: '个人信息' },

  // ─── Blog ────────────────────────────────────────────────────
  'blog.title':        { en: 'News & Stories', zh: '新闻与故事' },
  'blog.readmore':     { en: 'Read more',       zh: '查看更多' },

  // ─── Editor ──────────────────────────────────────────────────
  'editor.title':      { en: 'Content Editor',  zh: '内容编辑' },
  'editor.publish':    { en: 'Publish',          zh: '发布' },
  'editor.preview':    { en: 'Preview',          zh: '预览' },
  'editor.add.block':  { en: 'Add block',        zh: '添加内容块' },

  // ─── Admin NYRR Dashboard ─────────────────────────────────────
  'nyrr.title':            { en: 'NYRR Dashboard',        zh: 'NYRR 管理面板' },
  'nyrr.overview':         { en: 'Overview',              zh: '概览' },
  'nyrr.events':           { en: 'Events',                zh: '赛事' },
  'nyrr.matchReview':      { en: 'Match Review',          zh: '匹配审核' },
  'nyrr.totalEvents':      { en: 'Total Events',          zh: '赛事总数' },
  'nyrr.upcomingEvents':   { en: 'Upcoming Events',       zh: '即将举行' },
  'nyrr.totalRunners':     { en: 'MMR Runners',           zh: 'MMR 跑者' },
  'nyrr.unmatchedQueue':   { en: 'Unmatched Queue',       zh: '待匹配队列' },
  'nyrr.processingStatus': { en: 'Processing Status',     zh: '处理状态' },
  'nyrr.recentEvents':     { en: 'Recent Events',         zh: '近期赛事' },
  'nyrr.syncHistory':      { en: 'Sync History',          zh: '同步记录' },
  'nyrr.eventName':        { en: 'Event',                 zh: '赛事名称' },
  'nyrr.date':             { en: 'Date',                  zh: '日期' },
  'nyrr.distance':         { en: 'Distance',              zh: '距离' },
  'nyrr.status':           { en: 'Status',                zh: '状态' },
  'nyrr.mmrCount':         { en: 'MMR',                   zh: 'MMR' },
  'nyrr.matched':          { en: 'Matched',               zh: '已匹配' },
  'nyrr.matchPct':         { en: 'Match %',               zh: '匹配率' },
  'nyrr.runner':           { en: 'Runner',                zh: '跑者' },
  'nyrr.bib':              { en: 'Bib',                   zh: '号码布' },
  'nyrr.age':              { en: 'Age',                   zh: '年龄' },
  'nyrr.gender':           { en: 'Gender',                zh: '性别' },
  'nyrr.time':             { en: 'Time',                  zh: '成绩' },
  'nyrr.place':            { en: 'Place',                 zh: '名次' },
  'nyrr.team':             { en: 'Team',                  zh: '队伍' },
  'nyrr.matchStatus':      { en: 'Match Status',          zh: '匹配状态' },
  'nyrr.member':           { en: 'Member',                zh: '会员' },
  'nyrr.all':              { en: 'All',                   zh: '全部' },
  'nyrr.mmrOnly':          { en: 'MMR Only',              zh: '仅MMR' },
  'nyrr.unmatched':        { en: 'Unmatched',             zh: '未匹配' },
  'nyrr.notMember':        { en: 'Not Member',            zh: '非会员' },
  'nyrr.confirmMatch':     { en: 'Confirm Match',         zh: '确认匹配' },
  'nyrr.markNotMember':    { en: 'Not a Member',          zh: '非会员' },
  'nyrr.skip':             { en: 'Skip',                  zh: '跳过' },
  'nyrr.candidates':       { en: 'Member Candidates',     zh: '候选会员' },
  'nyrr.selectRunner':     { en: 'Select a runner to find matches', zh: '选择跑者以查找匹配' },
  'nyrr.noCandidates':     { en: 'No matching candidates found',    zh: '未找到匹配候选人' },
  'nyrr.raceHistory':      { en: 'Race History',          zh: '比赛记录' },
  'nyrr.nyrrName':         { en: 'NYRR Name',             zh: 'NYRR 姓名' },
  'nyrr.yearBorn':         { en: 'Year Born',             zh: '出生年份' },
  'nyrr.yearBornGuess':    { en: 'Year Born (est.)',      zh: '出生年份(估)' },
  'nyrr.unlinkMatch':      { en: 'Unlink Match',          zh: '取消匹配' },
  'nyrr.editName':         { en: 'Edit NYRR Name',        zh: '编辑NYRR姓名' },
  'nyrr.noResults':        { en: 'No results found.',     zh: '暂无结果。' },
  'nyrr.viewEvent':        { en: 'View Event',            zh: '查看赛事' },
  'nyrr.viewMember':       { en: 'View Member',           zh: '查看会员' },
  'nyrr.location':         { en: 'Location',              zh: '地点' },
  'nyrr.totalRunnerCount': { en: 'Total Runners',         zh: '总跑者数' },
  'nyrr.pending':          { en: 'Pending',               zh: '待处理' },
  'nyrr.completed':        { en: 'Completed',             zh: '已完成' },
  'nyrr.error':            { en: 'Error',                 zh: '错误' },
  'nyrr.inProgress':       { en: 'In Progress',           zh: '处理中' },

  // ─── Common ───────────────────────────────────────────────────
  'common.loading':    { en: 'Loading…',         zh: '加载中…' },
  'common.save':       { en: 'Save',             zh: '保存' },
  'common.cancel':     { en: 'Cancel',           zh: '取消' },
  'common.edit':       { en: 'Edit',             zh: '编辑' },
  'common.delete':     { en: 'Delete',           zh: '删除' },
  'common.back':       { en: 'Back',             zh: '返回' },
  'common.submit':     { en: 'Submit',           zh: '提交' },
  'common.success':    { en: 'Success!',         zh: '成功！' },
  'common.error':      { en: 'Something went wrong.', zh: '出现错误。' },
} as const

export type TranslationKey = keyof typeof translations

export function t(key: TranslationKey, lang: Lang): string {
  return translations[key][lang]
}
