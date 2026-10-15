// 常見問題（#/help）。每次加新功能或畫面改變，都要同時更新這裡和 img/help 的截圖（tools/help-shots.js）。
(function () {
  'use strict';

  // img：img/help 的截圖（tools/help-shots.js 產生），截圖裡只有假資料
  const ITEMS = [
    { cat: '報名', q: '這個網站是什麼？', a: `
      <p>分壇教育組的班（高大班、青少年班，還有臨時加的活動）都在這裡報名。<strong>每一堂課各自報名</strong>，不用登入。</p>
      <p>首頁每個班一張卡片，寫下一堂的日期、主題、講師，和已經報名幾個人。` },
    { cat: '報名', q: '怎麼報名？', img: 'signup.png', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>首頁按那個班的「報名」（或點卡片進去，選要報的那一堂）。</span></li>
        <li><span class="help-num">2</span><span>填姓名、選區，按「報名」。</span></li>
        <li><span class="help-num">3</span><span>下面的「報名名單」看到自己的名字就好了。</span></li>
      </ol>
      <p>每一堂都要各自報名。手機會記住你上次選的區。</p>` },
    { cat: '報名', q: '可以幫家人一起報嗎？', a: `
      <p>可以。姓名欄一次填好幾個人，名字中間空一格或用「、」隔開，例如「王小明 測試甲」，下面會先顯示「會報 2 人」讓你確認。一起報的都算同一區。</p>
      <p>名字超過 4 個字會變黃色提醒，看看是不是兩個人黏在一起了。` },
    { cat: '報名', q: '報錯了，怎麼取消？', a: `
      <p>用<strong>同一支手機</strong>報的，在報名名單上自己的名字旁邊有「取消」（名字有顏色的就是這支手機報的），報名截止前都可以自己取消。</p>
      <p>換了手機、或已經截止，請找自己區的組長幫忙。` },
    { cat: '報名', q: '為什麼不能報名？', a: `
      <ul class="help-bullets">
        <li><strong>報名已截止</strong>：預設是上課前一天截止。截止後要報名請找自己區的組長。</li>
        <li><strong>已額滿</strong>：這堂有名額限制，已經報滿了。</li>
        <li><strong>停課</strong>：這堂不上課。</li>
      </ul>` },
    { cat: '報名', q: '要請假怎麼辦？', a: `
      <p>請直接告訴自己區的組長或教育組的幹部。請假由幹部上課點名時登記，網站上不能自己請假。</p>` },
    { cat: '組長、幹部', q: '組長怎麼幫區裡的人報名？', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>最下面按「管理者」，帳號選自己的區，輸入教育組給的密碼。</span></li>
        <li><span class="help-num">2</span><span>點要報的那一堂，在「報名」填姓名就好（區自動是你的區）。<strong>截止後也可以報</strong>。</span></li>
        <li><span class="help-num">3</span><span>報名名單上，自己區的人旁邊有「取消」。</span></li>
      </ol>` },
    { cat: '組長、幹部', q: '幹部怎麼點名？', img: 'roll.png', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>最下面按「管理者」，帳號選「點名」，輸入幹部共用的密碼。</span></li>
        <li><span class="help-num">2</span><span>選今天那一堂。報名的人照區列出，每個人按「到」「請假」或「缺席」（按錯了再按一次就取消）。</span></li>
        <li><span class="help-num">3</span><span>沒報名但來了：最下面「＋ 沒報名但來了」填姓名、選區，會加進來並記「到」。</span></li>
      </ol>
      <p>「出席紀錄」可以看每個人一整年到了幾次，也可以下載成 Excel 開的檔案。</p>` },
    { cat: '手機', q: '怎麼加到手機主畫面，像 App 一樣打開？', a: `
      <p><strong>iPhone（Safari）</strong></p>
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>用 Safari 打開這個網站。</span></li>
        <li><span class="help-num">2</span><span>按下面的「分享」按鈕（方框加向上箭頭）。</span></li>
        <li><span class="help-num">3</span><span>選「加入主畫面」，再按「加入」。</span></li>
      </ol>
      <p><strong>Android（Chrome）</strong></p>
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>用 Chrome 打開這個網站。</span></li>
        <li><span class="help-num">2</span><span>按右上角「⋮」。</span></li>
        <li><span class="help-num">3</span><span>選「加到主畫面」或「安裝應用程式」。</span></li>
      </ol>` },
    { cat: '手機', q: '怎麼開啟手機提醒？', img: 'push.png', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>首頁上方按「🔔 手機提醒」。</span></li>
        <li><span class="help-num">2</span><span>選你是哪一區，按「開啟提醒」，手機問要不要允許通知時按「允許」。</span></li>
        <li><span class="help-num">3</span><span>按「傳測試通知」，幾秒內收到就成功了。</span></li>
      </ol>
      <p>有上課的前一天<strong>晚上 8 點</strong>、當天<strong>早上 7 點</strong>會提醒，教育組也可能發重要通知。不用填名字。</p>
      <p><strong>iPhone、iPad</strong>：要先「加入主畫面」，從主畫面打開才能開啟提醒，需要 iOS 16.4 以上。</p>` },
    { cat: '手機', q: '字太小看不清楚？', a: `
      <p>按右上角的「A＋」，每按一次字會放大一級（共三級），再按就回到原本的大小。這支手機會記住。</p>` },
    { cat: '管理者', q: '怎麼新增一個班、排一整年的課？', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>用總管理者登入，「班與課程」按「＋ 新增班」。</span></li>
        <li><span class="help-num">2</span><span>填班的名稱、顏色、平常的時間地點；排課選「隔週六上課」或「一個月一次」，選第一堂的日期（一個月一次會照第一堂排在每個月的第幾個星期幾，下面會寫出來），按「新增」。</span></li>
        <li><span class="help-num">3</span><span>每一堂按「修改」填主題、講師、課程內容；不上課就勾「這堂停課」。</span></li>
      </ol>
      <p>臨時活動：新增班時選「只有一堂」。這期上完了，修改班把「開放」取消勾選，首頁就不顯示。</p>` }
  ];

  let open = null;

  function highlight(text, q) {
    if (!q) return text;
    return text.split(/(<[^>]+>)/).map((part) => (part.charAt(0) === '<' ? part : part.split(q).join(`<mark>${q}</mark>`))).join('');
  }

  function render(view, q) {
    const query = (q || '').trim();
    const list = ITEMS.filter((it) => !query || (it.q + it.a.replace(/<[^>]+>/g, '')).indexOf(query) !== -1);
    const cats = [];
    list.forEach((it) => { if (cats.indexOf(it.cat) === -1) cats.push(it.cat); });
    const box = view.querySelector('#help-list');
    box.innerHTML = list.length ? cats.map((cat) => `
      <h2 class="help-cat-title">${Fmt.esc(cat)}</h2>
      ${list.filter((it) => it.cat === cat).map((it) => {
        const i = ITEMS.indexOf(it);
        const isOpen = open === i || !!query;
        return `
          <div class="help-item${isOpen ? ' is-open' : ''}">
            <button type="button" class="help-qbtn" data-i="${i}" aria-expanded="${isOpen}">
              <span class="help-qtext">${highlight(Fmt.esc(it.q), Fmt.esc(query))}</span><span class="help-chev" aria-hidden="true">${isOpen ? '−' : '＋'}</span>
            </button>
            ${isOpen ? `<div class="help-answer">${highlight(it.a, Fmt.esc(query))}${it.img ? `<figure class="help-fig"><img src="img/help/${it.img}" alt="" loading="lazy"></figure>` : ''}</div>` : ''}
          </div>`;
      }).join('')}`).join('')
      : '<p class="help-empty">找不到相關的問題，換個字試試看</p>';
  }

  function show(view) {
    view.innerHTML = `
      <h1 class="admin-title">常見問題</h1>
      <div class="help-search"><input class="input help-q" type="search" placeholder="🔍 搜尋，例如：報名、取消、點名" aria-label="搜尋常見問題"></div>
      <div id="help-list"></div>
      <a class="btn btn-block back-btn" href="#/">‹ 回首頁</a>`;
    const input = view.querySelector('.help-q');
    input.addEventListener('input', () => render(view, input.value));
    view.querySelector('#help-list').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-i]');
      if (!b) return;
      const i = Number(b.dataset.i);
      open = open === i ? null : i;
      render(view, input.value);
    });
    render(view, '');
  }

  window.HelpPage = { show };
})();
