// 網站設定（前端）：名稱、區名、班的顏色。和後端 worker/src/site.js 的共同欄位要一致（tests/site.test.mjs 會檢查）。
// 這裡只放公開的字，不放人名、電話。
(function () {
  window.SITE = {
    name: '分壇教育組報名',
    fentan: '分壇', // 手機提醒選「全部」時存這個
    // 16 區，順序就是畫面上的順序
    units: ['教真區', '教善區', '教美區', '教志區', '教孝區', '教仁區', '教勇區', '教定區',
      '教慧區', '教力區', '教發區', '教慈區', '教捨區', '教全區', '教振區', '教理區'],
    roll: '點名', // 點名帳號（幹部共用一組密碼）
    colors: ['green', 'blue', 'orange', 'purple', 'red', 'teal'], // 班的顏色
    colorNames: { green: '綠', blue: '藍', orange: '橘', purple: '紫', red: '紅', teal: '青' }
  };
})();
