// 網站設定（後端）：名稱、區名、類別。和前端 js/site.js 的共同欄位要一致（tests/site.test.js 會檢查）。
// 這裡只放公開的字，不放人名、電話。
export const SITE = {
  name: '宏教分壇行事曆',
  fentan: '分壇', // 分壇自己的活動在「單位」欄寫這個
  // 16 區，順序就是畫面上的順序
  units: ['教真區', '教善區', '教美區', '教志區', '教孝區', '教仁區', '教勇區', '教定區',
    '教慧區', '教力區', '教發區', '教慈區', '教捨區', '教全區', '教振區', '教理區'],
  categories: ['勤務', '道務', '教育'],
  // 有自己系統、活動自動讀進來的區：後台不能手動新增這一區的活動
  jiaoquan: {
    unit: '教全區',
    api: 'https://duty-calendar-api.duty-calendar-worker.workers.dev/',
    site: 'https://bailixiao.github.io/duty-calendar/'
  }
};
