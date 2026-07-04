async function test() {
  const periods = ['5m', '15m', '1h', '4h', '1d', '1H', '4H', '1D'];
  for (const p of periods) {
    const url = `https://www.okx.com/api/v5/rubik/stat/margin/loan-ratio?ccy=BTC&period=${p}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      console.log(`Period ${p}: code = ${data.code}, data count = ${data.data ? data.data.length : 0}`);
    } catch (err) {
      console.error(`Period ${p} lỗi:`, err.message);
    }
  }
}
test();
