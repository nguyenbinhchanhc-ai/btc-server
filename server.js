const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { RSI, EMA, MACD } = require('technicalindicators');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

// Cache nến lịch sử
let candles = []; // Mỗi nến: { time: number, open: number, high: number, low: number, close: number, volume: number }
let currentTicker = { price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0 };
let indicators = { rsi: null, ema12: null, ema26: null, macd: null };

// Gọi OKX REST API để lấy dữ liệu nến lịch sử
async function fetchHistoricalCandles() {
  try {
    const url = 'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=5m&limit=100';
    const response = await fetch(url);
    const result = await response.json();
    if (result.code === '0' && result.data) {
      // Dữ liệu OKX trả về từ mới nhất -> cũ nhất, cần đảo ngược lại
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

// Tính toán các chỉ báo kỹ thuật
function calculateIndicators() {
  if (candles.length < 30) return;

  const closes = candles.map(c => c.close);

  // 1. Tính RSI 14
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  indicators.rsi = rsiValues[rsiValues.length - 1] || null;

  // 2. Tính EMA 12 và 26
  const ema12Values = EMA.calculate({ values: closes, period: 12 });
  const ema26Values = EMA.calculate({ values: closes, period: 26 });
  indicators.ema12 = ema12Values[ema12Values.length - 1] || null;
  indicators.ema26 = ema26Values[ema26Values.length - 1] || null;

  // 3. Tính MACD (12, 26, 9)
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  indicators.macd = macdValues[macdValues.length - 1] || null;
}

// Kết nối WebSocket OKX
let okxWs;
function connectOKX() {
  console.log('Đang kết nối đến OKX WebSocket...');
  // OKX Public WS
  okxWs = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');

  okxWs.on('open', () => {
    console.log('Đã kết nối thành công đến OKX WebSocket!');
    // Subscribe tickers và candle5m
    const subscribeMsg = {
      op: 'subscribe',
      args: [
        { channel: 'tickers', instId: 'BTC-USDT' },
        { channel: 'candle5m', instId: 'BTC-USDT' }
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
        const rawData = msg.data[0];

        if (channel === 'tickers') {
          currentTicker = {
            price: parseFloat(rawData.last),
            change24h: ((parseFloat(rawData.last) - parseFloat(rawData.sopen)) / parseFloat(rawData.sopen) * 100),
            high24h: parseFloat(rawData.high24h),
            low24h: parseFloat(rawData.low24h),
            volume24h: parseFloat(rawData.vol24h)
          };
          broadcastData();
        } else if (channel === 'candle5m') {
          // Định dạng nến: [time, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
          const candleTime = parseInt(rawData[0]);
          const newCandle = {
            time: candleTime,
            open: parseFloat(rawData[1]),
            high: parseFloat(rawData[2]),
            low: parseFloat(rawData[3]),
            close: parseFloat(rawData[4]),
            volume: parseFloat(rawData[5])
          };
          const confirm = rawData[8] === '1'; // '1' là nến đã đóng, '0' là nến đang chạy

          const lastCandleIdx = candles.findIndex(c => c.time === candleTime);
          if (lastCandleIdx !== -1) {
            // Cập nhật nến hiện tại đang chạy
            candles[lastCandleIdx] = newCandle;
          } else {
            // Nếu là nến mới hoàn toàn
            if (candles.length > 0 && candleTime > candles[candles.length - 1].time) {
              candles.push(newCandle);
              if (candles.length > 150) {
                candles.shift();
              }
            }
          }

          calculateIndicators();
          broadcastData();
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
    lastCandle: candles[candles.length - 1] || null
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
  // Gửi trạng thái hiện tại ngay khi client kết nối
  ws.send(JSON.stringify({
    ticker: currentTicker,
    indicators: indicators,
    candles: candles.slice(-50) // Gửi 50 nến gần nhất để vẽ biểu đồ ban đầu
  }));

  ws.on('close', () => {
    console.log('Client ngắt kết nối.');
  });
});

// Khởi chạy hệ thống
async function init() {
  await fetchHistoricalCandles();
  connectOKX();
  
  // Tránh ping/pong timeout trên Render (Render Free Web Services sẽ sleep nếu không có HTTP request, 
  // nhưng ở đây có WebSocket hoạt động. Đồng thời ta tạo ping định kỳ để giữ kết nối client)
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
