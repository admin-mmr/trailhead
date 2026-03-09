// ============================================================
// Internationalization (i18n) module for member portal
// Supports: English (en), Simplified Chinese (zh)
// ============================================================

const I18N_MESSAGES = {
  en: {
    // Common
    appName: 'Lanshan Running Club',
    dashboard: 'Dashboard',
    profile: 'Profile',
    signOut: 'Sign Out',
    save: 'Save Changes',
    cancel: 'Cancel',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',

    // Dashboard
    welcome: 'Welcome, {name}!',
    memberID: 'Member ID',
    membershipExpires: 'Membership Expires',
    joinYear: 'Join Year',
    membershipType: 'Membership Type',
    district: 'District',
    updateProfile: 'Update Profile',
    paymentHistory: 'Payment History',
    adminPanel: 'Admin Panel',
    isYourInfoAccurate: 'Is your information accurate?',
    pendingFieldsWarning: 'Some fields are empty — please update your profile.',
    paymentDues: 'Pay Dues',
    switchToFamily: 'Switch to Family',
    upgradeToFamily: 'Upgrade to Family',
    manageFamily: 'Manage Family',
    submitPaymentProof: 'Submit Payment Proof',
    viewPendingRequests: 'View Pending Requests',
    active: 'Active',
    inactive: 'Inactive',
    expiringVerySoon: 'Expiring Very Soon',
    activeRenewSoon: 'Active — Renew Soon',
    upgradePending: 'Upgrade Pending',
    paymentPending: 'Payment Pending',
    upgradeInitiated: 'Upgrade initiated. Please pay',
    upgradeFee: 'upgrade fee. Your expiration date is unchanged.',
    upgradePayment: 'Family Upgrade',
    switchedToFamily: 'Switched to Family. Please pay',
    toActivate: 'to activate your membership.',
    submitUpgradeProof: 'Please submit payment proof to complete your Family upgrade.',
    upgradeUnderReview: 'Your upgrade payment is under review. We\'ll notify you of the result.',
    cancelUpgrade: 'Cancel Upgrade',
    continueToPayment: 'Continue to Payment →',
    reloadDashboard: 'Reload Dashboard →',
    thank: 'Thank you for',
    on: 'on',
    pendingReview: 'It is Pending review. You will receive an email soon',
    noExpiry: 'Not set',

    // Profile page
    updateProfileTitle: 'Update Profile',
    email: 'Email',
    firstName: 'First Name',
    lastName: 'Last Name',
    phoneNumber: 'Phone Number',
    wechatID: 'WeChat ID',
    district: 'District',
    selectDistrict: '— Select district —',
    joinYearLabel: 'Join Year',
    joinYearHint: 'Year you first joined the club. You may edit this.',
    profileUpdatedSuccess: 'Profile updated successfully! Redirecting…',
    failedToSave: 'Failed to save. Please try again.',
    couldNotLoadProfile: 'Could not load your profile.',
    signInAgain: 'Sign in again',
    sessionExpired: 'Session expired or profile not found. Please sign in again.',

    // Payment page
    sendPayment: 'Send Your Payment',
    paymentInstructions: 'Payment Instructions',
    membershipRenewal: 'Membership Renewal',
    zelle: 'Zelle',
    venmo: 'Venmo',
    handle: 'Handle:',
    importantNote: 'Important:',
    includeMemberID: 'Please include your Member ID',
    memoHelp: 'in the payment memo/note to help us match your payment.',
    continueSubmitProof: 'Continue to Submit Proof →',
    loadingPaymentDetails: 'Loading payment details...',
    errorLoadingPage: 'Error loading page:',

    // New member
    newMember: 'New Member Registration',
    registerNow: 'Register Now',

    // Payment proof
    submitPaymentProofTitle: 'Submit Payment Proof',
    uploadScreenshot: 'Upload Screenshot',
    selectScreenshot: 'Select Screenshot',
    paymentDate: 'Payment Date',
    paymentMethod: 'Payment Method',
    payerName: 'Payer Name',
    memoField: 'Memo/Reference',
    last4Digits: 'Last 4 Digits',
    notes: 'Notes (optional)',
    submit: 'Submit',
    submitting: 'Submitting...',

    // Family management
    manageFamily: 'Manage Family',
    addFamily: 'Add Family Member',
    removeFamily: 'Remove Family Member',
    familyMembers: 'Family Members',

    // Login
    login: 'Sign In',
    enterEmail: 'Enter your email',
    sendOTP: 'Send OTP',
    enterOTP: 'Enter OTP',
    verifyOTP: 'Verify OTP',
  },

  zh: {
    // Common
    appName: '岚山跑团',
    dashboard: '仪表板',
    profile: '个人资料',
    signOut: '退出',
    save: '保存变更',
    cancel: '取消',
    loading: '加载中...',
    error: '错误',
    success: '成功',

    // Dashboard
    welcome: '欢迎，{name}!',
    memberID: '会员ID',
    membershipExpires: '会员资格到期',
    joinYear: '入会年份',
    membershipType: '会员类型',
    district: '地区',
    updateProfile: '更新个人资料',
    paymentHistory: '支付历史',
    adminPanel: '管理员面板',
    isYourInfoAccurate: '您的信息准确吗？',
    pendingFieldsWarning: '某些字段为空 — 请更新您的个人资料。',
    paymentDues: '支付会费',
    switchToFamily: '转换为家庭会员',
    upgradeToFamily: '升级为家庭会员',
    manageFamily: '管理家庭成员',
    submitPaymentProof: '提交支付证明',
    viewPendingRequests: '查看待处理请求',
    active: '活跃',
    inactive: '不活跃',
    expiringVerySoon: '即将到期',
    activeRenewSoon: '活跃 — 请尽快续费',
    upgradePending: '升级待处理',
    paymentPending: '支付待处理',
    upgradeInitiated: '升级已启动。请支付',
    upgradeFee: '升级费。您的到期日期不会改变。',
    upgradePayment: '家庭升级',
    switchedToFamily: '已转换为家庭会员。请支付',
    toActivate: '以激活您的会员资格。',
    submitUpgradeProof: '请提交支付证明以完成您的家庭升级。',
    upgradeUnderReview: '您的升级支付正在审查中。我们将通知您结果。',
    cancelUpgrade: '取消升级',
    continueToPayment: '继续付款 →',
    reloadDashboard: '重新加载仪表板 →',
    thank: '感谢您的',
    on: '在',
    pendingReview: '待审查中。您将很快收到电子邮件',
    noExpiry: '未设置',

    // Profile page
    updateProfileTitle: '更新个人资料',
    email: '电子邮件',
    firstName: '名字',
    lastName: '姓氏',
    phoneNumber: '电话号码',
    wechatID: '微信ID',
    district: '地区',
    selectDistrict: '— 选择地区 —',
    joinYearLabel: '入会年份',
    joinYearHint: '您加入俱乐部的年份。您可以编辑这个。',
    profileUpdatedSuccess: '个人资料已成功更新！正在重定向…',
    failedToSave: '保存失败。请重试。',
    couldNotLoadProfile: '无法加载您的个人资料。',
    signInAgain: '重新登录',
    sessionExpired: '会话已过期或找不到个人资料。请重新登录。',

    // Payment page
    sendPayment: '发送您的支付',
    paymentInstructions: '支付说明',
    membershipRenewal: '会员续费',
    zelle: 'Zelle',
    venmo: 'Venmo',
    handle: '账号：',
    importantNote: '重要：',
    includeMemberID: '请在支付备注/备忘录中包含您的会员ID',
    memoHelp: '以帮助我们匹配您的支付。',
    continueSubmitProof: '继续提交证明 →',
    loadingPaymentDetails: '加载支付详情...',
    errorLoadingPage: '页面加载错误：',

    // New member
    newMember: '新会员注册',
    registerNow: '立即注册',

    // Payment proof
    submitPaymentProofTitle: '提交支付证明',
    uploadScreenshot: '上传截图',
    selectScreenshot: '选择截图',
    paymentDate: '支付日期',
    paymentMethod: '支付方式',
    payerName: '付款人姓名',
    memoField: '备忘录/参考',
    last4Digits: '最后4位数字',
    notes: '备注（可选）',
    submit: '提交',
    submitting: '提交中...',

    // Family management
    manageFamily: '管理家庭',
    addFamily: '添加家庭成员',
    removeFamily: '删除家庭成员',
    familyMembers: '家庭成员',

    // Login
    login: '登录',
    enterEmail: '输入您的电子邮件',
    sendOTP: '发送一次性密码',
    enterOTP: '输入一次性密码',
    verifyOTP: '验证一次性密码',
  }
};

// Get current language from localStorage or browser language
function getCurrentLanguage() {
  const stored = localStorage.getItem('portal_lang');
  if (stored && ['en', 'zh'].includes(stored)) {
    return stored;
  }

  // Detect browser language
  const browserLang = (navigator.language || 'en').toLowerCase();
  if (browserLang.startsWith('zh')) {
    return 'zh';
  }

  return 'en';
}

// Set language
function setLanguage(lang) {
  if (['en', 'zh'].includes(lang)) {
    localStorage.setItem('portal_lang', lang);
    // Reload page to apply new language
    location.reload();
  }
}

// Get translation
function t(key, params = {}) {
  const lang = getCurrentLanguage();
  let message = I18N_MESSAGES[lang]?.[key] || I18N_MESSAGES['en'][key] || key;

  // Replace parameters
  Object.keys(params).forEach(param => {
    message = message.replace('{' + param + '}', params[param]);
  });

  return message;
}

// Apply translations to HTML
function applyTranslations() {
  const lang = getCurrentLanguage();

  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key);
    }
  });

  // Update all elements with data-i18n-placeholder attribute
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      el.placeholder = t(key);
    }
  });

  // Update all elements with data-i18n-title attribute
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.title = t(key);
    }
  });
}

// Initialize language selector
function initLanguageSelector() {
  const selector = document.getElementById('languageSelector');
  if (selector) {
    const currentLang = getCurrentLanguage();
    selector.value = currentLang;
    selector.addEventListener('change', function(e) {
      setLanguage(e.target.value);
    });
  }
}

// Navigation helper for GAS frame compatibility
function navigateToPage(url) {
  console.log('[MMR][i18n] navigating to:', url);
  try {
    // Try creating and clicking a link (works better with GAS frame restrictions)
    const link = document.createElement('a');
    link.href = url;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error('[MMR][i18n] navigation failed:', e);
    // Fallback: show message with manual link
    try {
      const fallbackDiv = document.getElementById('msg') || document.getElementById('errorView');
      if (fallbackDiv) {
        fallbackDiv.innerHTML = '<div style="padding:20px;text-align:center;"><p>Redirecting... <a href="' + url + '" style="color:#2d7d46;font-weight:bold;">Click here if not redirected</a></p></div>';
      }
    } catch (e2) {
      // Last resort: just set location href
      window.location.href = url;
    }
  }
}

// Export for use in pages
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { t, getCurrentLanguage, setLanguage, applyTranslations, initLanguageSelector, navigateToPage };
}
