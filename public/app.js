// Khởi tạo Lucide Icons
lucide.createIcons();

// Trạng thái DOM hiện tại
const connStatus = document.getElementById('connection-status');
const statusText = connStatus.querySelector('.status-text');
const priceEl = document.getElementById('btc-price');
const changeEl = document.getElementById('btc-change');
const highEl = document.getElementById('btc-high');
const lowEl = document.getElementById('btc-low');
const volumeEl = document.getElementById('btc-volume');

// Chỉ báo kỹ thuật DOM
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

// Dòng tiền DOM
const flowNetValEl = document.getElementById('flow-net-val');
const flowInValEl = document.getElementById('flow-in-val');
const flowOutValEl = document.getElementById('flow-out-val');
const flowInSlEl = document.getElementById('flow-in-sl');
const flowOutSlEl = document.getElementById('flow-out-sl');
const flowInLEl = document.getElementById('flow-in-l');
const flowOutLEl = document.getElementById('flow-out-l');
const flowInMEl = document.getElementById('flow-in-m');
const flowOutMEl = document.getElementById('flow-out-m');
const flowInSEl = document.getElementById('flow-in-s');
const flowOutSEl = document.getElementById('flow-out-s');
const lsCurrentRatioEl = document.getElementById('ls-current-ratio');

// Cấu hình các biểu đồ
let priceChart = null;
let rsiChart = null;
let flowDoughnutChart = null;
let takerVolumeChart = null;
let lsRatioChart = null;

const MAX_CHART_POINTS = 50;
let lastPrice = 0;

// Cache dữ liệu để chuyển đổi period không độ trễ
let cachedOrderFlows = null;
let cachedRubikData = null;

let currentFlowPeriod = '1d';
let currentTakerPeriod = '5m';
let currentLsPeriod = '5m';

// Cơ chế HTTP Polling Fallback khi WebSocket mất kết nối
let pollingInterval = null;
let isPollingActive = false;

function formatCurrency(num) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(num);
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

function formatBTC(num) {
  if (num >= 1000) {
    return (num / 1000).toFixed(2) + ' N BTC';
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num) + ' BTC';
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Khởi tạo các biểu đồ chính
function initCharts(historicalCandles, rubikData) {
  // Nếu các biểu đồ đã được vẽ rồi thì không vẽ lại để tránh giật lag UI
  if (priceChart && rsiChart && flowDoughnutChart) return;

  const ctxPrice = document.getElementById('priceChart').getContext('2d');
  const ctxRsi = document.getElementById('rsiChart').getContext('2d');
  const ctxFlow = document.getElementById('flowDoughnutChart').getContext('2d');
  const ctxTaker = document.getElementById('takerVolumeChart').getContext('2d');
  const ctxLs = document.getElementById('lsRatioChart').getContext('2d');

  const labels = historicalCandles.map(c => formatTime(c.time));
  const prices = historicalCandles.map(c => c.close);
  const ema12 = historicalCandles.map(c => c.ema12 !== undefined ? c.ema12 : null);
  const ema26 = historicalCandles.map(c => c.ema26 !== undefined ? c.ema26 : null);
  const rsi = historicalCandles.map(c => c.rsi !== undefined ? c.rsi : null);

  priceChart = new Chart(ctxPrice, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Giá BTC',
          data: prices,
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
          data: ema12,
          borderColor: '#0ecb81',
          fill: false,
          tension: 0.2,
          borderWidth: 1.5,
          pointRadius: 0
        },
        {
          label: 'EMA 26',
          data: ema26,
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

  rsiChart = new Chart(ctxRsi, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'RSI (14)',
          data: rsi,
          borderColor: '#e9b200',
          backgroundColor: 'rgba(233, 178, 0, 0.05)',
          fill: true,
          tension: 0.2,
          borderWidth: 2,
          pointRadius: 0
        },
        {
          label: 'Overbought (70)',
          data: new Array(labels.length).fill(70),
          borderColor: 'rgba(246, 70, 93, 0.25)',
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0,
          borderWidth: 1.5
        },
        {
          label: 'Oversold (30)',
          data: new Array(labels.length).fill(30),
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

  flowDoughnutChart = new Chart(ctxFlow, {
    type: 'doughnut',
    data: {
      labels: [
        'Ra - Siêu lớn', 'Ra - Lớn', 'Ra - T.Bình', 'Ra - Nhỏ',
        'Vào - Nhỏ', 'Vào - T.Bình', 'Vào - Lớn', 'Vào - Siêu lớn'
      ],
      datasets: [{
        data: [0, 0, 0, 0, 0, 0, 0, 0],
        backgroundColor: [
          '#b3001e', 
          '#f6465d', 
          '#ff7373', 
          '#ffb3b3', 
          '#a3ffd6', 
          '#39e6a0', 
          '#0ecb81', 
          '#0b6623'  
        ],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '75%',
      plugins: {
        legend: { display: false }
      }
    }
  });

  const tvData = rubikData?.takerVolume?.[currentTakerPeriod] || [];
  const tvLabels = tvData.map(v => formatTime(v.time));
  const tvBuyData = tvData.map(v => v.buyVol);
  const tvSellData = tvData.map(v => v.sellVol);

  takerVolumeChart = new Chart(ctxTaker, {
    type: 'bar',
    data: {
      labels: tvLabels,
      datasets: [
        {
          label: 'Khối lượng mua (BTC)',
          data: tvBuyData,
          backgroundColor: '#0ecb81',
          borderRadius: 3
        },
        {
          label: 'Khối lượng bán (BTC)',
          data: tvSellData,
          backgroundColor: '#f6465d',
          borderRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: '#848e9c', font: { family: 'Outfit', size: 10 } }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.03)' }, ticks: { color: '#848e9c', font: { family: 'Outfit' } } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.03)' }, ticks: { color: '#848e9c', font: { family: 'Outfit' } } }
      }
    }
  });

  const lsData = rubikData?.longShortRatio?.[currentLsPeriod] || [];
  const lsLabels = lsData.map(v => formatTime(v.time));
  const lsValues = lsData.map(v => v.ratio);

  lsRatioChart = new Chart(ctxLs, {
    type: 'line',
    data: {
      labels: lsLabels,
      datasets: [{
        label: 'Tỷ lệ Long/Short',
        data: lsValues,
        borderColor: '#54a0ff',
        backgroundColor: 'rgba(84, 160, 255, 0.05)',
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 1,
        pointHoverRadius: 5
      }]
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
          grid: { color: 'rgba(255, 255, 255, 0.03)' }, 
          ticks: { color: '#848e9c', font: { family: 'Outfit' } } 
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
    prices[lastIdx] = lastCandle.close;
    ema12[lastIdx] = indicators.ema12;
    ema26[lastIdx] = indicators.ema26;
    rsi[lastIdx] = indicators.rsi;
  } else {
    labels.push(timeStr);
    prices.push(lastCandle.close);
    ema12.push(indicators.ema12);
    ema26.push(indicators.ema26);
    rsi.push(indicators.rsi);
    
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

  priceChart.update('none');
  rsiChart.update('none');
}

// Cập nhật giao diện Ticker
function updateTickerUI(t) {
  if (!t) return;
  try {
    if (lastPrice > 0 && t.price !== lastPrice) {
      priceEl.className = 'price-display ' + (t.price > lastPrice ? 'price-up' : 'price-down');
    }
    lastPrice = t.price;

    priceEl.innerText = typeof t.price === 'number' && !isNaN(t.price) ? formatCurrency(t.price) : '--.---,--';
    
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
  } catch (err) {
    console.error("Lỗi cập nhật UI Ticker:", err);
  }
}

// Cập nhật giao diện Chỉ báo
function updateIndicatorsUI(ind) {
  if (!ind) return;
  try {
    // RSI
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

    // EMA
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

    // MACD
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
  } catch (err) {
    console.error("Lỗi cập nhật UI Indicators:", err);
  }
}

// Cập nhật dữ liệu Rubik Charts
function updateRubikCharts(rubikData) {
  if (!rubikData) return;
  cachedRubikData = rubikData;

  try {
    // 1. Taker Volume (Grouped Bar Chart)
    if (takerVolumeChart && rubikData.takerVolume?.[currentTakerPeriod]) {
      const tvData = rubikData.takerVolume[currentTakerPeriod];
      const tvLabels = tvData.map(v => formatTime(v.time));
      const tvBuyData = tvData.map(v => v.buyVol);
      const tvSellData = tvData.map(v => v.sellVol);

      takerVolumeChart.data.labels = tvLabels;
      takerVolumeChart.data.datasets[0].data = tvBuyData;
      takerVolumeChart.data.datasets[1].data = tvSellData;
      takerVolumeChart.update();
    }

    // 2. Long/Short Ratio (Margin Loan Ratio)
    if (lsRatioChart && rubikData.longShortRatio?.[currentLsPeriod]) {
      const lsData = rubikData.longShortRatio[currentLsPeriod];
      const lsLabels = lsData.map(v => formatTime(v.time));
      const lsValues = lsData.map(v => v.ratio);
      
      lsRatioChart.data.labels = lsLabels;
      lsRatioChart.data.datasets[0].data = lsValues;
      lsRatioChart.update();

      if (lsValues.length > 0) {
        const currentRatio = lsValues[lsValues.length - 1];
        lsCurrentRatioEl.innerText = `L/S Ratio: ${currentRatio.toFixed(2)}`;
        if (currentRatio > 1.2) {
          lsCurrentRatioEl.className = 'sentiment-badge bullish';
        } else if (currentRatio < 0.8) {
          lsCurrentRatioEl.className = 'sentiment-badge bearish';
        } else {
          lsCurrentRatioEl.className = 'sentiment-badge neutral';
        }
      }
    }
  } catch (err) {
    console.error("Lỗi cập nhật UI Rubik Charts:", err);
  }
}

// Cập nhật Phân tích dòng tiền (Đầy đủ khung thời gian)
function updateOrderFlowUI(flows) {
  if (!flows) return;
  cachedOrderFlows = flows;

  const flow = flows[currentFlowPeriod];
  if (!flow) return;

  try {
    const netInflow = flow.totalBuy - flow.totalSell;
    const isNetOutflow = netInflow < 0;
    
    flowNetValEl.innerText = (isNetOutflow ? '' : '+') + formatNumber(netInflow) + ' BTC';
    
    const flowNetLabelEl = document.querySelector('.flow-net-label');
    if (isNetOutflow) {
      flowNetLabelEl.innerText = 'DÒNG TIỀN RA RÒNG';
      flowNetValEl.className = 'flow-net-val text-red';
    } else {
      flowNetLabelEl.innerText = 'DÒNG TIỀN VÀO RÒNG';
      flowNetValEl.className = 'flow-net-val text-green';
    }

    flowInValEl.innerText = formatBTC(flow.totalBuy);
    flowOutValEl.innerText = formatBTC(flow.totalSell);

    // Điền bảng số liệu
    flowInSlEl.innerText = formatNumber(flow.buy.superLarge);
    flowOutSlEl.innerText = formatNumber(flow.sell.superLarge);
    flowInLEl.innerText = formatNumber(flow.buy.large);
    flowOutLEl.innerText = formatNumber(flow.sell.large);
    flowInMEl.innerText = formatNumber(flow.buy.medium);
    flowOutMEl.innerText = formatNumber(flow.sell.medium);
    flowInSEl.innerText = formatNumber(flow.buy.small);
    flowOutSEl.innerText = formatNumber(flow.sell.small);

    // Cập nhật Doughnut Chart (Cấu trúc 8 phần đoạn của OKX: nửa đỏ bên phải, nửa xanh bên trái)
    if (flowDoughnutChart) {
      flowDoughnutChart.data.datasets[0].data = [
        flow.sell.superLarge,
        flow.sell.large,
        flow.sell.medium,
        flow.sell.small,
        flow.buy.small,
        flow.buy.medium,
        flow.buy.large,
        flow.buy.superLarge
      ];
      flowDoughnutChart.update();
    }
  } catch (err) {
    console.error("Lỗi cập nhật UI Order Flow:", err);
  }
}

// Gắn bộ lắng nghe click cho các period button
let periodListenersSetup = false;
function setupPeriodListeners() {
  if (periodListenersSetup) return;
  periodListenersSetup = true;

  // 1. Phân tích Dòng tiền periods
  document.querySelectorAll('#flow-periods .period-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#flow-periods .period-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFlowPeriod = e.target.dataset.period;
      if (cachedOrderFlows) {
        updateOrderFlowUI(cachedOrderFlows);
      }
    });
  });

  // 2. Mua/bán Taker periods
  document.querySelectorAll('#taker-periods .period-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#taker-periods .period-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentTakerPeriod = e.target.dataset.period;
      if (cachedRubikData) {
        updateRubikCharts(cachedRubikData);
      }
    });
  });

  // 3. Tỷ lệ Long/Short periods
  document.querySelectorAll('#ls-periods .period-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#ls-periods .period-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentLsPeriod = e.target.dataset.period;
      if (cachedRubikData) {
        updateRubikCharts(cachedRubikData);
      }
    });
  });
}

// Cập nhật toàn bộ giao diện từ một gói data (Dùng cho cả WS và HTTP Fallback)
function updateAllData(data) {
  if (!data) return;
  
  if (data.candles) {
    try {
      initCharts(data.candles, data.rubikData);
      setupPeriodListeners();
    } catch (chartErr) {
      console.error("Lỗi khởi tạo biểu đồ:", chartErr);
    }
  }
  
  updateTickerUI(data.ticker);
  updateIndicatorsUI(data.indicators);
  updateOrderFlowUI(data.orderFlows);
  updateRubikCharts(data.rubikData);
  
  // Cập nhật nến mới nhất cho biểu đồ giá/RSI
  if (data.candles && data.candles.length > 0 && data.indicators) {
    updateChart(data.candles[data.candles.length - 1], data.indicators);
  }
}

// Kích hoạt HTTP Polling dự phòng
function startPolling() {
  if (isPollingActive) return;
  isPollingActive = true;
  console.log("Đã kích hoạt chế độ Polling dự phòng.");
  
  connStatus.className = 'status-badge disconnected';
  statusText.innerText = 'Live (Dự phòng)';

  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch('/api/data');
      const data = await response.json();
      updateAllData(data);
    } catch (err) {
      console.error("Lỗi HTTP Polling:", err.message);
    }
  }, 2000);
}

function stopPolling() {
  if (!isPollingActive) return;
  isPollingActive = false;
  clearInterval(pollingInterval);
  console.log("Đã dừng chế độ Polling.");
}

// Kết nối WebSocket đến Backend server
let ws;
function connectWS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    stopPolling();
    connStatus.className = 'status-badge connected';
    statusText.innerText = 'Đã kết nối Live';
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'init') {
        updateAllData(data);
      } 
      else if (data.type === 'ticker') {
        updateTickerUI(data.ticker);
      } 
      else if (data.type === 'candle') {
        updateIndicatorsUI(data.indicators);
        updateChart(data.lastCandle, data.indicators);
      } 
      else if (data.type === 'orderFlows') {
        updateOrderFlowUI(data.orderFlows);
      } 
      else if (data.type === 'rubik') {
        updateRubikCharts(data.rubikData);
      }
    } catch (err) {
      console.error('Lỗi nhận dữ liệu WebSocket:', err);
    }
  };

  ws.onclose = () => {
    startPolling();
    setTimeout(connectWS, 5000);
  };

  ws.onerror = (err) => {
    console.error('Lỗi WebSocket:', err);
    ws.close();
  };
}

// Khởi chạy kết nối ban đầu
connectWS();
