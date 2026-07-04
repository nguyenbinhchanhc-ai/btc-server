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

function formatCurrency(num) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(num);
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

function formatBTC(num) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(num) + ' BTC';
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Khởi tạo các biểu đồ chính
function initCharts(historicalCandles, rubikData) {
  const ctxPrice = document.getElementById('priceChart').getContext('2d');
  const ctxRsi = document.getElementById('rsiChart').getContext('2d');
  const ctxFlow = document.getElementById('flowDoughnutChart').getContext('2d');
  const ctxTaker = document.getElementById('takerVolumeChart').getContext('2d');
  const ctxLs = document.getElementById('lsRatioChart').getContext('2d');

  // 1. Biểu đồ nến & EMA
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

  // 2. Biểu đồ RSI
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

  // 3. Biểu đồ tròn Phân bổ Dòng tiền (24h)
  flowDoughnutChart = new Chart(ctxFlow, {
    type: 'doughnut',
    data: {
      labels: ['Siêu lớn', 'Lớn', 'Trung bình', 'Nhỏ'],
      datasets: [{
        data: [0, 0, 0, 0],
        backgroundColor: ['#ff5e00', '#ff9f43', '#54a0ff', '#5f27cd'],
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

  // 4. Biểu đồ cột Taker Net Volume (Rubik 5m)
  const tvLabels = rubikData?.takerVolume?.map(v => formatTime(v.time)) || [];
  const tvNetData = rubikData?.takerVolume?.map(v => v.netVol) || [];
  const tvColors = tvNetData.map(v => v >= 0 ? '#0ecb81' : '#f6465d');

  takerVolumeChart = new Chart(ctxTaker, {
    type: 'bar',
    data: {
      labels: tvLabels,
      datasets: [{
        label: 'Net Inflow (BTC)',
        data: tvNetData,
        backgroundColor: tvColors,
        borderRadius: 4
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
        y: { grid: { color: 'rgba(255, 255, 255, 0.03)' }, ticks: { color: '#848e9c', font: { family: 'Outfit' } } }
      }
    }
  });

  // 5. Biểu đồ đường Long/Short Ratio (Rubik 5m)
  const lsLabels = rubikData?.longShortRatio?.map(v => formatTime(v.time)) || [];
  const lsValues = rubikData?.longShortRatio?.map(v => v.ratio) || [];

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
        y: { grid: { color: 'rgba(255, 255, 255, 0.03)' }, ticks: { color: '#848e9c', font: { family: 'Outfit' } } }
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

// Cập nhật dữ liệu Rubik Chart
function updateRubikCharts(rubikData) {
  if (!takerVolumeChart || !lsRatioChart || !rubikData) return;

  // Taker Volume
  if (rubikData.takerVolume) {
    const tvLabels = rubikData.takerVolume.map(v => formatTime(v.time));
    const tvNetData = rubikData.takerVolume.map(v => v.netVol);
    const tvColors = tvNetData.map(v => v >= 0 ? '#0ecb81' : '#f6465d');

    takerVolumeChart.data.labels = tvLabels;
    takerVolumeChart.data.datasets[0].data = tvNetData;
    takerVolumeChart.data.datasets[0].backgroundColor = tvColors;
    takerVolumeChart.update();
  }

  // Long/Short Ratio
  if (rubikData.longShortRatio && rubikData.longShortRatio.length > 0) {
    const lsLabels = rubikData.longShortRatio.map(v => formatTime(v.time));
    const lsValues = rubikData.longShortRatio.map(v => v.ratio);
    
    lsRatioChart.data.labels = lsLabels;
    lsRatioChart.data.datasets[0].data = lsValues;
    lsRatioChart.update();

    // Cập nhật current ratio badge ở header
    const currentRatio = lsValues[lsValues.length - 1];
    if (currentRatio !== undefined) {
      lsCurrentRatioEl.innerText = `L/S Ratio: ${currentRatio.toFixed(2)}`;
      if (currentRatio > 1.05) {
        lsCurrentRatioEl.className = 'sentiment-badge bullish';
      } else if (currentRatio < 0.95) {
        lsCurrentRatioEl.className = 'sentiment-badge bearish';
      } else {
        lsCurrentRatioEl.className = 'sentiment-badge neutral';
      }
    }
  }
}

// Cập nhật Phân tích dòng tiền 24h
function updateOrderFlowUI(flow) {
  if (!flow) return;

  // Tính ròng ròng
  const netInflow = flow.totalBuy - flow.totalSell;
  flowNetValEl.innerText = (netInflow >= 0 ? '+' : '') + formatNumber(netInflow) + ' BTC';
  
  if (netInflow > 0) {
    flowNetValEl.className = 'flow-net-val text-green';
  } else if (netInflow < 0) {
    flowNetValEl.className = 'flow-net-val text-red';
  } else {
    flowNetValEl.className = 'flow-net-val neutral';
  }

  // Tổng Buy/Sell
  flowInValEl.innerText = formatBTC(flow.totalBuy);
  flowOutValEl.innerText = formatBTC(flow.totalSell);

  // Cập nhật bảng phân khúc
  flowInSlEl.innerText = formatNumber(flow.buy.superLarge);
  flowOutSlEl.innerText = formatNumber(flow.sell.superLarge);
  flowInLEl.innerText = formatNumber(flow.buy.large);
  flowOutLEl.innerText = formatNumber(flow.sell.large);
  flowInMEl.innerText = formatNumber(flow.buy.medium);
  flowOutMEl.innerText = formatNumber(flow.sell.medium);
  flowInSEl.innerText = formatNumber(flow.buy.small);
  flowOutSEl.innerText = formatNumber(flow.sell.small);

  // Cập nhật Doughnut Chart
  if (flowDoughnutChart) {
    const totalSL = flow.buy.superLarge + flow.sell.superLarge;
    const totalL = flow.buy.large + flow.sell.large;
    const totalM = flow.buy.medium + flow.sell.medium;
    const totalS = flow.buy.small + flow.sell.small;

    flowDoughnutChart.data.datasets[0].data = [totalSL, totalL, totalM, totalS];
    flowDoughnutChart.update();
  }
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

      // 1. Khởi tạo các biểu đồ nếu nhận dữ liệu nến và rubik
      if (data.candles && !priceChart) {
        try {
          initCharts(data.candles, data.rubikData);
        } catch (chartErr) {
          console.error("Lỗi khởi tạo biểu đồ:", chartErr);
        }
      }

      // 2. Cập nhật Ticker
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

          // RSI UI
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

          // EMA UI
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

          // MACD UI
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

          // Cập nhật nến biểu đồ
          if (data.lastCandle) {
            updateChart(data.lastCandle, ind);
          }
        } catch (indErr) {
          console.error("Lỗi cập nhật UI Indicators:", indErr);
        }
      }

      // 4. Cập nhật Phân tích Dòng tiền
      if (data.orderFlow24h) {
        try {
          updateOrderFlowUI(data.orderFlow24h);
        } catch (flowErr) {
          console.error("Lỗi cập nhật UI Order Flow:", flowErr);
        }
      }

      // 5. Cập nhật Rubik Charts
      if (data.rubikData) {
        try {
          updateRubikCharts(data.rubikData);
        } catch (rubikErr) {
          console.error("Lỗi cập nhật UI Rubik:", rubikErr);
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
