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

  // ─── Hero ───────────────────────────────────────────────────
  'hero.title':     { en: 'Misty Mountain Runners', zh: '岚山跑团' },
  'hero.subtitle':  {
    en: 'New York\'s premier Chinese-American running community',
    zh: '纽约华人跑步社区',
  },
  'hero.cta.join':  { en: 'Join the Club',   zh: '加入跑团' },
  'hero.cta.events':{ en: 'View Events',     zh: '查看活动' },

  // ─── Stats ─────────────────────────────────────────────────
  'stats.members':  { en: '500+ Members',    zh: '500+ 会员' },
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
  'portal.training':   { en: 'Training',     zh: '训练' },
  'portal.discounts':  { en: 'Discounts',    zh: '折扣' },
  'portal.profile':    { en: 'Profile',      zh: '个人信息' },

  // ─── Blog ────────────────────────────────────────────────────
  'blog.title':        { en: 'News & Stories', zh: '新闻与故事' },
  'blog.readmore':     { en: 'Read more',       zh: '查看更多' },

  // ─── Editor ──────────────────────────────────────────────────
  'editor.title':      { en: 'Content Editor',  zh: '内容编辑' },
  'editor.publish':    { en: 'Publish',          zh: '发布' },
  'editor.preview':    { en: 'Preview',          zh: '预览' },
  'editor.add.block':  { en: 'Add block',        zh: '添加内容块' },

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
