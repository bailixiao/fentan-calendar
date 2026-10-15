// 進入點：依網址 # 切換頁面（首頁、班、那一堂、常見問題、管理後台），字體大小，Service Worker。
(function () {
  'use strict';

  const VIEWS = ['home', 'page', 'help', 'admin'];
  const TEXT_KEY = 'fentan-calendar:text-size';
  const SIZES = ['', 'l', 'xl'];

  function showView(name) {
    VIEWS.forEach((v) => { document.getElementById('view-' + v).hidden = v !== name; });
    document.body.classList.toggle('is-sub', name !== 'home');
    document.body.classList.toggle('on-admin', name === 'admin');
  }

  function route() {
    const hash = location.hash || '#/';
    const page = hash.match(/^#\/(c|s)\/([^?/]+)/);
    if (page) {
      showView('page');
      window.scrollTo(0, 0);
      const view = document.getElementById('view-page');
      const id = decodeURIComponent(page[2]);
      if (page[1] === 'c') HomePage.showCourse(view, id); else HomePage.showSession(view, id);
      return;
    }
    if (/^#\/help\/?$/.test(hash)) {
      showView('help');
      window.scrollTo(0, 0);
      HelpPage.show(document.getElementById('view-help'));
      return;
    }
    const admin = hash.match(/^#\/admin\/?(.*)$/);
    if (admin) {
      showView('admin');
      window.scrollTo(0, 0);
      AdminPage.show(document.getElementById('view-admin'), admin[1]);
      return;
    }
    showView('home');
    HomePage.showHome(document.getElementById('view-home'));
  }

  function initTextSize() {
    const btn = document.getElementById('text-size');
    let i = 0;
    try { i = Math.max(0, SIZES.indexOf(localStorage.getItem(TEXT_KEY) || '')); } catch (e) { /* 預設大小 */ }
    const apply = () => {
      SIZES.forEach((s) => { if (s) document.documentElement.classList.toggle('text-' + s, s === SIZES[i]); });
      btn.setAttribute('aria-label', `字體大小（目前第 ${i + 1} 級，共 3 級）`);
    };
    btn.addEventListener('click', () => {
      i = (i + 1) % SIZES.length;
      try { localStorage.setItem(TEXT_KEY, SIZES[i]); } catch (e) { /* 不記住 */ }
      apply();
    });
    apply();
  }

  function init() {
    document.title = window.SITE.name;
    initTextSize();
    PushPage.init();
    window.addEventListener('hashchange', route);
    route();
    // 本機預覽（localhost）不註冊，避免改了檔案還看到舊的
    if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* 不支援或失敗：照常使用 */ });
    }
  }

  init();
})();
