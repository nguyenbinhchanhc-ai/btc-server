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

// Thống kê Rubik API từ OKX (đầy đủ các period)
let rubikData = {
  longShortRatio: {
    '5m': [],
    '15m': [],
    '1h': [],
    '4h': [],
    '1d': []
  },
  takerVolume: {
    '5m': [],
    '1h': [],
    '1d': []
  }
};

// Phân tích dòng tiền thời gian thực qua WebSocket trades
let recentTrades = []; // [{ time: number, sz: number, side: 'buy'|'sell' }]

// Cache phân phối dòng tiền của 5 khung thời gian để gửi về client
let orderFlows = {
  '5m': { buy: { superLarge: 0, large: 0, medium: 0, small: 0 }, sell: { superLarge: 0, large: 0, medium: 0, small: 0 }, totalBuy: 0, totalSell: 0 },
  '15m': { buy: { superLarge: 0, large: 0, medium: 0, small: 0 }, sell: { superLarge: 0, large: 0, medium: 0, small: 0 }, totalBuy: 0, totalSell: 0 },
  '1h': { buy: { superLarge: 0, large: 0, medium: 0, small: 0 }, sell: { superLarge: 0, large: 0, medium: 0, small: 0 }, totalBuy: 0, totalSell: 0 },
  '4h': { buy: { superLarge: 0, large: 0, medium: 0, small: 0 }, sell: { superLarge: 0, large: 0, medium: 0, small: 0 }, totalBuy: 0, totalSell: 0 },
  '1d': { buy: { superLarge: 0, large: 0, medium: 0, small: 0 }, sell: { superLarge: 0, large: 0, medium: 0, small: 0 }, totalBuy: 0, totalSell: 0 }
};

let tickerChanged = false;
let orderFlowsChanged = false;

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
      
      // Khởi tạo trades giả lập để làm đầy dữ liệu 24h ban đầu
      generateFakeTradesFromCandles();
    }
  } catch (error) {
    console.error('Lỗi khi tải nến lịch sử:', error.message);
  }
}

// Giả lập trades lịch sử dựa trên nến để lấp đầy dữ liệu ban đầu cho các khung thời gian
function generateFakeTradesFromCandles() {
  recentTrades = [];
  candles.forEach(c => {
    const numTrades = 20; // 20 trades mỗi nến 5m
    const volPerTrade = c.volume / numTrades;
    let buyRatio = 0.5;
    
    if (c.close > c.open) buyRatio = 0.53;
    else if (c.close < c.open) buyRatio = 0.47;

    for (let i = 0; i < numTrades; i++) {
      const side = Math.random() < buyRatio ? 'buy' : 'sell';
      const rand = Math.random();
      let sz = volPerTrade;
      
      // Phân bổ ngẫu nhiên kích cỡ lệnh
      if (rand < 0.04) sz = volPerTrade * 10;      // Siêu lớn
      else if (rand < 0.15) sz = volPerTrade * 3;  // Lớn
      else if (rand < 0.45) sz = volPerTrade * 1;  // Trung bình
      else sz = volPerTrade * 0.3;                 // Nhỏ

      recentTrades.push({
        time: c.time + i * (5 * 60 * 1000 / numTrades),
        sz: sz,
        side: side
      });
    }
  });
  console.log(`Đã giả lập ${recentTrades.length} trades lịch sử để lấp đầy dữ liệu.`);
  calculateAllOrderFlows();
}

// Gọi OKX Rubik API để lấy dữ liệu thống kê Long/Short và Taker Volume (tất cả các period)
async function fetchRubikData() {
  try {
    const periodsLS = { '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D' };
    const periodsTV = { '5m': '5m', '1h': '1H', '1d': '1D' };

    // 1. Fetch Margin Loan Ratios (Tỷ lệ long/short ký quỹ)
    for (const [key, apiPeriod] of Object.entries(periodsLS)) {
      const url = `https://www.okx.com/api/v5/rubik/stat/margin/loan-ratio?ccy=BTC&period=${apiPeriod}`;
      const res = await fetch(url);
      const result = await res.json();
      if (result.code === '0' && result.data) {
        rubikData.longShortRatio[key] = result.data.slice(0, 50).map(d => ({
          time: parseInt(d[0]),
          ratio: parseFloat(d[1])
        })).reverse();
      }
      // Delay nhỏ để tránh rate limit
      await new Promise(r => setTimeout(r, 100));
    }

    // 2. Fetch Taker Volumes (Spot Taker Buy/Sell)
    for (const [key, apiPeriod] of Object.entries(periodsTV)) {
      const url = `https://www.okx.com/api/v5/rubik/stat/taker-volume?ccy=BTC&period=${apiPeriod}&instType=SPOT`;
      const res = await fetch(url);
      const result = await res.json();
      if (result.code === '0' && result.data) {
        rubikData.takerVolume[key] = result.data.slice(0, 50).map(d => {
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
      await new Promise(r => setTimeout(r, 100));
    }

    console.log('Đã tải thành công toàn bộ dữ liệu thống kê Rubik nâng cao từ OKX.');
    broadcast({ type: 'rubik', rubikData: rubikData });
  } catch (error) {
    console.error('Lỗi khi tải dữ liệu Rubik nâng cao:', error.message);
  }
}

// Tính toán các chỉ báo kỹ thuật
function calculateIndicators() {
  if (candles.length < 30) return;

  const closes = candles.map(c => c.close);

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

  const lastCandle = candles[candles.length - 1];
  indicators = {
    rsi: lastCandle.rsi,
    ema12: lastCandle.ema12,
    ema26: lastCandle.ema26,
    macd: lastCandle.macd
  };
}

// Tính toán phân bổ dòng tiền cho một khung thời gian cụ thể
function getFlowForDuration(durationMs) {
  const cutoff = Date.now() - durationMs;
  const filtered = recentTrades.filter(t => t.time >= cutoff);

  const flow = {
    buy: { superLarge: 0, large: 0, medium: 0, small: 0 },
    sell: { superLarge: 0, large: 0, medium: 0, small: 0 },
    totalBuy: 0,
    totalSell: 0
  };

  filtered.forEach(t => {
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

  return flow;
}

// Tính toán đồng thời cả 5 khung thời gian của Order Flow
let flowUpdatePending = false;
function calculateAllOrderFlows() {
  if (flowUpdatePending) return;
  flowUpdatePending = true;

  setTimeout(() => {
    // Giới hạn recentTrades tối đa 24h để tránh phình bộ nhớ
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    recentTrades = recentTrades.filter(t => t.time >= cutoff24h);

    orderFlows['5m'] = getFlowForDuration(5 * 60 * 1000);
    orderFlows['15m'] = getFlowForDuration(15 * 60 * 1000);
    orderFlows['1h'] = getFlowForDuration(60 * 60 * 1000);
    orderFlows['4h'] = getFlowForDuration(4 * 60 * 60 * 1000);
    orderFlows['1d'] = getFlowForDuration(24 * 60 * 60 * 1000);

    orderFlowsChanged = true;
    flowUpdatePending = false;
  }, 500);
}

// Kết nối WebSocket OKX
let okxWs;
function connectOKX() {
  console.log('Đang kết nối đến OKX WebSocket...');
  okxWs = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');

  okxWs.on('open', () => {
    console.log('Đã kết nối thành công đến OKX WebSocket!');
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
          tickerChanged = true;
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
          
          broadcast({
            type: 'candle',
            lastCandle: candles[candles.length - 1] || null,
            indicators: indicators
          });
        } else if (channel === 'trades') {
          msg.data.forEach(t => {
            recentTrades.push({
              time: parseInt(t.ts),
              sz: parseFloat(t.sz),
              side: t.side
            });
          });
          calculateAllOrderFlows();
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

function broadcast(dataObj) {
  const payload = JSON.stringify(dataObj);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Loop gửi dữ liệu realtime (1 giây một lần)
setInterval(() => {
  if (tickerChanged) {
    broadcast({ type: 'ticker', ticker: currentTicker });
    tickerChanged = false;
  }
  if (orderFlowsChanged) {
    broadcast({ type: 'orderFlows', orderFlows: orderFlows });
    orderFlowsChanged = false;
  }
}, 1000);

// Xử lý kết nối client
wss.on('connection', (ws) => {
  console.log('Một Client mới đã kết nối qua WebSocket.');
  ws.send(JSON.stringify({
    type: 'init',
    ticker: currentTicker,
    indicators: indicators,
    candles: candles.slice(-50),
    orderFlows: orderFlows,
    rubikData: rubikData
  }));

  ws.on('close', () => {
    console.log('Client ngắt kết nối.');
  });
});

async function init() {
  await fetchHistoricalCandles();
  await fetchRubikData();
  connectOKX();
  
  // Định kỳ fetch Rubik (5 phút/lần)
  setInterval(fetchRubikData, 5 * 60 * 1000);

  // Ping client giữ kết nối
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
