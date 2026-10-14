// 常見問題（#/help）。每次加新功能或畫面改變，都要同時更新這裡和 img/help 的截圖（tools/help-shots.js）。
(function () {
  'use strict';

  // img：img/help 的截圖（tools/help-shots.js 產生），截圖裡只有假資料
  const ITEMS = [
    { cat: '看行事曆', q: '這個行事曆是什麼？', a: `
      <p>宏教分壇的活動都放在這個行事曆上：分壇的法會、班、會議，還有分壇派給各區的勤務（例如統班烹飪、宏宗獻供拜香）。</p>
      <p>不用登入，也不用填任何資料。各區自己的活動請看各區的報名系統。</p>` },
    { cat: '看行事曆', q: '年、月、週、近期有什麼不同？', img: 'month.png', a: `
      <ul class="help-bullets">
        <li><strong>月</strong>：一個月的格子，有活動的日子有色點；點日期，下面會列出那天的活動。</li>
        <li><strong>年</strong>：一整年，點某一天會跳到那個月。</li>
        <li><strong>週</strong>：一週七天直向列出。</li>
        <li><strong>近期</strong>：今天起一個月有活動的日子，一次看完。</li>
      </ul>` },
    { cat: '看行事曆', q: '色點和標籤是什麼意思？', a: `
      <ul class="help-bullets">
        <li>色點顏色是類別：<span class="cat-tag cat-勤務">總務・勤務</span><span class="cat-tag cat-道務">道務</span><span class="cat-tag cat-教育">教育</span>。</li>
        <li>卡片下面的「派給：教慈區・烹飪、教全區・志工團」是這個活動分壇派給哪幾區、做什麼。</li>
        <li>右邊的<span class="badge badge-ok">各區已填 5 人</span>是各區組長填的名單加起來幾個人。</li>
      </ul>` },
    { cat: '報名', q: '怎麼看各區派誰去？', img: 'linked.png', a: `
      <p>點活動，下面的「<strong>各區名單</strong>」列出這個活動分壇派給哪幾區、各區組長填了誰（只有名字）、已填幾人（需要幾人）。還沒填的寫「還沒填名單」。</p>` },
    { cat: '報名', q: '怎麼報名？', a: `
      <p>這個行事曆<strong>只能看</strong>。分壇派給各區的勤務，由<strong>各區的組長</strong>統計好，登入後在這裡填名單。要去的家人請告訴自己區的組長。</p>` },
    { cat: '看行事曆', q: '活動資料從哪裡來？多久更新？', a: `
      <ul class="help-bullets">
        <li><strong>分壇的活動、派給各區的勤務</strong>：由分壇管理者輸入，存檔後大約 1 分鐘內大家都看得到。</li>
        <li><strong>各區名單</strong>：各區組長在這裡填，存檔後大約 1 分鐘內大家都看得到。</li>
      </ul>
      <p>打開網站時會先顯示上次的資料，同時在背景更新；上方出現「更新中⋯」就是正在拿最新的。</p>` },
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
        <li><span class="help-num">1</span><span>行事曆上方按「🔔 手機提醒」。</span></li>
        <li><span class="help-num">2</span><span>選要收哪個單位的提醒（您的區），按「開啟提醒」，手機問要不要允許通知時按「允許」。</span></li>
        <li><span class="help-num">3</span><span>按「傳測試通知」，幾秒內收到就成功了。</span></li>
      </ol>
      <p>每天<strong>晚上 8 點提醒明天</strong>、<strong>早上 7 點提醒今天</strong>的活動（選某一區＝那一區＋分壇；選分壇＝只有分壇），沒有活動那天不送。管理者也可能發重要通知。不用填名字。</p>
      <p><strong>iPhone、iPad</strong>：要先「加入主畫面」（見下一題），從主畫面打開才能開啟提醒，需要 iOS 16.4 以上。</p>` },
    { cat: '手機', q: '不想收提醒、或要換區？', a: `
      <p>按「🔔 手機提醒」，在「改成收哪個單位」換成別的區就好；不想收就按「關閉提醒」。</p>
      <p>沒收到通知：請確認手機的設定裡，有允許這個網站（或 Chrome、Safari）的通知，而且沒有開「勿擾模式」。</p>` },
    { cat: '手機', q: '字太小看不清楚？', a: `
      <p>按右上角的「A＋」，每按一次字會放大一級（共三級），再按就回到原本的大小。這支手機會記住。</p>` },
    { cat: '管理者', q: '怎麼新增、修改活動？', img: 'admin-list.png', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>按最下面的「管理者」，輸入管理密碼登入。</span></li>
        <li><span class="help-num">2</span><span>按「＋ 新增活動」，選單位、類別，填名稱、日期、時間、地點。派給區的勤務，也可以直接按志工團、烹飪團的組（組後面有寫是哪幾區，會自動選好；按了變深色就是選了）。</span></li>
        <li><span class="help-num">3</span><span>要改就按那一筆的「修改」；同樣的活動換日期，用「另存新的」最快。</span></li>
      </ol>
      <p>每一筆新增、修改、刪除都會記在「操作紀錄」。</p>` },
    { cat: '管理者', q: '其他區的活動怎麼一次匯入很多筆？', img: 'admin-import.png', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>把各區的活動資料（照片、文字、表格）交給 Claude，Claude 會整理成一個匯入檔（.json）。</span></li>
        <li><span class="help-num">2</span><span>後台按「匯入」→「📂 選匯入檔」，選那個檔案。</span></li>
        <li><span class="help-num">3</span><span>看預覽：✓ 是可以匯入的，紅色是有錯的（要請 Claude 改好），「已經有了」的會自動跳過，不會重複。</span></li>
        <li><span class="help-num">4</span><span>按「匯入 N 筆」，家人們大約 1 分鐘內就看得到。</span></li>
      </ol>
      <p>同一次匯入算「一批」。匯錯了，在「匯入」頁下面的「最近匯入的批次」按「刪除這批」，整批一次刪掉。</p>` },
    { cat: '管理者', q: '怎麼發通知給某一區或全部？', img: 'admin-push.png', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>後台按「📣 發通知」。</span></li>
        <li><span class="help-num">2</span><span>寫標題和內容，選發給「全部」或勾選某幾個單位（旁邊的數字是開啟提醒的手機數）。</span></li>
        <li><span class="help-num">3</span><span>選「馬上發」或「排定時間」，按「發出通知」，確認後送出。</span></li>
      </ol>
      <p>只會送到有開啟「🔔 手機提醒」的手機。排定的通知在送出前可以取消。每天早晚的活動提醒是自動的，不用另外發。</p>` },
    { cat: '管理者', q: '各區組長怎麼填名單？', img: 'roster-fill.png', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>打開分壇行事曆的活動，在自己區的名單旁邊按「<strong>✏️ 填寫名單</strong>」（或按最下面的「管理者」），帳號選<strong>自己的區</strong>，輸入分壇給的密碼。</span></li>
        <li><span class="help-num">2</span><span>會看到分壇派給這一區的勤務，每一欄填會去的人的名字，名字之間空一格、或用「、」「，」隔開都可以，按「儲存」。</span></li>
      </ol>
      <p>輸入框下面會即時顯示拆好的名字和人數，存好後大家看到的就是這樣（一律用「、」排好）。名字變<strong>黃色</strong>是超過 4 個字，請確認是不是兩個人黏在一起（是一個人就照存）；變<strong>紅色</strong>是太長，一定要拆開。</p>
      <p>活動有寫「名單 X/X 截止」的，過了那天組長就不能再改，要改請找分壇。</p>
      <p>組長帳號只能填名單，不能改活動。密碼由總管理者在後台「帳號」分頁設定。</p>` },
    { cat: '管理者', q: '教全區也一樣嗎？', a: `
      <p>一樣。分壇派給教全區的勤務，由教全區的組長用「教全區」帳號在這裡填名單。教全區自己的活動照舊在教全區行事曆。</p>` },
    { cat: '管理者', q: '怎麼備份資料？', a: `
      <p>後台「活動」頁按「⬇ 下載備份」，會下載一個檔案（全部活動和操作紀錄），存在電腦或雲端硬碟就好。建議每個月下載一次。</p>` }
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
      <div class="help-search"><input class="input help-q" type="search" placeholder="🔍 搜尋，例如：報名、主畫面" aria-label="搜尋常見問題"></div>
      <div id="help-list"></div>
      <a class="btn btn-block back-btn" href="#/">‹ 回行事曆</a>`;
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
