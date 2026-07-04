const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { RSI, EMA, MACD } = require('technicalindicators');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

// Cache dữ liệu nến & chỉ báo
let candles = []; // Mỗi nến: { time: number, open: number, high: number, low: number, close: number, volume: number, rsi, ema12, ema26, macd }
let currentTicker = { price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0 };
let indicators = { rsi: null, ema12: null, ema26: null, macd: null };

// Thống kê Rubik API từ OKX
let rubikData = {
  longShortRatio: [], // [{ time: number, ratio: number }]
  takerVolume: []     // [{ time: number, buyVol: number, sellVol: number, netVol: number }]
};

// Phân tích dòng tiền thời gian thực qua WebSocket trades
let recentTrades = []; // [{ time: number, sz: number, side: 'buy'|'sell' }]
let orderFlow24h = {
  buy: { superLarge: 0, large: 0, medium: 0, small: 0 },
  sell: { superLarge: 0, large: 0, medium: 0, small: 0 },
  totalBuy: 0,
  totalSell: 0
};

// Gọi OKX REST API để lấy dữ liệu nến lịch sử
async function fetchHistoricalCandles() {
  try {
    const url = 'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=5m&limit=100';
    const response = await fetch(url);
    const result = await response.json();
    if (result.code === '0' && result.data) {
      candles = result.data.map(c => ({
        time: parseInt(c[0]),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5])
      })).reverse();
      calculateIndicators();
      console.log(`Đã tải thành công ${candles.length} nến lịch sử từ OKX REST API.`);
    }
  } catch (error) {
    console.error('Lỗi khi tải nến lịch sử:', error.message);
  }
}

// Gọi OKX Rubik API để lấy Long/Short Ratio và Taker Volume
async function fetchRubikData() {
  try {
    // 1. Lấy Long/Short Ratio (Contracts)
    const lsUrl = 'https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=5m';
    const lsRes = await fetch(lsUrl);
    const lsResult = await lsRes.json();
    if (lsResult.code === '0' && lsResult.data) {
      rubikData.longShortRatio = lsResult.data.slice(0, 50).map(d => ({
        time: parseInt(d[0]),
        ratio: parseFloat(d[1])
      })).reverse();
    }

    // 2. Lấy Taker Volume (Spot)
    const tvUrl = 'https://www.okx.com/api/v5/rubik/stat/taker-volume?ccy=BTC&period=5m&instType=SPOT';
    const tvRes = await fetch(tvUrl);
    const tvResult = await tvRes.json();
    if (tvResult.code === '0' && tvResult.data) {
      rubikData.takerVolume = tvResult.data.slice(0, 50).map(d => {
        const buyVol = parseFloat(d[1]);
        const sellVol = parseFloat(d[2]);
        return {
          time: parseInt(d[0]),
          buyVol: buyVol,
          sellVol: sellVol,
          netVol: buyVol - sellVol
        };
      }).reverse();
    }

    console.log('Đã tải và cập nhật thành công dữ liệu thống kê Rubik từ OKX.');
    broadcastData();
  } catch (error) {
    console.error('Lỗi khi tải dữ liệu Rubik:', error.message);
  }
}

// Tính toán các chỉ báo kỹ thuật
function calculateIndicators() {
  if (candles.length < 30) return;

  const closes = candles.map(c => c.close);

  // 1. Tính toán mảng các chỉ báo
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const ema12Values = EMA.calculate({ values: closes, period: 12 });
  const ema26Values = EMA.calculate({ values: closes, period: 26 });
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });

  // 2. Map chỉ số vào từng nến
  const rsiOffset = candles.length - rsiValues.length;
  const ema12Offset = candles.length - ema12Values.length;
  const ema26Offset = candles.length - ema26Values.length;
  const macdOffset = candles.length - macdValues.length;

  for (let i = 0; i < candles.length; i++) {
    candles[i].rsi = i >= rsiOffset ? rsiValues[i - rsiOffset] : null;
    candles[i].ema12 = i >= ema12Offset ? ema12Values[i - ema12Offset] : null;
    candles[i].ema26 = i >= ema26Offset ? ema26Values[i - ema26Offset] : null;
    candles[i].macd = i >= macdOffset ? macdValues[i - macdOffset] : null;
  }

  // 3. Cập nhật biến indicators toàn cục với dữ liệu của nến mới nhất
  const lastCandle = candles[candles.length - 1];
  indicators = {
    rsi: lastCandle.rsi,
    ema12: lastCandle.ema12,
    ema26: lastCandle.ema26,
    macd: lastCandle.macd
  };
}

// Tính toán Phân phối Dòng tiền 24h
let flowUpdatePending = false;
function calculateOrderFlow() {
  if (flowUpdatePending) return;
  flowUpdatePending = true;

  // Thực hiện tính toán sau một khoảng trễ nhỏ để gom nhóm các giao dịch (thay vì tính liên tục gây block event loop)
  setTimeout(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    recentTrades = recentTrades.filter(t => t.time >= cutoff);

    const flow = {
      buy: { superLarge: 0, large: 0, medium: 0, small: 0 },
      sell: { superLarge: 0, large: 0, medium: 0, small: 0 },
      totalBuy: 0,
      totalSell: 0
    };

    recentTrades.forEach(t => {
      const sz = t.sz;
      if (t.side === 'buy') {
        flow.totalBuy += sz;
        if (sz >= 1.0) flow.buy.superLarge += sz;
        else if (sz >= 0.1) flow.buy.large += sz;
        else if (sz >= 0.01) flow.buy.medium += sz;
        else flow.buy.small += sz;
      } else if (t.side === 'sell') {
        flow.totalSell += sz;
        if (sz >= 1.0) flow.sell.superLarge += sz;
        else if (sz >= 0.1) flow.sell.large += sz;
        else if (sz >= 0.01) flow.sell.medium += sz;
        else flow.sell.small += sz;
      }
    });

    orderFlow24h = flow;
    flowUpdatePending = false;
    broadcastData();
  }, 500);
}

// Kết nối WebSocket OKX
let okxWs;
function connectOKX() {
  console.log('Đang kết nối đến OKX WebSocket...');
  okxWs = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');

  okxWs.on('open', () => {
    console.log('Đã kết nối thành công đến OKX WebSocket!');
    // Subscribe tickers, candle5m và trades
    const subscribeMsg = {
      op: 'subscribe',
      args: [
        { channel: 'tickers', instId: 'BTC-USDT' },
        { channel: 'candle5m', instId: 'BTC-USDT' },
        { channel: 'trades', instId: 'BTC-USDT' }
      ]
    };
    okxWs.send(JSON.stringify(subscribeMsg));
  });

  okxWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.event === 'subscribe') {
        console.log(`Đã subscribe thành công kênh: ${msg.arg.channel}`);
        return;
      }

      if (msg.arg && msg.data && msg.data.length > 0) {
        const channel = msg.arg.channel;

        if (channel === 'tickers') {
          const rawData = msg.data[0];
          currentTicker = {
            price: parseFloat(rawData.last),
            change24h: ((parseFloat(rawData.last) - parseFloat(rawData.open24h)) / parseFloat(rawData.open24h) * 100),
            high24h: parseFloat(rawData.high24h),
            low24h: parseFloat(rawData.low24h),
            volume24h: parseFloat(rawData.vol24h)
          };
          broadcastData();
        } else if (channel === 'candle5m') {
          const rawData = msg.data[0];
          const candleTime = parseInt(rawData[0]);
          const newCandle = {
            time: candleTime,
            open: parseFloat(rawData[1]),
            high: parseFloat(rawData[2]),
            low: parseFloat(rawData[3]),
            close: parseFloat(rawData[4]),
            volume: parseFloat(rawData[5])
          };

          const lastCandleIdx = candles.findIndex(c => c.time === candleTime);
          if (lastCandleIdx !== -1) {
            candles[lastCandleIdx] = newCandle;
          } else {
            if (candles.length > 0 && candleTime > candles[candles.length - 1].time) {
              candles.push(newCandle);
              if (candles.length > 150) {
                candles.shift();
              }
            }
          }

          calculateIndicators();
          broadcastData();
        } else if (channel === 'trades') {
          // Nhận các giao dịch thời gian thực
          msg.data.forEach(t => {
            recentTrades.push({
              time: parseInt(t.ts),
              sz: parseFloat(t.sz),
              side: t.side // 'buy' hoặc 'sell'
            });
          });
          calculateOrderFlow();
        }
      }
    } catch (err) {
      console.error('Lỗi phân tích dữ liệu WebSocket OKX:', err);
    }
  });

  okxWs.on('close', () => {
    console.log('Kết nối WebSocket OKX bị đóng. Đang thử kết nối lại sau 5 giây...');
    setTimeout(connectOKX, 5000);
  });

  okxWs.on('error', (err) => {
    console.error('Lỗi WebSocket OKX:', err.message);
    okxWs.close();
  });
}

// Gửi dữ liệu cập nhật cho các Client đang kết nối
function broadcastData() {
  const payload = JSON.stringify({
    ticker: currentTicker,
    indicators: indicators,
    lastCandle: candles[candles.length - 1] || null,
    orderFlow24h: orderFlow24h,
    rubikData: rubikData
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Xử lý kết nối client nội bộ
wss.on('connection', (ws) => {
  console.log('Một Client mới đã kết nối qua WebSocket.');
  ws.send(JSON.stringify({
    ticker: currentTicker,
    indicators: indicators,
    candles: candles.slice(-50),
    orderFlow24h: orderFlow24h,
    rubikData: rubikData
  }));

  ws.on('close', () => {
    console.log('Client ngắt kết nối.');
  });
});

// Khởi chạy hệ thống
async function init() {
  await fetchHistoricalCandles();
  await fetchRubikData();
  connectOKX();
  
  // Định kỳ tải dữ liệu Rubik Thống kê (5 phút một lần)
  setInterval(fetchRubikData, 5 * 60 * 1000);

  // Tránh ping/pong timeout trên Render
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
  }, 30000);

  server.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
  });
}

init();
