// Khởi tạo Lucide Icons
lucide.createIcons();

// Trạng thái DOM
const connStatus = document.getElementById('connection-status');
const statusText = connStatus.querySelector('.status-text');
const priceEl = document.getElementById('btc-price');
const changeEl = document.getElementById('btc-change');
const highEl = document.getElementById('btc-high');
const lowEl = document.getElementById('btc-low');
const volumeEl = document.getElementById('btc-volume');

const rsiValEl = document.getElementById('rsi-val');
const rsiStatusEl = document.getElementById('rsi-status');
const rsiBarEl = document.getElementById('rsi-bar');

const ema12El = document.getElementById('ema12-val');
const ema26El = document.getElementById('ema26-val');
const emaCrossEl = document.getElementById('ema-cross-status');

const macdValEl = document.getElementById('macd-val');
const macdSigEl = document.getElementById('macd-sig-val');
const macdHistEl = document.getElementById('macd-hist-val');
const macdStatusEl = document.getElementById('macd-status');

// Cấu hình biểu đồ Chart.js
let priceChart = null;
let rsiChart = null;
const MAX_CHART_POINTS = 50;

let lastPrice = 0;

function formatCurrency(num) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(num);
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Khởi tạo biểu đồ
function initCharts(historicalCandles) {
  const ctxPrice = document.getElementById('priceChart').getContext('2d');
  const ctxRsi = document.getElementById('rsiChart').getContext('2d');

  // Chuẩn bị dữ liệu ban đầu từ lịch sử nến
  const labels = historicalCandles.map(c => formatTime(c.time));
  const prices = historicalCandles.map(c => c.close);
  
  // Tính EMA cho biểu đồ nếu backend gửi nến nhưng chưa có EMA tương ứng cho từng nến
  // (Chúng ta có thể vẽ đơn giản đường giá trước, khi có update EMA từ backend thì cập nhật)
  // Thực tế, ta sẽ vẽ các đường dựa trên dữ liệu cập nhật.
  // Để tối giản và chính xác, biểu đồ sẽ vẽ:
  // - Đường giá BTC
  // - Đường EMA12
  // - Đường EMA26
  // Chúng ta sẽ lưu trữ mảng cục bộ cho chart data
  const chartData = {
    labels: labels,
    prices: prices,
    ema12: historicalCandles.map(c => c.ema12 !== undefined ? c.ema12 : null),
    ema26: historicalCandles.map(c => c.ema26 !== undefined ? c.ema26 : null),
    rsi: historicalCandles.map(c => c.rsi !== undefined ? c.rsi : null)
  };

  // Cấu hình Price + EMA Chart
  priceChart = new Chart(ctxPrice, {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [
        {
          label: 'Giá BTC',
          data: chartData.prices,
          borderColor: '#f7931a',
          backgroundColor: 'rgba(247, 147, 26, 0.05)',
          fill: true,
          tension: 0.2,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5
        },
        {
          label: 'EMA 12',
          data: chartData.ema12,
          borderColor: '#0ecb81',
          fill: false,
          tension: 0.2,
          borderWidth: 1.5,
          pointRadius: 0
        },
        {
          label: 'EMA 26',
          data: chartData.ema26,
          borderColor: '#f6465d',
          fill: false,
          tension: 0.2,
          borderWidth: 1.5,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#848e9c', font: { family: 'Outfit' } } }
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.03)' }, ticks: { color: '#848e9c', font: { family: 'Outfit' } } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.03)' }, ticks: { color: '#848e9c', font: { family: 'Outfit' } } }
      }
    }
  });

  // Cấu hình RSI Chart
  rsiChart = new Chart(ctxRsi, {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [
        {
          label: 'RSI (14)',
          data: chartData.rsi,
          borderColor: '#e9b200',
          backgroundColor: 'rgba(233, 178, 0, 0.05)',
          fill: true,
          tension: 0.2,
          borderWidth: 2,
          pointRadius: 0
        },
        {
          label: 'Overbought (70)',
          data: new Array(chartData.labels.length).fill(70),
          borderColor: 'rgba(246, 70, 93, 0.25)',
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0,
          borderWidth: 1.5
        },
        {
          label: 'Oversold (30)',
          data: new Array(chartData.labels.length).fill(30),
          borderColor: 'rgba(14, 203, 129, 0.25)',
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0,
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.03)' }, ticks: { color: '#848e9c', font: { family: 'Outfit' } } },
        y: { 
          min: 0, 
          max: 100, 
          grid: { color: 'rgba(255, 255, 255, 0.03)' }, 
          ticks: { color: '#848e9c', font: { family: 'Outfit' }, stepSize: 20 }
        }
      }
    }
  });
}

function updateChart(lastCandle, indicators) {
  if (!priceChart || !rsiChart || !lastCandle) return;

  const timeStr = formatTime(lastCandle.time);
  const labels = priceChart.data.labels;
  const prices = priceChart.data.datasets[0].data;
  const ema12 = priceChart.data.datasets[1].data;
  const ema26 = priceChart.data.datasets[2].data;
  const rsi = rsiChart.data.datasets[0].data;

  const lastIdx = labels.length - 1;

  if (labels[lastIdx] === timeStr) {
    // Cập nhật nến hiện tại đang chạy
    prices[lastIdx] = lastCandle.close;
    ema12[lastIdx] = indicators.ema12;
    ema26[lastIdx] = indicators.ema26;
    rsi[lastIdx] = indicators.rsi;
  } else {
    // Thêm điểm nến mới
    labels.push(timeStr);
    prices.push(lastCandle.close);
    ema12.push(indicators.ema12);
    ema26.push(indicators.ema26);
    rsi.push(indicators.rsi);
    
    // Đồng bộ đường ranh giới RSI tĩnh
    if (rsiChart.data.datasets[1]) rsiChart.data.datasets[1].data.push(70);
    if (rsiChart.data.datasets[2]) rsiChart.data.datasets[2].data.push(30);

    if (labels.length > MAX_CHART_POINTS) {
      labels.shift();
      prices.shift();
      ema12.shift();
      ema26.shift();
      rsi.shift();
      if (rsiChart.data.datasets[1]) rsiChart.data.datasets[1].data.shift();
      if (rsiChart.data.datasets[2]) rsiChart.data.datasets[2].data.shift();
    }
  }

  priceChart.update('none'); // Update không chạy hiệu ứng animation để tối ưu hiệu năng
  rsiChart.update('none');
}

// Kết nối WebSocket đến Backend server
let ws;
function connectWS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    connStatus.className = 'status-badge connected';
    statusText.innerText = 'Đã kết nối Live';
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // 1. Nhận dữ liệu nến lịch sử ban đầu để vẽ chart
      if (data.candles && !priceChart) {
        try {
          initCharts(data.candles);
        } catch (chartErr) {
          console.error("Lỗi khởi tạo biểu đồ:", chartErr);
        }
      }

      // 2. Nhận Ticker cập nhật
      if (data.ticker) {
        try {
          const t = data.ticker;

          // Flash hiệu ứng tăng/giảm giá
          if (lastPrice > 0 && t.price !== lastPrice) {
            priceEl.className = 'price-display ' + (t.price > lastPrice ? 'price-up' : 'price-down');
          }
          lastPrice = t.price;

          priceEl.innerText = typeof t.price === 'number' && !isNaN(t.price) ? formatCurrency(t.price) : '--.---,--';
          
          // 24h change
          if (typeof t.change24h === 'number' && !isNaN(t.change24h)) {
            const changeSign = t.change24h >= 0 ? '+' : '';
            changeEl.innerText = `${changeSign}${t.change24h.toFixed(2)}%`;
            changeEl.className = 'price-change ' + (t.change24h >= 0 ? 'positive' : 'negative');
          } else {
            changeEl.innerText = '0.00%';
            changeEl.className = 'price-change positive';
          }

          highEl.innerText = typeof t.high24h === 'number' && !isNaN(t.high24h) ? formatCurrency(t.high24h) : '--.---';
          lowEl.innerText = typeof t.low24h === 'number' && !isNaN(t.low24h) ? formatCurrency(t.low24h) : '--.---';
          volumeEl.innerText = typeof t.volume24h === 'number' && !isNaN(t.volume24h) ? formatNumber(t.volume24h) : '--.---';
        } catch (tickerErr) {
          console.error("Lỗi cập nhật UI Ticker:", tickerErr);
        }
      }

      // 3. Nhận chỉ báo và nến mới
      if (data.indicators) {
        try {
          const ind = data.indicators;

          // Cập nhật RSI UI
          if (ind.rsi !== null && ind.rsi !== undefined && !isNaN(ind.rsi)) {
            const rsiVal = ind.rsi.toFixed(2);
            rsiValEl.innerText = rsiVal;
            rsiBarEl.style.width = `${Math.min(100, Math.max(0, ind.rsi))}%`;

            if (ind.rsi >= 70) {
              rsiStatusEl.innerText = 'QUÁ MUA (Overbought)';
              rsiStatusEl.className = 'ind-status bearish';
              rsiBarEl.style.background = 'var(--negative)';
            } else if (ind.rsi <= 30) {
              rsiStatusEl.innerText = 'QUÁ BÁN (Oversold)';
              rsiStatusEl.className = 'ind-status bullish';
              rsiBarEl.style.background = 'var(--positive)';
            } else {
              rsiStatusEl.innerText = 'Trung lập (Neutral)';
              rsiStatusEl.className = 'ind-status neutral';
              rsiBarEl.style.background = 'var(--neutral)';
            }
          }

          // Cập nhật EMA UI
          if (ind.ema12 !== null && ind.ema12 !== undefined && !isNaN(ind.ema12) &&
              ind.ema26 !== null && ind.ema26 !== undefined && !isNaN(ind.ema26)) {
            ema12El.innerText = formatCurrency(ind.ema12);
            ema26El.innerText = formatCurrency(ind.ema26);

            if (ind.ema12 > ind.ema26) {
              emaCrossEl.innerText = 'Xu hướng tăng (Bullish)';
              emaCrossEl.className = 'ind-status bullish';
            } else {
              emaCrossEl.innerText = 'Xu hướng giảm (Bearish)';
              emaCrossEl.className = 'ind-status bearish';
            }
          }

          // Cập nhật MACD UI
          if (ind.macd && typeof ind.macd === 'object' && 
              ind.macd.MACD !== undefined && ind.macd.signal !== undefined && ind.macd.histogram !== undefined) {
            macdValEl.innerText = ind.macd.MACD.toFixed(2);
            macdSigEl.innerText = ind.macd.signal.toFixed(2);
            macdHistEl.innerText = ind.macd.histogram.toFixed(2);

            if (ind.macd.histogram > 0) {
              macdStatusEl.innerText = 'Histogram Dương';
              macdStatusEl.className = 'ind-status bullish';
            } else {
              macdStatusEl.innerText = 'Histogram Âm';
              macdStatusEl.className = 'ind-status bearish';
            }
          }

          // Cập nhật biểu đồ nếu có nến mới
          if (data.lastCandle) {
            updateChart(data.lastCandle, ind);
          }
        } catch (indErr) {
          console.error("Lỗi cập nhật UI Indicators:", indErr);
        }
      }

    } catch (err) {
      console.error('Lỗi phân tích dữ liệu WebSocket:', err);
    }
  };

  ws.onclose = () => {
    connStatus.className = 'status-badge disconnected';
    statusText.innerText = 'Mất kết nối. Đang kết nối lại...';
    setTimeout(connectWS, 3000);
  };

  ws.onerror = (err) => {
    console.error('Lỗi WebSocket:', err);
    ws.close();
  };
}

// Chạy kết nối
connectWS();
