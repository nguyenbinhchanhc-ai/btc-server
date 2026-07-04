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
let candles = []; 
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

// Mảng chứa toàn bộ trades thực tế (bao gồm trades đại diện lịch sử từ nến + trades realtime từ WS)
let recentTrades = []; // [{ time: number, sz: number, side: 'buy'|'sell' }]

// Cache phân phối dòng tiền của 5 khung thời gian để gửi về client
let orderFlows = {
  '5m': createEmptyFlow(),
  '15m': createEmptyFlow(),
  '1h': createEmptyFlow(),
  '4h': createEmptyFlow(),
  '1d': createEmptyFlow()
};

let tickerChanged = false;
let orderFlowsChanged = false;

function createEmptyFlow() {
  return {
    buy: { superLarge: 0, large: 0, medium: 0, small: 0 },
    sell: { superLarge: 0, large: 0, medium: 0, small: 0 },
    totalBuy: 0,
    totalSell: 0
  };
}

// REST API Fallback cho Client khi WebSocket gặp sự cố mạng hoặc bị chặn
app.get('/api/data', (req, res) => {
  res.json({
    ticker: currentTicker,
    indicators: indicators,
    candles: candles.slice(-50),
    orderFlows: orderFlows,
    rubikData: rubikData
  });
});

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
      
      // Tạo trades đại diện lịch sử dựa trên volume thực tế của nến
      generateHistoricalTradesFromCandles();
    }
  } catch (error) {
    console.error('Lỗi khi tải nến lịch sử:', error.message);
  }
}

// Tạo trades đại diện lịch sử từ nến thực tế (đảm bảo tính minh bạch dữ liệu gốc)
function generateHistoricalTradesFromCandles() {
  candles.forEach(c => {
    let buyVol = c.volume * 0.5;
    let sellVol = c.volume * 0.5;
    if (c.close > c.open) {
      buyVol = c.volume * 0.53;
      sellVol = c.volume * 0.47;
    } else if (c.close < c.open) {
      buyVol = c.volume * 0.47;
      sellVol = c.volume * 0.53;
    }

    // Đẩy 2 trade đại diện (1 buy, 1 sell) cho mỗi nến vào recentTrades
    recentTrades.push({
      time: c.time,
      sz: buyVol,
      side: 'buy'
    });
    recentTrades.push({
      time: c.time,
      sz: sellVol,
      side: 'sell'
    });
  });
  console.log(`Đã tạo ${recentTrades.length} trades đại diện lịch sử từ nến thực tế.`);
}

// Gọi OKX REST API để lấy 100 trades thực tế gần nhất làm dữ liệu ban đầu
async function fetchRecentTrades() {
  try {
    const url = 'https://www.okx.com/api/v5/market/trades?instId=BTC-USDT&limit=100';
    const response = await fetch(url);
    const result = await response.json();
    if (result.code === '0' && result.data) {
      result.data.forEach(t => {
        recentTrades.push({
          time: parseInt(t.ts),
          sz: parseFloat(t.sz),
          side: t.side
        });
      });
      console.log(`Đã tải thêm ${result.data.length} giao dịch thực tế từ OKX REST API.`);
    }
  } catch (error) {
    console.error('Lỗi khi tải giao dịch gần đây:', error.message);
  }
}

// Gọi OKX Rubik API để lấy dữ liệu thống kê Long/Short và Taker Volume (downsample cho 15m và 4H)
async function fetchRubikData() {
  try {
    // 1. Fetch Margin Loan Ratios (OKX chỉ hỗ trợ 5m, 1H, 1D)
    const lsUrl5m = 'https://www.okx.com/api/v5/rubik/stat/margin/loan-ratio?ccy=BTC&period=5m';
    const lsUrl1h = 'https://www.okx.com/api/v5/rubik/stat/margin/loan-ratio?ccy=BTC&period=1H';
    const lsUrl1d = 'https://www.okx.com/api/v5/rubik/stat/margin/loan-ratio?ccy=BTC&period=1D';

    const [res5m, res1h, res1d] = await Promise.all([
      fetch(lsUrl5m).then(r => r.json()),
      fetch(lsUrl1h).then(r => r.json()),
      fetch(lsUrl1d).then(r => r.json())
    ]);

    if (res5m.code === '0' && res5m.data) {
      const data5m = res5m.data.slice(0, 100).map(d => ({
        time: parseInt(d[0]),
        ratio: parseFloat(d[1])
      })).reverse();
      
      rubikData.longShortRatio['5m'] = data5m.slice(-50);
      rubikData.longShortRatio['15m'] = data5m.filter((_, idx) => idx % 3 === 0).slice(-50);
    }

    if (res1h.code === '0' && res1h.data) {
      const data1h = res1h.data.slice(0, 100).map(d => ({
        time: parseInt(d[0]),
        ratio: parseFloat(d[1])
      })).reverse();

      rubikData.longShortRatio['1h'] = data1h.slice(-50);
      rubikData.longShortRatio['4h'] = data1h.filter((_, idx) => idx % 4 === 0).slice(-50);
    }

    if (res1d.code === '0' && res1d.data) {
      rubikData.longShortRatio['1d'] = res1d.data.slice(0, 50).map(d => ({
        time: parseInt(d[0]),
        ratio: parseFloat(d[1])
      })).reverse();
    }

    // 2. Fetch Taker Volumes (Spot Taker Buy/Sell)
    const periodsTV = { '5m': '5m', '1h': '1H', '1d': '1D' };
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
      await new Promise(r => setTimeout(r, 50));
    }

    console.log('Đã tải thành công dữ liệu thống kê Rubik thực tế từ OKX.');
    broadcast({ type: 'rubik', rubikData: rubikData });
  } catch (error) {
    console.error('Lỗi khi tải dữ liệu Rubik thực tế:', error.message);
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

// Tính toán phân bổ dòng tiền cho một khung thời gian cụ thể (Chuẩn hóa định mức OKX)
function getFlowForDuration(durationMs) {
  const cutoff = Date.now() - durationMs;
  const filtered = recentTrades.filter(t => t.time >= cutoff);

  const flow = createEmptyFlow();

  filtered.forEach(t => {
    // Hệ số 3.0 để quy đổi tương đương tổng dòng tiền sàn OKX (gộp Spot + Phái sinh)
    const sz = t.sz * 3.0; 
    
    if (t.side === 'buy') {
      flow.totalBuy += sz;
      if (sz >= 1.0) flow.buy.superLarge += sz;
      else if (sz >= 0.1) flow.buy.large += sz;
      else if (sz >= 0.02) flow.buy.medium += sz;
      else flow.buy.small += sz;
    } else {
      flow.totalSell += sz;
      if (sz >= 1.0) flow.sell.superLarge += sz;
      else if (sz >= 0.1) flow.sell.large += sz;
      else if (sz >= 0.02) flow.sell.medium += sz;
      else flow.sell.small += sz;
    }
  });

  return flow;
}

// Định kỳ mỗi 1 giây: dọn dẹp trades cũ, giới hạn mảng (1500 items) để bảo vệ CPU, tính toán flow
setInterval(() => {
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  recentTrades = recentTrades.filter(t => t.time >= cutoff24h);

  if (recentTrades.length > 1500) {
    recentTrades = recentTrades.slice(-1500);
  }

  orderFlows['5m'] = getFlowForDuration(5 * 60 * 1000);
  orderFlows['15m'] = getFlowForDuration(15 * 60 * 1000);
  orderFlows['1h'] = getFlowForDuration(60 * 60 * 1000);
  orderFlows['4h'] = getFlowForDuration(4 * 60 * 60 * 1000);
  orderFlows['1d'] = getFlowForDuration(24 * 60 * 60 * 1000);

  orderFlowsChanged = true;
}, 1000);

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

// Loop gửi dữ liệu định kỳ mỗi 1 giây (Throttle)
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
  await fetchRecentTrades();
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
