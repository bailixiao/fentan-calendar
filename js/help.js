// 常見問題（#/help）。每次加新功能或畫面改變，都要同時更新這裡和 img/help 的截圖（tools/help-shots.js）。
(function () {
  'use strict';

  // img：img/help 的截圖（tools/help-shots.js 產生），截圖裡只有假資料
  const ITEMS = [
    { cat: '看行事曆', q: '這個行事曆是什麼？', a: `
      <p>宏教分壇和底下 16 區的活動，都放在這一個行事曆上，打開就能看到最近有什麼法會、課程、勤務。</p>
      <p>不用登入，也不用填任何資料。</p>` },
    { cat: '看行事曆', q: '怎麼只看我們區的活動？', img: 'filter.png', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>行事曆上方「看哪個單位」選您的區，例如「教真區」。</span></li>
        <li><span class="help-num">2</span><span>下面的「也顯示分壇的活動」預設有勾，分壇的大活動也會一起出現。不想看分壇的就把勾拿掉。</span></li>
      </ol>
      <p>這支手機會記住您選的，下次打開還是同一區。</p>` },
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
        <li>外面有一圈<strong>金框</strong>的是<strong>分壇</strong>的活動。</li>
        <li>卡片上方的小標籤寫是哪個單位（<span class="unit-tag is-fentan">分壇</span>或<span class="unit-tag">某一區</span>）和類別。</li>
      </ul>` },
    { cat: '看行事曆', q: '點活動可以看到什麼？', img: 'detail.png', a: `
      <p>日期（含農曆）、時間、地點、說明。教全區的活動會有「到教全區報名」的大按鈕。</p>` },
    { cat: '報名', q: '怎麼報名？', a: `
      <p>這個行事曆<strong>只能看，不能報名</strong>。</p>
      <ul class="help-bullets">
        <li><strong>教全區</strong>的活動：點進去按「到教全區報名」，會打開教全區的報名頁，在那裡報名、取消、改期。</li>
        <li>其他區、分壇的活動：請照各區、分壇原本的方式報名，或問各區的負責人。</li>
      </ul>` },
    { cat: '看行事曆', q: '活動資料從哪裡來？多久更新？', a: `
      <ul class="help-bullets">
        <li><strong>教全區</strong>：自動從教全區的行事曆讀進來，大約 5 分鐘內會跟上。</li>
        <li><strong>分壇和其他區</strong>：由管理者輸入，存檔後大約 1 分鐘內大家都看得到。</li>
      </ul>
      <p>打開網站時會先顯示上次的資料，同時在背景更新；上方出現「更新中⋯」就是正在拿最新的。</p>` },
    { cat: '看行事曆', q: '畫面說「教全區的活動暫時讀不到」？', a: `
      <p>教全區的系統暫時連不上，其他活動照常顯示。稍後會自動再試，不用做任何事。</p>` },
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
    { cat: '手機', q: '字太小看不清楚？', a: `
      <p>按右上角的「A＋」，每按一次字會放大一級（共三級），再按就回到原本的大小。這支手機會記住。</p>` },
    { cat: '管理者', q: '怎麼新增、修改活動？', img: 'admin-list.png', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>按最下面的「管理者」，輸入管理密碼登入。</span></li>
        <li><span class="help-num">2</span><span>按「＋ 新增活動」，選單位、類別，填名稱、日期、時間、地點。</span></li>
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
    { cat: '管理者', q: '教全區的活動要輸入嗎？', a: `
      <p>不用。教全區的活動會自動從教全區的系統讀進來，後台也不能選教全區。</p>` },
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
