var version = "1.9";
var apiVertion = "formal";
var exp = false;
const style = document.createElement('style');
style.innerHTML = `
    .station-shindo-icon {
        will-change: transform; /* 优化动画性能 */
        pointer-events: none;   /* 禁用交互提高性能 */
        transform: translateZ(0); /* 强制GPU加速 */
    }
    
    .leaflet-layer {
        transform: translateZ(0); /* 启用GPU加速 */
    }
    
    .leaflet-marker-icon {
        image-rendering: crisp-edges; /* 优化图标渲染 */
    }
`;
document.head.appendChild(style);
// 新增：只在预警解除瞬间回到默认视角，避免每秒拉回
let lastHasEvent = null; // 初始为 null，首次页面加载不拉回
//定义烈度配色
const intColor = {
    "0": { "bkcolor": "#444444" },
    "1": { "bkcolor": "#9bc4e4" },
    "2": { "bkcolor": "#00a0f1" },
    "3": { "bkcolor": "#0062f5" },
    "4": { "bkcolor": "#2de161" },
    "5": { "bkcolor": "#1cac5d" },
    "6": { "bkcolor": "#ffbd2b" },
    "7": { "bkcolor": "#ff992b" },
    "8": { "bkcolor": "#fa5151" },
    "9": { "bkcolor": "#f4440d" },
    "10": { "bkcolor": "#ff000d" },
    "11": { "bkcolor": "#c20007" },
    "12": { "bkcolor": "#fd2fc2" }
};

// JMA震度配色（可根据需要调整）
const intColorJma = {
    "1": { "bkcolor": "#645454" },
    "2": { "bkcolor": "#2C378C" },
    "3": { "bkcolor": "#2E8C2C" },
    "4": { "bkcolor": "#DF6C01" },
    "5-": { "bkcolor": "#E74C3C" },
    "5+": { "bkcolor": "#8B0000" },
    "6-": { "bkcolor": "#8A0030" },
    "6+": { "bkcolor": "#A30067" },
    "7": { "bkcolor": "#96005C" }
};

// 新增：显示模式切换（"intensity"=烈度，"jma"=JMA震度）
function getShindoMode() {
    return getCookie("shindoMode") || "intensity";
}
function setShindoMode(mode) {
    setCookie("shindoMode", mode);
}

// 新增：根据模式获取显示文本和配色
function getEventShindoDisplay(event) {
    const mode = getShindoMode();
    if (mode === "jma") {
        // 优先 MaxShindo
        let shindo = event.MaxShindo;
        if (!shindo || shindo === "-") {
            // 回退 MaxEstimatedIntensity
            shindo = (typeof event.MaxEstimatedIntensity === "number" && !isNaN(event.MaxEstimatedIntensity))
                ? Math.round(event.MaxEstimatedIntensity).toString()
                : "-";
        }
        let color = intColorJma[shindo]?.bkcolor || "#444444";
        return { text: shindo, color };
    } else {
        // 烈度模式
        let intv = (typeof event.MaxEstimatedIntensity === "number" && !isNaN(event.MaxEstimatedIntensity))
            ? Math.round(event.MaxEstimatedIntensity)
            : "-";
        let color = intColor[intv]?.bkcolor || "#444444";
        return { text: intv, color };
    }
}

// 新增：接口地址配置与切换
const API_CONFIG = {
    icl: [
        "http://192.168.1.223:3000/getapi"

    ],
    cenc: [
        "http://192.168.1.223:3000/getapi"
    ]
};

// 新增：Cookie 读写函数
function getCookie(name) {
    const arr = document.cookie.split(';');
    for (let i = 0; i < arr.length; i++) {
        let c = arr[i].trim();
        if (c.indexOf(name + '=') === 0) {
            return decodeURIComponent(c.substring(name.length + 1));
        }
    }
    return null;
}
function setCookie(name, value, days = 365) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
}

let travelTimeTable = null;
let travelTimeDataLoaded = false;

// 替换原来的 parseTravelTimeData 函数
function parseTravelTimeData(text) {
    const lines = text.trim().split('\n');
    const table = {
        depths: [],
        distances: [],
        pTimes: {},
        sTimes: {}
    };
    
    // 跳过标题行
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // 使用正则表达式匹配数据列（处理不定数量的空格）
        const parts = line.split(/\s+/).filter(part => part !== '');
        
        if (parts.length >= 6) {
            try {
                const pTime = parseFloat(parts[1]);  // P波走时
                const sTime = parseFloat(parts[3]);  // S波走时
                const depth = parseFloat(parts[4]);  // 震源深度
                const distance = parseFloat(parts[5]); // 震中距
                
                // 确保数值有效
                if (isNaN(pTime) || isNaN(sTime) || isNaN(depth) || isNaN(distance)) {
                    continue;
                }
                
                // 添加到深度和距离列表
                if (!table.depths.includes(depth)) table.depths.push(depth);
                if (!table.distances.includes(distance)) table.distances.push(distance);
                
                // 初始化深度数据结构
                if (!table.pTimes[depth]) table.pTimes[depth] = {};
                if (!table.sTimes[depth]) table.sTimes[depth] = {};
                
                // 存储走时数据
                table.pTimes[depth][distance] = pTime;
                table.sTimes[depth][distance] = sTime;
            } catch (e) {
                console.warn('解析走时表行失败:', line, e);
                continue;
            }
        }
    }
    
    // 排序
    table.depths.sort((a, b) => a - b);
    table.distances.sort((a, b) => a - b);
    
    console.log('走时表解析完成:', {
        深度数量: table.depths.length,
        距离数量: table.distances.length,
        深度范围: table.depths.length > 0 ? `${table.depths[0]}-${table.depths[table.depths.length-1]}km` : '无',
        距离范围: table.distances.length > 0 ? `${table.distances[0]}-${table.distances[table.distances.length-1]}km` : '无'
    });
    
    return table;
}

// 替换原来的 getTravelTime 函数
function getTravelTime(depth, distance, waveType) {
    if (!travelTimeDataLoaded || !travelTimeTable) {
        // 回退到固定速度计算
        const v = waveType === 'p' ? 5.71 : 3.4;
        return distance / v;
    }
    
    const times = waveType === 'p' ? travelTimeTable.pTimes : travelTimeTable.sTimes;
    
    // 找到深度边界
    let depth1 = travelTimeTable.depths[0];
    let depth2 = travelTimeTable.depths[travelTimeTable.depths.length - 1];
    let depth1Index = 0;
    
    // 查找最近的深度
    for (let i = 0; i < travelTimeTable.depths.length - 1; i++) {
        if (depth >= travelTimeTable.depths[i] && depth <= travelTimeTable.depths[i + 1]) {
            depth1 = travelTimeTable.depths[i];
            depth2 = travelTimeTable.depths[i + 1];
            depth1Index = i;
            break;
        } else if (depth < travelTimeTable.depths[i]) {
            depth1 = depth2 = travelTimeTable.depths[i];
            break;
        } else if (depth > travelTimeTable.depths[travelTimeTable.depths.length - 1]) {
            depth1 = depth2 = travelTimeTable.depths[travelTimeTable.depths.length - 1];
            break;
        }
    }
    
    // 找到距离边界
    let dist1 = travelTimeTable.distances[0];
    let dist2 = travelTimeTable.distances[travelTimeTable.distances.length - 1];
    
    for (let i = 0; i < travelTimeTable.distances.length - 1; i++) {
        if (distance >= travelTimeTable.distances[i] && distance <= travelTimeTable.distances[i + 1]) {
            dist1 = travelTimeTable.distances[i];
            dist2 = travelTimeTable.distances[i + 1];
            break;
        } else if (distance < travelTimeTable.distances[i]) {
            dist1 = dist2 = travelTimeTable.distances[i];
            break;
        } else if (distance > travelTimeTable.distances[travelTimeTable.distances.length - 1]) {
            dist1 = dist2 = travelTimeTable.distances[travelTimeTable.distances.length - 1];
            break;
        }
    }
    
    // 双线性插值
    const getTime = (d, dist) => {
        const depthData = times[d];
        return depthData ? (depthData[dist] || 0) : 0;
    };
    
    const t11 = getTime(depth1, dist1);
    const t12 = getTime(depth1, dist2);
    const t21 = getTime(depth2, dist1);
    const t22 = getTime(depth2, dist2);
    
    // 如果某个深度没有数据，使用单深度插值
    if (depth1 === depth2) {
        // 单深度距离插值
        if (dist1 === dist2) {
            return t11;
        }
        const distRatio = (distance - dist1) / (dist2 - dist1);
        return t11 + (t12 - t11) * distRatio;
    }
    
    if (dist1 === dist2) {
        // 单距离深度插值
        const depthRatio = (depth - depth1) / (depth2 - depth1);
        return t11 + (t21 - t11) * depthRatio;
    }
    
    // 双线性插值
    const distRatio = (distance - dist1) / (dist2 - dist1);
    const depthRatio = (depth - depth1) / (depth2 - depth1);
    
    const t1 = t11 + (t12 - t11) * distRatio;
    const t2 = t21 + (t22 - t21) * distRatio;
    
    return t1 + (t2 - t1) * depthRatio;
}// 替换原来的 getTravelTime 函数
function getTravelTime(depth, distance, waveType) {
    if (!travelTimeDataLoaded || !travelTimeTable) {
        // 回退到固定速度计算
        const v = waveType === 'p' ? 5.71 : 3.4;
        return distance / v;
    }
    
    const times = waveType === 'p' ? travelTimeTable.pTimes : travelTimeTable.sTimes;
    
    // 找到深度边界
    let depth1 = travelTimeTable.depths[0];
    let depth2 = travelTimeTable.depths[travelTimeTable.depths.length - 1];
    let depth1Index = 0;
    
    // 查找最近的深度
    for (let i = 0; i < travelTimeTable.depths.length - 1; i++) {
        if (depth >= travelTimeTable.depths[i] && depth <= travelTimeTable.depths[i + 1]) {
            depth1 = travelTimeTable.depths[i];
            depth2 = travelTimeTable.depths[i + 1];
            depth1Index = i;
            break;
        } else if (depth < travelTimeTable.depths[i]) {
            depth1 = depth2 = travelTimeTable.depths[i];
            break;
        } else if (depth > travelTimeTable.depths[travelTimeTable.depths.length - 1]) {
            depth1 = depth2 = travelTimeTable.depths[travelTimeTable.depths.length - 1];
            break;
        }
    }
    
    // 找到距离边界
    let dist1 = travelTimeTable.distances[0];
    let dist2 = travelTimeTable.distances[travelTimeTable.distances.length - 1];
    
    for (let i = 0; i < travelTimeTable.distances.length - 1; i++) {
        if (distance >= travelTimeTable.distances[i] && distance <= travelTimeTable.distances[i + 1]) {
            dist1 = travelTimeTable.distances[i];
            dist2 = travelTimeTable.distances[i + 1];
            break;
        } else if (distance < travelTimeTable.distances[i]) {
            dist1 = dist2 = travelTimeTable.distances[i];
            break;
        } else if (distance > travelTimeTable.distances[travelTimeTable.distances.length - 1]) {
            dist1 = dist2 = travelTimeTable.distances[travelTimeTable.distances.length - 1];
            break;
        }
    }
    
    // 双线性插值
    const getTime = (d, dist) => {
        const depthData = times[d];
        return depthData ? (depthData[dist] || 0) : 0;
    };
    
    const t11 = getTime(depth1, dist1);
    const t12 = getTime(depth1, dist2);
    const t21 = getTime(depth2, dist1);
    const t22 = getTime(depth2, dist2);
    
    // 如果某个深度没有数据，使用单深度插值
    if (depth1 === depth2) {
        // 单深度距离插值
        if (dist1 === dist2) {
            return t11;
        }
        const distRatio = (distance - dist1) / (dist2 - dist1);
        return t11 + (t12 - t11) * distRatio;
    }
    
    if (dist1 === dist2) {
        // 单距离深度插值
        const depthRatio = (depth - depth1) / (depth2 - depth1);
        return t11 + (t21 - t11) * depthRatio;
    }
    
    // 双线性插值
    const distRatio = (distance - dist1) / (dist2 - dist1);
    const depthRatio = (depth - depth1) / (depth2 - depth1);
    
    const t1 = t11 + (t12 - t11) * distRatio;
    const t2 = t21 + (t22 - t21) * distRatio;
    
    return t1 + (t2 - t1) * depthRatio;
}

// 替换原来的 getWaveRadius 函数
function getWaveRadius(originTime, currentTime, depth, waveType) {
    const elapsedTime = (currentTime - originTime) / 1000;
    
    if (elapsedTime <= 0) {
        console.log(`${waveType.toUpperCase()}波: 经过时间<=0, 返回半径0`);
        return 0;
    }
    
    // 如果走时表未加载，使用固定速度计算
    if (!travelTimeDataLoaded || !travelTimeTable) {
        const v = waveType === 'p' ? 5.71 : 3.4; // km/s
        const radiusKm = elapsedTime * v;
        const radiusM = radiusKm * 1000;
        console.log(`${waveType.toUpperCase()}波固定速度计算:`, {
            经过时间: elapsedTime + 's',
            速度: v + 'km/s',
            半径: radiusM + 'm'
        });
        return radiusM;
    }
    
    // 使用走时表反算距离
    let low = 0;
    let high = Math.max(...travelTimeTable.distances);
    let bestDistance = 0;
    
    // 二分查找找到对应走时的距离
    for (let iter = 0; iter < 30; iter++) {
        const mid = (low + high) / 2;
        const travelTime = getTravelTime(depth, mid, waveType);
        
        const diff = travelTime - elapsedTime;
        
        if (Math.abs(diff) < 0.01) { // 精度提高到0.01秒
            bestDistance = mid;
            break;
        } else if (diff < 0) {
            // 走时小于经过时间，需要更大距离
            low = mid;
            bestDistance = mid;
        } else {
            // 走时大于经过时间，需要更小距离
            high = mid;
        }
        
        // 最后一次迭代，取中间值
        if (iter === 29) {
            bestDistance = (low + high) / 2;
        }
    }
    
    const radiusM = bestDistance * 1000; // 千米转米
    
    console.log(`${waveType.toUpperCase()}波走时表计算:`, {
        经过时间: elapsedTime + 's',
        深度: depth + 'km',
        计算距离: bestDistance + 'km',
        最终半径: radiusM + 'm',
        走时表状态: travelTimeDataLoaded ? '已加载' : '未加载'
    });
    
    return Math.max(1, radiusM); // 确保最小半径为1米
}

// 修改 loadTravelTimeTable 函数
function loadTravelTimeTable() {
    console.log('开始加载走时表...');
    return fetch('js/traveltime.txt')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.text();
        })
        .then(data => {
            if (!data || data.trim().length === 0) {
                throw new Error('走时表文件为空');
            }
            
            travelTimeTable = parseTravelTimeData(data);
            travelTimeDataLoaded = true;
            
            console.log('走时表加载成功:', {
                深度列表: travelTimeTable.depths,
                距离范围: `${Math.min(...travelTimeTable.distances)}-${Math.max(...travelTimeTable.distances)}km`,
                数据点数: travelTimeTable.depths.length * travelTimeTable.distances.length
            });
            
            return travelTimeTable;
        })
        .catch(err => {
            console.error('走时表加载失败，使用固定速度计算:', err);
            travelTimeDataLoaded = false;
            // 创建空的走时表结构避免错误
            travelTimeTable = {
                depths: [],
                distances: [],
                pTimes: {},
                sTimes: {}
            };
        });
}

// 新增全局变量
let highIntensityThreshold = 4; // 震度阈值，默认4度
let lastHighIntensityStations = []; // 记录上一次的高震度测站
let zoomToHighIntensity = false; // 是否已经缩放到高震度测站
let intensityZoomLock = false; // 锁定缩放，避免重复缩放

// 判断是否为日本地区事件
function isInJapan(lat, lon) {
    // 日本大致地理范围：纬度 24°N - 46°N，经度 122°E - 154°E
    return lat >= 24 && lat <= 46 && lon >= 122 && lon <= 154;
}

// 获取高震度测站（基于震度阈值）
function getHighIntensityStations(stations, threshold) {
    const highIntensityStations = [];
    
    if (stations && Array.isArray(stations)) {
        stations.forEach(sta => {
            const shindo = sta.shindo;
            if (typeof shindo === 'number' && shindo >= threshold) {
                highIntensityStations.push({
                    code: sta.code,
                    lat: sta.lat,
                    lon: sta.lon,
                    shindo: shindo
                });
            }
        });
    }
    
    return highIntensityStations;
}

// 比较两个高震度测站集合是否相同
function areHighIntensityStationsSame(oldStations, newStations) {
    if (oldStations.length !== newStations.length) return false;
    
    // 按测站代码排序后比较
    const oldCodes = oldStations.map(s => s.code).sort();
    const newCodes = newStations.map(s => s.code).sort();
    
    for (let i = 0; i < oldCodes.length; i++) {
        if (oldCodes[i] !== newCodes[i]) return false;
    }
    
    return true;
}

// 根据高震度测站进行缩放
function fitBoundsByHighIntensityStations(highIntensityStations) {
    if (!window.map || highIntensityStations.length === 0) return;
    
    // 如果有预警事件，添加震中
    let bounds = L.latLngBounds();
    
    // 添加震中
    if (iclSta && iclLat !== undefined && iclLon !== undefined) {
        bounds.extend([iclLat, iclLon]);
    }
    
    // 添加所有高震度测站
    highIntensityStations.forEach(sta => {
        bounds.extend([sta.lat, sta.lon]);
    });
    
    // 如果边界框有效，则应用缩放
    if (bounds.isValid()) {
        const paddedBounds = bounds.pad(0.2); // 20%边距
        
        // 动态计算缩放级别
        const boundsSize = paddedBounds.getNorthEast().distanceTo(paddedBounds.getSouthWest());
        let zoomLevel;
        
        // 根据区域大小设置缩放级别
        if (boundsSize > 1000000) { // 大于1000km
            zoomLevel = 5;
        } else if (boundsSize > 500000) { // 500-1000km
            zoomLevel = 6;
        } else if (boundsSize > 200000) { // 200-500km
            zoomLevel = 7;
        } else if (boundsSize > 100000) { // 100-200km
            zoomLevel = 8;
        } else if (boundsSize > 50000) { // 50-100km
            zoomLevel = 9;
        } else { // 小于50km
            zoomLevel = 10;
        }
        
        // 限定缩放范围在5-10之间
        zoomLevel = Math.max(5, Math.min(10, zoomLevel));
        
        // 设置缩放锁定，避免重复缩放
        intensityZoomLock = true;
        
        window.map.flyToBounds(paddedBounds, {
            padding: [50, 50],
            maxZoom: zoomLevel,
            duration: 1.5
        });
        
        console.log(`缩放到高震度测站区域，测站数量: ${highIntensityStations.length}，缩放级别: ${zoomLevel}`);
        
        // 5秒后解除缩放锁定
        setTimeout(() => {
            intensityZoomLock = false;
        }, 5000);
        
        return true;
    }
    
    return false;
}


addEventListener("load", function () {
    setTimeout(function () {
        $("#loading_Background").fadeTo("slow", 0);
    }, 1000);
    setTimeout(function () {
        $("#loading_Background").css("height", "0px");
        $("#loading_Background").css("width", "0px");
    }, 2000);
    
    // 确保走时表加载完成
    console.log('开始初始化走时表...');
    loadTravelTimeTable().then(() => {
        console.log('走时表初始化完成，状态:', travelTimeDataLoaded);
        if (travelTimeDataLoaded) {
            console.log('可用深度:', travelTimeTable.depths);
        }
    }).catch(err => {
        console.error('走时表初始化失败:', err);
    });
    
    setTimeout(hideLoading, 2500);
    setTimeout(hideLoading, 5000);
});

// 新增：安全隐藏 loading 层
function hideLoading() {
    $("#loading_Background").fadeTo("fast", 0);
    setTimeout(function () {
        $("#loading_Background").css("height", "0px");
        $("#loading_Background").css("width", "0px");
    }, 500);
    // 彻底移除 loading 层的内容，防止残留
    $("#loading_Text2").html("");
}

if (apiVertion == "test") {
    if (exp) document.getElementById("settingsVertion").innerHTML = "CEIV " + version + " 测试接口 实验版";
    if (!exp) document.getElementById("settingsVertion").innerHTML = "CEIV " + version + " 测试接口";
}

if (apiVertion == "formal") {
    if (exp) document.getElementById("settingsVertion").innerHTML = "CEIV " + version + " 正式接口 实验版";
    if (!exp) document.getElementById("settingsVertion").innerHTML = "CEIV " + version + " 正式接口";
}

document.ontouchmove = function (e) {
    e.preventDefault();
}

var localName;
var localLat;
var localLon;


// 新增：全局声明 S-net 点位相关变量，防止每次 SnetRedraw 时丢失

// 多事件轮播变量提前声明，避免引用错误
let iclEvents = [];
let iclCurrentIndex = 0;
let iclSwitchTimer = null;

// 新增：多事件震波圆管理
let sWaves = [], pWaves = [];
// 新增：S波填充圆管理
let sFillWaves = [];

// 修复：全局声明pandTimer，避免未定义报错
var pandTimer;

// 新增：测站数据管理
let stationData = {};
let stationMarkers = {}; // 改为对象，key为测站id
let stationLayer = null;

// 新增：测站震度图标管理
let stationShindoIcons = {}; // key为测站id
let stationShindoIconLevel = {}; // 记录上次显示的震度等级

// 新增：震源图标管理
let epicenterMarkers = [];

// 新增：地震覆盖物专用图层
let quakeLayer = null;

// ===== 行政区烈度分布（震度分布，多线程并行版，兼容原worker.js） =====
let adminWorkers = [];
let maxWorkers = 4;
let workerResults = [];
let pendingEvents = [];
let adminGeoJson = null;
let adminIntensityLayer = null;

// 关键参数跟踪
let lastEventParams = null; // 存储上次事件的关键参数
let lastMergedKey = null;   // 记录上次应用的合并结果键

// 加载行政区 GeoJSON
function loadAdminGeoJson() {
    return fetch("Resource/neweewgeo.json")
        .then(res => res.json())
        .then(data => { 
            adminGeoJson = data; 
            console.log("[震度分布] 行政区GeoJSON加载完成"); 
        })
        .catch(err => console.error("加载行政区GeoJSON失败:", err));
}

// 初始化多个 Worker
function initAdminWorkers() {
    if (adminWorkers.length > 0) return;

    for (let i = 0; i < maxWorkers; i++) {
        const w = new Worker("js/adminIntensity.worker.js");
        w.onmessage = function (e) {
            const { results } = e.data;
            if (!results) return;

            workerResults.push(results);
            console.log(`[震度分布] Worker${i} 完成任务`);

            checkAllWorkersDone();
        };
        w.onerror = function (err) {
            console.error(`[震度分布] Worker${i} 出错:`, err);
        };
        adminWorkers.push(w);
    }
}

// ================= 行政区震度分布（防重复计算版） =================
const adminCache = new Map();

function drawAdminIntensityMulti(events) {
    if (!adminGeoJson) {
        console.warn("[震度分布] 行政区GeoJSON未加载，延迟重试");
        return setTimeout(() => drawAdminIntensityMulti(events), 1000);
    }

    // 过滤无效事件
    const validEvents = events.filter(ev => 
        ev && ev.EventID && typeof ev.ReportNum !== 'undefined' && 
        !isNaN(Number(ev.Latitude)) && !isNaN(Number(ev.Longitude)) &&
        !isNaN(Number(ev.Depth)) && !isNaN(Number(ev.Magunitude))
    );
    
    if (validEvents.length === 0) {
        // 没有有效事件，清除图层
        if (adminIntensityLayer) {
            window.map.removeLayer(adminIntensityLayer);
            adminIntensityLayer = null;
            lastMergedKey = null;
            lastEventParams = null;
            console.log("[震度分布] 没有有效事件，已清除图层");
        }
        return;
    }

    // 提取关键参数
    const currentEventParams = validEvents.map(ev => ({
        EventID: ev.EventID,
        ReportNum: ev.ReportNum,
        Latitude: Number(ev.Latitude).toFixed(4),
        Longitude: Number(ev.Longitude).toFixed(4),
        Depth: Number(ev.Depth),
        Magunitude: Number(ev.Magunitude).toFixed(1)
    }));
    
    // 检查关键参数是否变化
    const paramsKey = JSON.stringify(currentEventParams);
    if (paramsKey === lastEventParams) {
        console.log("[震度分布] 关键参数未变化，跳过计算");
        return;
    }
    
    // 更新关键参数记录
    lastEventParams = paramsKey;
    
    initAdminWorkers();

    // ---------- 1. 收集本次需要的 key ----------
    const neededKeys = [];
    validEvents.forEach(ev => {
        const key = `${ev.EventID}_${ev.ReportNum}`;
        neededKeys.push(key);
    });

    // ---------- 2. 若全部命中缓存，直接复用样式 ----------
    const allHit = neededKeys.every(k => adminCache.has(k));
    if (allHit && neededKeys.length > 0) {
        console.log("[震度分布] 全部命中缓存，直接复用样式");
        const allResults = neededKeys.map(k => adminCache.get(k).result);
        const merged = mergeAdminIntensityResults(allResults);
        
        // 检查合并结果是否与当前显示相同
        const mergedKey = generateMergedKey(merged);
        if (mergedKey === lastMergedKey) {
            console.log("[震度分布] 合并结果与当前显示相同，跳过更新");
            return;
        }
        
        applyMergedResult(merged);
        return;
    }

    // ---------- 3. 未全部命中，走原并行计算流程 ----------
    workerResults = [];
    pendingEvents = validEvents;

    console.log(`[震度分布] 开始并行计算，共 ${validEvents.length} 个事件`);
    validEvents.forEach((ev, i) => {
        const params = {
            Mjma: Number(ev.Magunitude),
            depth: Number(ev.Depth),
            epicenterLat: Number(ev.Latitude || ev.Lat),
            epicenterLon: Number(ev.Longitude || ev.Lon),
            baseStepKm: 15
        };
        const worker = adminWorkers[i % maxWorkers];
        worker.postMessage({ cmd: "calc", features: adminGeoJson.features, params });
    });
}

// 生成合并结果的唯一键
function generateMergedKey(merged) {
    return JSON.stringify(merged.map(r => `${r.fid}:${r.maxShindo}`).sort());
}

// 应用合并结果到地图
function applyMergedResult(merged) {
    // 生成当前结果的唯一键
    const mergedKey = generateMergedKey(merged);
    
    // 检查是否与当前显示相同
    if (mergedKey === lastMergedKey) {
        console.log("[震度分布] 图层内容无变化，跳过更新");
        return;
    }
    
    // 更新最后显示的键
    lastMergedKey = mergedKey;

    const styleFn = feature => {
        const fid = feature.properties.name;
        const rec = merged.find(r => r.fid === fid);
        const shindo = rec ? String(rec.maxShindo) : "0";
        if (!rec || shindo === "0") return { opacity: 0, fillOpacity: 0 };
        const color = intColorJma[shindo]?.bkcolor || intColor[shindo]?.bkcolor || "#444";
        return {
            color: "#000",
            weight: 0.6,
            fillColor: color,
            fillOpacity: 1
        };
    };

    // 更新地图
    if (adminIntensityLayer) window.map.removeLayer(adminIntensityLayer);
    adminIntensityLayer = L.geoJSON(adminGeoJson, {
        pane: "baseGeoPane2",
        style: styleFn
    }).addTo(window.map);
    console.log("[震度分布] 图层已更新完成");
}

// ---------- 4. 回调：所有 worker 完成 ----------
function checkAllWorkersDone() {
    if (workerResults.length !== pendingEvents.length) return;

    console.log("[震度分布] 并行计算完成，开始合并结果");
    const merged = mergeAdminIntensityResults(workerResults);
    
    // 检查合并结果是否与当前显示相同
    const mergedKey = generateMergedKey(merged);
    if (mergedKey === lastMergedKey) {
        console.log("[震度分布] 合并结果与当前显示相同，跳过更新");
        return;
    }

    // ---------- 5. 写缓存 ----------
    pendingEvents.forEach((ev, index) => {
        const key = `${ev.EventID}_${ev.ReportNum}`;
        adminCache.set(key, {
            result: workerResults[index],
            timestamp: Date.now()
        });
    });

    // ---------- 6. 淘汰过期缓存 ----------
    const now = Date.now();
    for (const [key, value] of adminCache.entries()) {
        if (now - value.timestamp > 5 * 60 * 1000) { // 5分钟过期
            adminCache.delete(key);
        }
    }
    
    // 应用结果到地图
    applyMergedResult(merged);
}

// 合并多个事件的结果 → 每个行政区取最大震度
function mergeAdminIntensityResults(allResults) {
    const merged = {};
    allResults.forEach(results => {
        results.forEach(r => {
            const prev = merged[r.fid] || "0";
            const prevVal = parseShindoToNumber(prev);
            const newVal = parseShindoToNumber(r.maxShindo);
            if (newVal > prevVal) {
                merged[r.fid] = r.maxShindo;
            }
        });
    });
    return Object.entries(merged).map(([fid, maxShindo]) => ({ fid, maxShindo }));
}

// 辅助函数：把震度字符串转成数值比较
function parseShindoToNumber(shindo) {
    if (shindo === "0") return 0;
    if (shindo === "1") return 1;
    if (shindo === "2") return 2;
    if (shindo === "3") return 3;
    if (shindo === "4") return 4;
    if (shindo === "5-") return 5.0;
    if (shindo === "5+") return 5.5;
    if (shindo === "6-") return 6.0;
    if (shindo === "6+") return 6.5;
    if (shindo === "7") return 7;
    return 0;
}

// 页面初始化时加载 GeoJSON
loadAdminGeoJson();


// 全局变量定义
let knetStationList = [];
let knetStationLayer = null;
let KnetCanvas = null;
let KnetContext = null;
let KnetColorTable = null;
let KnetTimer = null;
let knetStationMarkers = {};
let knetStationShindoIcons = {};
let knetStationShindoIconLevel = {};

// 新增：K-NET像素数据缓存
let KnetImageCache = {}; // { timeStr: Uint8ClampedArray }
// 新增：K-NET缓存最大数量
const KNET_IMAGE_CACHE_MAX = 80;

// 新增：S-net像素数据缓存最大数量
const SNET_IMAGE_CACHE_MAX = 10;

// Leaflet 图层管理
window.map = null;

function RGBtoP(r, g, b) {
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0, s = 0, v = max;

    if (max !== min) {
        if (max === r) h = (60 * (g - b)) / (max - min);
        else if (max === g) h = (60 * (b - r)) / (max - min) + 120;
        else h = (60 * (r - g)) / (max - min) + 240;
        s = (max - min) / max;
    }

    if (h < 0) h += 360;
    h = h / 360;
    v = v / 255;

    let p = 0;
    if (v > 0.1 && s > 0.75) {
        if (h > 0.1476) {
            p = 280.31 * h ** 6 - 916.05 * h ** 5 + 1142.6 * h ** 4 - 709.95 * h ** 3 + 234.65 * h ** 2 - 40.27 * h + 3.2217;
        } else if (h > 0.001) {
            p = 151.4 * h ** 4 - 49.32 * h ** 3 + 6.753 * h ** 2 - 2.481 * h + 0.9033;
        } else {
            p = -0.005171 * v ** 2 - 0.3282 * v + 1.2236;
        }
    }

    return Math.max(0, p);
}

let lastKnetJstTime = null;
let lastKnetUpdateTimestamp = 0;
let knetTimeStale = false;

// ===== K-NET 服务器时间同步相关 =====
let serverJstMoment = null;
let serverTimeTimer = null;

// 获取服务器 JST 时间
function fetchServerTime() {
    fetch('https://api.wolfx.jp/ntp.json')
        .then(res => res.json())
        .then(json => {
            // 修正：取 JST.str
            if (json && json.JST && json.JST.str) {
                serverJstMoment = moment(json.JST.str, "YYYY-MM-DD HH:mm:ss");
            }
        })
        .catch(() => {
            // 网络异常时不更新 serverJstMoment
        });
}

// 页面加载时立即获取一次服务器时间，并定时同步
fetchServerTime();
if (!serverTimeTimer) {
    serverTimeTimer = setInterval(fetchServerTime, 50000); // 每1秒同步一次
}

// 更新 K-NET 时间胶囊（用本地时间减2秒）
function updateKnetTimeCapsule(jstTime, isStale = false) {
    const capsule = document.getElementById("knetTimeCapsule");
    if (!capsule) return;
    // 用本地时间减2秒
    const now = new Date(Date.now() - 1000);
    const h = now.getHours().toString().padStart(2, "0");
    const m = now.getMinutes().toString().padStart(2, "0");
    const s = now.getSeconds().toString().padStart(2, "0");
    capsule.innerText = `${h}时${m}分${s}秒更新`;
    capsule.style.background = "rgba(30,30,30,0.85)";
    capsule.style.color = isStale ? "#ff3b3b" : "#fff";
}

function tryInitKnetLayer() {
    if (!window.map) return setTimeout(tryInitKnetLayer, 200);
    if (!knetStationLayer) {
        knetStationLayer = L.layerGroup().addTo(window.map);
    }
    // 保证定时器唯一且为1秒
    if (KnetTimer) {
        clearInterval(KnetTimer);
        KnetTimer = null;
    }
    knetConsecutiveFailCount = 0;
    knetTimeoutRetrying = false;
    knetConsecutiveTimeoutCount = 0;
    knetTotalTimeoutCount = 0;
    knetPausedDueToTimeout = false;
    KnetTimer = setInterval(fetchKnetImage, 1000);
    fetchKnetImage();
}

// 新增：K-NET防“睡死”与高CPU保护
let knetConsecutiveFailCount = 0;
const KNET_MAX_FAIL = 10;
let knetTimeoutRetrying = false;

// 新增：K-NET 图像连续超时计数器
let knetConsecutiveTimeoutCount = 0;
const KNET_MAX_TIMEOUT = 20;

// K-NET 图像时间戳防死循环机制
let lastKnetImageTimeStr = null;
let knetImageSameCount = 0;
const KNET_IMAGE_SAME_MAX = 10;

// 新增：K-NET 超时重试最大次数
const KNET_MAX_TOTAL_TIMEOUT = 20;
let knetTotalTimeoutCount = 0;
let knetPausedDueToTimeout = false;

// 新增：K-NET解析worker
let knetWorker = null;
let knetWorkerReady = false;
let knetWorkerCallbacks = {};
let knetWorkerMsgId = 1;

// 初始化worker

function fetchKnetImage() {
    if (knetPausedDueToTimeout) return;

    fetch('http://192.168.1.223:2555/api/knet-data')
        .then(res => res.json())
        .then(json => {
            if (!json.success || !Array.isArray(json.data)) return;

            // 记录更新时间
            lastKnetUpdateTimestamp = Date.now();
            lastKnetJstTime = moment(json.timestamp);
            knetTimeStale = false;
            updateKnetTimeCapsule(lastKnetJstTime, false);

            // 直接调用新版渲染函数
            KnetRedrawFromJson(json.data);
        })
        .catch(err => {
            console.warn('K-NET 接口拉取失败', err);
            knetConsecutiveFailCount++;
            knetTotalTimeoutCount++;

            // 与旧逻辑一致的失败兜底
            if (knetTotalTimeoutCount >= KNET_MAX_TOTAL_TIMEOUT) {
                knetPausedDueToTimeout = true;
                if (KnetTimer) {
                    clearInterval(KnetTimer);
                    KnetTimer = null;
                }
                location.reload();
                return;
            }
            if (!knetTimeoutRetrying) {
                knetTimeoutRetrying = true;
                setTimeout(() => {
                    knetTimeoutRetrying = false;
                    fetchKnetImage();
                }, 2000);
            }
        });
}

// 修改 K-NET 渲染函数，添加高震度检测
function KnetRedrawFromJson(stations) {
    if (!knetStationLayer) return;

    const prevMarkers = { ...knetStationMarkers };
    const prevIcons = { ...knetStationShindoIcons };
    const usedCodes = new Set();

    // 新增：检测高震度测站
    const highIntensityStations = getHighIntensityStations(stations, highIntensityThreshold);
    
    // 如果当前有日本地区预警，且检测到高震度测站
    if (iclSta && iclEvents && iclEvents.length > 0) {
        const currentEvent = iclEvents[iclCurrentIndex];
        if (currentEvent && isInJapan(currentEvent.Latitude, currentEvent.Longitude)) {
            
            // 检查高震度测站是否有变化
            const stationsChanged = !areHighIntensityStationsSame(
                lastHighIntensityStations, 
                highIntensityStations
            );
            
            // 如果有高震度测站且发生了变化，并且没有缩放锁定
            if (highIntensityStations.length > 0 && stationsChanged && !intensityZoomLock) {
                // 更新记录
                lastHighIntensityStations = [...highIntensityStations];
                zoomToHighIntensity = true;
                
                // 延迟一小段时间再调整，避免频繁缩放
                setTimeout(() => {
                    if (iclSta) { // 再次检查预警是否仍在生效
                        fitBoundsByHighIntensityStations(highIntensityStations);
                    }
                }, 500);
            } else if (highIntensityStations.length === 0 && zoomToHighIntensity) {
                // 如果没有高震度测站但之前已经缩放过了，重置状态
                zoomToHighIntensity = false;
                lastHighIntensityStations = [];
            }
        }
    }

    stations.forEach(sta => {
        const { code, lat, lon, shindo, pga, timestamp } = sta;
        if (typeof lat !== 'number' || typeof lon !== 'number') return;

        usedCodes.add(code);

        // 圆点 marker（复用）
        let marker = knetStationMarkers[code];
        const color = typeof d3 !== 'undefined'
            ? calclocalshindocolor(shindo, 0.5)
            : '#00a0f1';

        if (!marker) {
            marker = L.circleMarker([lat, lon], {
                radius: 3,
                color: 'none',
                weight: 0,
                fillColor: color,
                fillOpacity: 0.95
            }).addTo(knetStationLayer);
            knetStationMarkers[code] = marker;
        } else {
            marker.setLatLng([lat, lon]);
            marker.setStyle({ fillColor: color });
        }
        marker.bindPopup(
            `站点: ${code}<br>` +
            `震度: ${typeof shindo === 'number' ? shindo.toFixed(1) : '-'}` +
            `<br>PGA: ${typeof pga === 'number' ? pga.toFixed(2) : '-'} gal`
        );

        // 震度图标（复用）
        let iconName = null, level = 0;
        if (typeof shindo === 'number' && shindo >= -0.5) {
            if (shindo < 0.5) { iconName = '1-'; level = 1; }
            else if (shindo < 1.5) { iconName = '1'; level = 2; }
            else if (shindo < 2.5) { iconName = '2'; level = 3; }
            else if (shindo < 3.5) { iconName = '3'; level = 4; }
            else if (shindo < 4.5) { iconName = '4'; level = 5; }
            else if (shindo < 5.0) { iconName = '5-'; level = 6; }
            else if (shindo < 5.5) { iconName = '5+'; level = 7; }
            else if (shindo < 6.0) { iconName = '6-'; level = 8; }
            else if (shindo < 6.5) { iconName = '6+'; level = 9; }
            else { iconName = '7'; level = 10; }
        }
        if (iconName) {
            let iconMarker = knetStationShindoIcons[code];
            const shindoIcon = L.divIcon({
                className: 'station-shindo-icon leaflet-div-icon',
                iconSize: [22, 22],
                iconAnchor: [11, 11],
                html: `<img src="shindopng/${iconName}.svg" style="width:48px;height:48px;display:block;"/>`
            });
            if (!iconMarker) {
                iconMarker = L.marker([lat, lon], {
                    icon: shindoIcon,
                    interactive: false,
                    zIndexOffset: 10000 + level * 100
                }).addTo(knetStationLayer);
                knetStationShindoIcons[code] = iconMarker;
                knetStationShindoIconLevel[code] = iconName;
            } else {
                iconMarker.setLatLng([lat, lon]);
                if (knetStationShindoIconLevel[code] !== iconName) {
                    iconMarker.setIcon(shindoIcon);
                    iconMarker.setZIndexOffset(10000 + level * 100);
                    knetStationShindoIconLevel[code] = iconName;
                }
            }
        } else {
            if (knetStationShindoIcons[code]) {
                knetStationLayer.removeLayer(knetStationShindoIcons[code]);
                delete knetStationShindoIcons[code];
                delete knetStationShindoIconLevel[code];
            }
        }
    });

    // 清除已消失的站点
    Object.keys(prevMarkers).forEach(code => {
        if (!usedCodes.has(code)) {
            knetStationLayer.removeLayer(prevMarkers[code]);
            delete knetStationMarkers[code];
        }
    });
    Object.keys(prevIcons).forEach(code => {
        if (!usedCodes.has(code)) {
            knetStationLayer.removeLayer(prevIcons[code]);
            delete knetStationShindoIcons[code];
            delete knetStationShindoIconLevel[code];
        }
    });
}


// 3. 把原来 tryInitKnetLayer 里对 fetchKnetImage 的调用去掉旧参数，只保留：
// ---------------------------------------------------------
function tryInitKnetLayer() {
    if (!window.map) return setTimeout(tryInitKnetLayer, 200);
    if (!knetStationLayer) {
        knetStationLayer = L.layerGroup().addTo(window.map);
    }
    if (KnetTimer) {
        clearInterval(KnetTimer);
        KnetTimer = null;
    }
    KnetTimer = setInterval(fetchKnetImage, 1000);
    fetchKnetImage(); // 立即执行一次
}



    // 这里可选：SnetRedraw();


// === S-net tiles 新版图像拼接与解析 ===
// 新增：S-net像素数据缓存








// 开发者模式：控制台命令下载最新拼接图片
function downloadSnetImage() {
    if (!window.SnetCanvas) {
        console.warn("SnetCanvas 不存在，无法下载。");
        return;
    }
    const link = document.createElement('a');
    link.href = window.SnetCanvas.toDataURL('image/png');
    link.download = `snet_${SnetLastValidTime || Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log("S-net 拼接图像已下载。");
}
window.downloadSnetImage = downloadSnetImage;

// 开发者模式：分别下载最新S-net 11.png和12.png
function downloadSnetImage11() {
    if (!window.SnetCanvas11) {
        console.warn("SnetCanvas11 不存在，无法下载。");
        return;
    }
    const link = document.createElement('a');
    link.href = window.SnetCanvas11.toDataURL('image/png');
    link.download = `snet_11_${SnetLastValidTime || Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log("S-net 11.png 已下载。");
}
function downloadSnetImage12() {
    if (!window.SnetCanvas12) {
        console.warn("SnetCanvas12 不存在，无法下载。");
        return;
    }
    const link = document.createElement('a');
    link.href = window.SnetCanvas12.toDataURL('image/png');
    link.download = `snet_12_${SnetLastValidTime || Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log("S-net 12.png 已下载。");
}
window.downloadSnetImage11 = downloadSnetImage11;
window.downloadSnetImage12 = downloadSnetImage12;






// 色表亮度推断函数
function RGBtoP(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0, v = max;
    if (max != min) {
        if (max == r) h = (60 * (g - b)) / (max - min);
        if (max == g) h = (60 * (b - r)) / (max - min) + 120;
        if (max == b) h = (60 * (r - g)) / (max - min) + 240;
        s = (max - min) / max;
    }
    if (h < 0) h += 360;
    h /= 360; v /= 255;
    let p = 0;
    if (v > 0.1 && s > 0.75) {
        if (h > 0.1476) {
            p = 280.31 * h ** 6 - 916.05 * h ** 5 + 1142.6 * h ** 4 - 709.95 * h ** 3 + 234.65 * h ** 2 - 40.27 * h + 3.2217;
        } else if (h > 0.001) {
            p = 151.4 * h ** 4 - 49.32 * h ** 3 + 6.753 * h ** 2 - 2.481 * h + 0.9033;
        } else {
            p = -0.005171 * v ** 2 - 0.3282 * v + 1.2236;
        }
    }
    return Math.max(p, 0);
}

// ===== 台湾地区测站集成 =====

// 台湾测站全局变量
let twStationInfo = {};      // 基础信息
let twStationData = {};      // 实时数据
let twStationLayer = null;   // 图层
let twStationMarkers = {};   // 圆点marker
let twStationShindoIcons = {}; // 震度图标
let twStationShindoIconLevel = {}; // 上次显示的iconName
let twStationTimer = null;
let twStationInfoTimer = null; // 新增：基础信息定时器

// 加载台湾测站基础信息（每6小时刷新一次）
function loadTwStationInfo() {
    return fetch("https://cdn.jsdelivr.net/gh/ExpTechTW/API@master/resource/station.json")
        .then(res => res.json())
        .then(json => { twStationInfo = json; });
}

// 拉取台湾测站实时数据
function fetchTwStationData() {
    fetch("https://lb-3.exptech.dev/api/v1/trem/rts")
        .then(res => res.json())
        .then(json => {
            if (json && json.station) {
                twStationData = json.station;
                redrawTwStations();
            }
        })
        .catch(err => {
            console.error("台湾测站实时数据拉取失败", err);
        });
}

// 渲染台湾测站（无闪烁复用）
function TwStationsRedrawWithParsed(parsedStations) {
    if (!parsedStations || !twStationLayer) return;
    const prevMarkers = { ...twStationMarkers };
    const prevIcons = { ...twStationShindoIcons };
    const usedCodes = new Set();

    parsedStations.forEach(elm => {
        const { lat, lon, shindo, code, pga, pgv } = elm;
        if (typeof lat !== "number" || typeof lon !== "number") return;
        usedCodes.add(code);
        let color = "#00a0f1";
        if (typeof d3 !== "undefined") {
            color = calclocalshindocolor(shindo, 0.5);
        }
        // marker复用
        let marker = twStationMarkers[code];
        if (!marker) {
            marker = L.circleMarker([lat, lon], {
                radius: 5,
                color: "none",
                weight: 0.5,
                fillColor: color,
                fillOpacity: 0.95
            }).addTo(twStationLayer);
            twStationMarkers[code] = marker;
        } else {
            marker.setLatLng([lat, lon]);
            marker.setStyle({ fillColor: color });
        }
        marker.bindPopup(`站点ID: ${code}<br>纬度: ${lat}<br>经度: ${lon}<br>震度: ${typeof shindo === "number" ? shindo.toFixed(1) : "-"}<br>PGA: ${typeof pga === "number" ? pga : "-"}<br>PGV: ${typeof pgv === "number" ? pgv : "-"}`);

        // icon复用
        let iconName = null, shindoLevel = 0;
        if (typeof shindo === "number" && shindo >= 0.5) {
            if (shindo < 1.5) { iconName = "1"; shindoLevel = 1; }
            else if (shindo < 2.5) { iconName = "2"; shindoLevel = 2; }
            else if (shindo < 3.5) { iconName = "3"; shindoLevel = 3; }
            else if (shindo < 4.5) { iconName = "4"; shindoLevel = 4; }
            else if (shindo < 5.0) { iconName = "5-"; shindoLevel = 5; }
            else if (shindo < 5.5) { iconName = "5+"; shindoLevel = 6; }
            else if (shindo < 6.0) { iconName = "6-"; shindoLevel = 7; }
            else if (shindo < 6.5) { iconName = "6+"; shindoLevel = 8; }
            else { iconName = "7"; shindoLevel = 9; }
        }
        if (iconName) {
            let iconMarker = twStationShindoIcons[code];
            const shindoIcon = L.divIcon({
                className: 'station-shindo-icon leaflet-div-icon',
                iconSize: [22, 22],
                iconAnchor: [11, 11],
                html: `<img src="shindopng/${iconName}.svg" style="width:48px;height:48px;display:block;"/>`
            });
            if (!iconMarker) {
                iconMarker = L.marker([lat, lon], {
                    icon: shindoIcon,
                    interactive: false,
                    zIndexOffset: 10000 + shindoLevel * 100
                }).addTo(twStationLayer);
                twStationShindoIcons[code] = iconMarker;
                twStationShindoIconLevel[code] = iconName;
            } else {
                iconMarker.setLatLng([lat, lon]);
                if (twStationShindoIconLevel[code] !== iconName) {
                    iconMarker.setIcon(shindoIcon);
                    iconMarker.setZIndexOffset(10000 + shindoLevel * 100);
                    twStationShindoIconLevel[code] = iconName;
                }
            }
        } else {
            if (twStationShindoIcons[code]) {
                twStationLayer.removeLayer(twStationShindoIcons[code]);
                delete twStationShindoIcons[code];
                delete twStationShindoIconLevel[code];
            }
        }
    });

    Object.keys(prevMarkers).forEach(code => {
        if (!usedCodes.has(code)) {
            twStationLayer.removeLayer(prevMarkers[code]);
            delete twStationMarkers[code];
        }
    });
    Object.keys(prevIcons).forEach(code => {
        if (!usedCodes.has(code)) {
            twStationLayer.removeLayer(prevIcons[code]);
            delete twStationShindoIcons[code];
            delete twStationShindoIconLevel[code];
        }
    });

    // 释放 parsedStations
    if (Array.isArray(parsedStations)) {
        parsedStations.length = 0;
    }
    parsedStations = null;
}

// ===== Wolfx SeisJS 测站集成 =====

// 全局变量
let wolfxStationInfo = {};      // 基础信息
let wolfxStationData = {};      // 实时数据
let wolfxStationLayer = null;   // 图层
let wolfxStationMarkers = {};   // 圆点marker
let wolfxStationShindoIcons = {}; // 震度图标
let wolfxStationShindoIconLevel = {}; // 上次显示的iconName
let wolfxStationInfoTimer = null;
let wolfxWs = null;
let wolfxReconnectTimer = null;
let wolfxHeartbeatTimeout = null;

// 加载测站基础信息（每10分钟刷新一次）
function loadWolfxStationInfo() {
    return fetch("https://api.wolfx.jp/seis_list.json")
        .then(res => res.json())
        .then(json => {
            wolfxStationInfo = json;
            redrawWolfxStations(); // 加载后立即刷新
        });
}

// WebSocket 连接与数据处理
function connectWolfxWebSocket() {
    if (wolfxWs) {
        try { wolfxWs.close(); } catch (e) {}
        wolfxWs = null;
    }
    wolfxWs = new WebSocket("wss://seisjs.wolfx.jp/all_seis");
    wolfxWs.onopen = function () {
        // 连接成功，清除重连定时器
        if (wolfxReconnectTimer) { clearTimeout(wolfxReconnectTimer); wolfxReconnectTimer = null; }
        // 心跳包超时保护
        resetWolfxHeartbeatTimeout();
    };
    wolfxWs.onmessage = function (evt) {
        let data;
        try {
            data = JSON.parse(evt.data);
        } catch (e) {
            return;
        }
        // 心跳包
        if (data.type === "heartbeat") {
            // 回复 ping
            try { wolfxWs.send("ping"); } catch (e) {}
            resetWolfxHeartbeatTimeout();
            return;
        }
        // 其它消息
        if (data.type && typeof data.type === "string" && data.type.length === 36) {
            // 测站UUID
            wolfxStationData[data.type] = data;
            redrawWolfxStations();
        }
    };
    wolfxWs.onclose = function () {
        wolfxWs = null;
        // 断线重连
        wolfxReconnectTimer = setTimeout(connectWolfxWebSocket, 3000);
    };
    wolfxWs.onerror = function () {
        try { wolfxWs.close(); } catch (e) {}
    };
}

// 心跳包超时保护
function resetWolfxHeartbeatTimeout() {
    if (wolfxHeartbeatTimeout) clearTimeout(wolfxHeartbeatTimeout);
    wolfxHeartbeatTimeout = setTimeout(() => {
        if (wolfxWs) {
            try { wolfxWs.close(); } catch (e) {}
        }
    }, 70000); // 70秒无心跳自动断开
}

function redrawWolfxStations() {
    if (!window.map || !wolfxStationLayer) return;

    if (stationWorkerReady && (Object.keys(wolfxStationInfo).length > 0 || Object.keys(wolfxStationData).length > 0)) {
        const msgId = stationWorkerMsgId++;
        stationWorker.postMessage({
            msgId,
            type: "wolfx",
            wolfxStationInfo,
            wolfxStationData
        });
        stationWorkerCallbacks[msgId] = function(type, result) {
            WolfxStationsRedrawWithParsed(result);
        };
    }
}

// Wolfx测站渲染（无闪烁复用）
function WolfxStationsRedrawWithParsed(parsedStations) {
    if (!parsedStations || !wolfxStationLayer) return;
    const prevMarkers = { ...wolfxStationMarkers };
    const prevIcons = { ...wolfxStationShindoIcons };
    const usedCodes = new Set();

    parsedStations.forEach(elm => {
        const { lat, lon, shindo, code, region, pga, pgv, update_at } = elm;
        if (typeof lat !== "number" || typeof lon !== "number") return;
        usedCodes.add(code);
        let color = "#00a0f1";
        if (typeof d3 !== "undefined" && shindo !== null) {
            color = calclocalshindocolor(shindo, 0.5);
        }
        // marker复用
        let marker = wolfxStationMarkers[code];
        if (!marker) {
            marker = L.circleMarker([lat, lon], {
                radius: 6,
                color: "none",
                weight: 0,
                fillColor: color,
                fillOpacity: 0.95
            }).addTo(wolfxStationLayer);
            wolfxStationMarkers[code] = marker;
        } else {
            marker.setLatLng([lat, lon]);
            marker.setStyle({ fillColor: color });
        }
        marker.bindPopup(`测站ID: ${code}<br>地点: ${region || "-"}<br>纬度: ${lat}<br>经度: ${lon}<br>震度: ${shindo !== null ? shindo.toFixed(1) : "-"}<br>PGA: ${typeof pga === "number" ? pga : "-"}<br>PGV: ${typeof pgv === "number" ? pgv : "-"}<br>更新时间: ${update_at || "-"}`);

        // icon复用
        let iconName = null, shindoLevel = 0;
        if (typeof shindo === "number" && shindo >= 0.5) {
            if (shindo < 1.5) { iconName = "1"; shindoLevel = 1; }
            else if (shindo < 2.5) { iconName = "2"; shindoLevel = 2; }
            else if (shindo < 3.5) { iconName = "3"; shindoLevel = 3; }
            else if (shindo < 4.5) { iconName = "4"; shindoLevel = 4; }
            else if (shindo < 5.0) { iconName = "5-"; shindoLevel = 5; }
            else if (shindo < 5.5) { iconName = "5+"; shindoLevel = 6; }
            else if (shindo < 6.0) { iconName = "6-"; shindoLevel = 7; }
            else if (shindo < 6.5) { iconName = "6+"; shindoLevel = 8; }
            else { iconName = "7"; shindoLevel = 9; }
        }
        if (iconName) {
            let iconMarker = wolfxStationShindoIcons[code];
            const shindoIcon = L.divIcon({
                className: 'station-shindo-icon leaflet-div-icon',
                iconSize: [22, 22],
                iconAnchor: [11, 11],
                html: `<img src="shindopng/${iconName}.svg" style="width:48px;height:48px;display:block;"/>`
            });
            if (!iconMarker) {
                iconMarker = L.marker([lat, lon], {
                    icon: shindoIcon,
                    interactive: false,
                    zIndexOffset: 10000 + shindoLevel * 100
                }).addTo(wolfxStationLayer);
                wolfxStationShindoIcons[code] = iconMarker;
                wolfxStationShindoIconLevel[code] = iconName;
            } else {
                iconMarker.setLatLng([lat, lon]);
                if (wolfxStationShindoIconLevel[code] !== iconName) {
                    iconMarker.setIcon(shindoIcon);
                    iconMarker.setZIndexOffset(10000 + shindoLevel * 100);
                    wolfxStationShindoIconLevel[code] = iconName;
                }
            }
        } else {
            if (wolfxStationShindoIcons[code]) {
                wolfxStationLayer.removeLayer(wolfxStationShindoIcons[code]);
                delete wolfxStationShindoIcons[code];
                delete wolfxStationShindoIconLevel[code];
            }
        }
    });

    Object.keys(prevMarkers).forEach(code => {
        if (!usedCodes.has(code)) {
            wolfxStationLayer.removeLayer(prevMarkers[code]);
            delete wolfxStationMarkers[code];
        }
    });
    Object.keys(prevIcons).forEach(code => {
        if (!usedCodes.has(code)) {
            wolfxStationLayer.removeLayer(prevIcons[code]);
            delete wolfxStationShindoIcons[code];
            delete wolfxStationShindoIconLevel[code];
        }
    });

    // 释放 parsedStations
    if (Array.isArray(parsedStations)) {
        parsedStations.length = 0;
    }
    parsedStations = null;
}

// 新增：S-net显示控制
let showSnetLayer = getCookie("showSnetLayer") !== "false"; // 默认显示

function tryInitMap() {
    if (document.getElementById('map')) {
        if (!window.map) {
            window.map = L.map('map', {
                center: [38.6329231, 138.4916350],
                zoom: 6,
                zoomControl: true,
                minZoom: 3,
                maxZoom: 10,
                continuousWorld: true,  // 允许地图左右环绕


            });

            // 先创建 baseGeoPane
            if (!window.map.getPane("baseGeoPane")) {
                window.map.createPane("baseGeoPane");
                window.map.getPane("baseGeoPane").style.zIndex = 200;
            }

            // 添加海洋底色
            L.rectangle(
                [[-90, -180], [90, 180]],
                {
                    color: "#222327",
                    weight: 0,
                    fillOpacity: 1,
                    fillColor: "#222327",
                    pane: "baseGeoPane"
                }
            ).addTo(window.map);

            // quakePane
            if (!window.map.getPane("quakePane")) {
                window.map.createPane("quakePane");
                window.map.getPane("quakePane").style.zIndex = 350;
            }
        }
        // 先 add stationLayer，再 add quakeLayer，quakeLayer 在下
        if (!stationLayer) {
            stationLayer = L.layerGroup();
            window.map.addLayer(stationLayer);
        }
        if (!quakeLayer) {
            quakeLayer = L.layerGroup([], { pane: "quakePane" });
            window.map.addLayer(quakeLayer);
        }

        if (showSnetLayer) {
        }
        tryInitTwStationLayer();
        tryInitWolfxStationLayer();
    } else {
        setTimeout(tryInitMap, 100);
    }
}
tryInitMap();

// 修复：添加 loadStationData 占位函数
function loadStationData() {
    console.warn("loadStationData 未定义，添加占位函数");
}

function tryInitStationLayer() {
    if (!window.map) return setTimeout(tryInitStationLayer, 200);
    if (!stationLayer) {
        stationLayer = L.layerGroup().addTo(window.map);
    }
    loadStationData();
    if (!window._stationTimer) {
        window._stationTimer = setInterval(loadStationData, 1000); // 1秒刷新一次
    }
}

// 创建自定义 pane，zIndex 比 quakePane 还低
if (window.map && !window.map.getPane("baseGeoPane")) {
    window.map.createPane("baseGeoPane");
    window.map.getPane("baseGeoPane").style.zIndex = 200; // 比 quakePane(350)低
}
// 创建自定义 pane，zIndex 比 quakePane 还低
if (window.map && !window.map.getPane("baseGeoPane1")) {
    window.map.createPane("baseGeoPane1");
    window.map.getPane("baseGeoPane1").style.zIndex = 205; // 比 quakePane(350)低
}

// 创建自定义 pane，zIndex 比 quakePane 还低
if (window.map && !window.map.getPane("baseGeoPane2")) {
    window.map.createPane("baseGeoPane2");
    window.map.getPane("baseGeoPane2").style.zIndex = 209; // 比 quakePane(350)低
}


fetch('Resource/SEKAI.geo.json')
    .then(r => r.json())
    .then(data => {
        // 原始
        L.geoJSON(data, {
            style: styleFeature,
            pane: "baseGeoPane",
            onEachFeature: onEachFeature
        }).addTo(map);

        // 平移一份经度 +360
        let shifted = JSON.parse(JSON.stringify(data));
        shiftLongitude(shifted, 360);
        L.geoJSON(shifted, {
            style: styleFeature,
            pane: "baseGeoPane",
            onEachFeature: onEachFeature
        }).addTo(map);
    });

function styleFeature(feature) {
    return {
        color: "#7E7A6E",
        weight: 1,
        fillColor: "#414143",
        fillOpacity: 1
    };
}

function onEachFeature(feature, layer) {
    if (feature.properties && feature.properties.name) {
        layer.bindPopup(feature.properties.name);
    }
}

// 把所有经度平移 offset（可以是 +360 或 -360）
function shiftLongitude(geoJson, offset) {
    function adjust(coords) {
        if (Array.isArray(coords[0])) {
            coords.forEach(c => adjust(c));
        } else {
            coords[0] += offset;
        }
    }
    geoJson.features.forEach(f => {
        if (f.geometry && f.geometry.coordinates) {
            adjust(f.geometry.coordinates);
        }
    });
}


// 板块交界线
fetch('Resource/PB2002_boundaries.json')
  .then(res => res.json())
  .then(data => {
    // 原始数据
    L.geoJSON(data, {
      style: { color: "#8D6F64", weight: 3 },
      pane: "baseGeoPane1"
    }).addTo(map);

    // 平移一份经度 +360
    let shifted = JSON.parse(JSON.stringify(data));
    shiftLongitude(shifted, 360);
    L.geoJSON(shifted, {
      style: { color: "#8D6F64", weight: 3 },
      pane: "baseGeoPane1"
    }).addTo(map);
  })
  .catch(err => console.error("GeoJSON 加载失败:", err));





// 中国断层
fetch('Resource/cn.fault.modified.geo.json')
    .then(response => response.json())
    .then(data => {
        L.geoJSON(data, {
            style: function(feature) {
                return {
                    color: "#8D6F64",
                    weight: 3,
                    fillOpacity: 0
                };
            },
            pane: "baseGeoPane1", // 指定到自定义底层pane
            onEachFeature: function(feature, layer) {
                if (feature.properties && feature.properties.name) {
                    layer.bindPopup(feature.properties.name);
                }
            }
        }).addTo(map);
    })
    .catch(err => {
        console.error("加载GeoJSON失败:", err);
    });


fetch('Resource/china_typhoon_warning_line_24h.geojson')
    .then(response => response.json())
    .then(data => {
        L.geoJSON(data, {
            style: function(feature) {
                return {
                    color: "#FE9900",
                    weight: 6,
                    fillOpacity: 0
                };
            },
            pane: "baseGeoPane1", // 指定到自定义底层pane
            onEachFeature: function(feature, layer) {
                if (feature.properties && feature.properties.name) {
                    layer.bindPopup(feature.properties.name);
                }
            }
        }).addTo(map);
    })
    .catch(err => {
        console.error("加载GeoJSON失败:", err);
    });


fetch('Resource/china_typhoon_warning_line_48h.geojson')
    .then(response => response.json())
    .then(data => {
        L.geoJSON(data, {
            style: function(feature) {
                return {
                    color: "#01B3FF",
                    weight: 4,
                    fillOpacity: 0
                };
            },
            pane: "baseGeoPane1", // 指定到自定义底层pane
            onEachFeature: function(feature, layer) {
                if (feature.properties && feature.properties.name) {
                    layer.bindPopup(feature.properties.name);
                }
            }
        }).addTo(map);
    })
    .catch(err => {
        console.error("加载GeoJSON失败:", err);
    });

// --- 防止地图长时间无操作后“睡死” ---
// 每60秒触发一次极小的 setView，激活 Leaflet 内部刷新，防止地图休眠
setInterval(function () {
    if (window.map && typeof window.map.getCenter === "function" && typeof window.map.setView === "function") {
        const center = window.map.getCenter();
        // 进行极小的偏移再还原，用户无感知
        window.map.setView([center.lat + 1e-10, center.lng + 1e-10], window.map.getZoom(), { animate: false });
        window.map.setView([center.lat, center.lng], window.map.getZoom(), { animate: false });
    }
}, 60000);

// ===== 防止地图、KNET、震源等“睡死” =====

// 1. 定时强制刷新地图瓦片（每10分钟）
setInterval(() => {
    if (window.map && window.map.eachLayer) {
        window.map.eachLayer(layer => {
            // 只刷新瓦片层
            if (layer instanceof L.TileLayer && typeof layer.redraw === "function") {
                try { layer.redraw(); } catch (e) {}
            }
        });
    }
}, 10 * 60 * 1000);

// 2. 定时检测并重启 quakeLayer、stationLayer、KnetLayer（每2分钟）
setInterval(() => {
    // quakeLayer
    if (window.map && quakeLayer && !window.map.hasLayer(quakeLayer)) {
        try { window.map.addLayer(quakeLayer); } catch (e) {}
    }
    // stationLayer
    if (window.map && stationLayer && !window.map.hasLayer(stationLayer)) {
        try { window.map.addLayer(stationLayer); } catch (e) {}
    }
    // KnetLayer
    if (typeof tryInitKnetLayer === "function") {
        tryInitKnetLayer();
    }
    // SnetLayer
    if (typeof tryInitSnetLayer === "function") {
        tryInitSnetLayer();
    }
    // 台湾测站
    if (typeof tryInitTwStationLayer === "function") {
        tryInitTwStationLayer();
    }
    // Wolfx测站
    if (typeof tryInitWolfxStationLayer === "function") {
        tryInitWolfxStationLayer();
    }
}, 2 * 60 * 1000);

// 3. 定时检测 Leaflet 地图对象是否异常，自动重载页面兜底（每30分钟）
setInterval(() => {
    if (!window.map || typeof window.map.getCenter !== "function" || typeof window.map.setView !== "function") {
        // 彻底失效时自动刷新页面
        location.reload();
    }
}, 30 * 60 * 1000);

// 4. 增强 KNET watchdog，检测 Canvas、定时器、图层等是否失效，自动重建
if (!window._knetWatchdogTimer2) {
    window._knetWatchdogTimer2 = setInterval(() => {
        // KnetCanvas/KnetContext失效
        if (KnetTimer && (!KnetCanvas || !KnetContext)) {
            if (KnetTimer) {
                clearInterval(KnetTimer);
                KnetTimer = null;
            }
            setTimeout(tryInitKnetLayer, 1000);
        }
        // KnetStationLayer失效
        if (window.map && knetStationLayer && !window.map.hasLayer(knetStationLayer)) {
            try { window.map.addLayer(knetStationLayer); } catch (e) {}
        }
        // Knet定时器失效
        if (!KnetTimer) {
            KnetTimer = setInterval(fetchKnetImage, 1000);
            fetchKnetImage();
        }
    }, 10000);
}

function displayAllIclEpicenters(isTest, retryCount = 0) {
    if (!window.map || !quakeLayer) {
        if (retryCount < 5) {
            setTimeout(() => displayAllIclEpicenters(isTest, retryCount + 1), 200);
        }
        return;
    }
    
    quakeLayer.clearLayers();
    epicenterMarkers = [];
    sWaves = [];
    pWaves = [];
    sFillWaves = [];

    if (stationLayer && !window.map.hasLayer(stationLayer)) window.map.addLayer(stationLayer);
    if (quakeLayer && !window.map.hasLayer(quakeLayer)) window.map.addLayer(quakeLayer);

    const now = Date.now();
    let validEvents = [];

    for (let i = 0; i < iclEvents.length; i++) {
        const ev = iclEvents[i];
        const lat = Number(ev.Latitude !== undefined ? ev.Latitude : ev.Lat);
        const lon = Number(ev.Longitude !== undefined ? ev.Longitude : ev.Lon);
        if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        const isCurrent = (i === iclCurrentIndex);

        const svgIcon = L.divIcon({
            className: '',
            iconSize: [40, 40],
            iconAnchor: [20, 20],
            html: `<img src="img (1)/Source-Copy.png" style="width:40px;height:40px;display:block;">`
        });
        
        const marker = L.marker([lat, lon], { icon: svgIcon, zIndexOffset: isCurrent ? 1000 : 999, pane: "quakePane" });
        marker.addTo(quakeLayer);
        epicenterMarkers.push(marker);

        validEvents.push(ev);

        // 确保深度是数字
        const depth = Number(ev.Depth) || 10; // 默认深度10km
        
        // 修改：使用走时表计算波半径
        const originTime = new Date(ev.OriginTime).getTime();
        if (!isNaN(originTime)) {
            const sRadius = getWaveRadius(originTime, now, depth, 's');
            const pRadius = getWaveRadius(originTime, now, depth, 'p');

            console.log(`事件 ${i}: S波半径=${sRadius}m, P波半径=${pRadius}m`);

            // S波主圆
            const sCircle = L.circle([lat, lon], {
                radius: Math.max(1, sRadius),
                color: "rgba(160,0,0,0.7)",
                weight: 5,
                fillColor: "#242424",
                fillOpacity: 0,
                pane: "quakePane"
            }).addTo(quakeLayer);
            sWaves.push(sCircle);

            // S波深色填充
            const sFillCircle = L.circle([lat, lon], {
                radius: Math.max(1, sRadius),
                color: null,
                weight: 0,
                fillColor: "rgba(80,0,0,0.72)",
                fillOpacity: 0.72,
                pane: "quakePane"
            }).addTo(quakeLayer);
            sFillWaves.push(sFillCircle);

            // P波主圆
            const pCircle = L.circle([lat, lon], {
                radius: Math.max(1, pRadius),
                color: "rgba(0,0,160,0.7)",
                weight: 5,
                fillColor: "#00FFFF",
                fillOpacity: 0,
                pane: "quakePane"
            }).addTo(quakeLayer);
            pWaves.push(pCircle);
        }
    }

    if (validEvents.length === 0) {
        if (adminIntensityLayer) {
            window.map.removeLayer(adminIntensityLayer);
            adminIntensityLayer = null;
            console.log("[震度分布] 没有生效的预警，已清空图层");
        }
    } else {
        console.log(`[震度分布] 检测到 ${validEvents.length} 个事件，准备计算`);
        drawAdminIntensityMulti(validEvents);
    }
}


function fitWaveBounds() {
    // 只在有事件且事件数组非空时自动缩放
    if (!iclSta || !iclEvents || iclEvents.length === 0) return;
    if (!bound) return;
    if (pWaves && pWaves.length > 0) {
        const group = L.featureGroup(pWaves);
        window.map.fitBounds(group.getBounds().pad(0.1));
        // 修复：自动缩放后强制限制缩放级别在 minZoom/maxZoom 范围内
        const minZoom = window.map.options.minZoom || 5;
        const maxZoom = window.map.options.maxZoom || 10;
        let currentZoom = window.map.getZoom();
        if (currentZoom < minZoom) {
            window.map.setZoom(minZoom);
        } else if (currentZoom > maxZoom) {
            window.map.setZoom(maxZoom);
        }
    } else if (typeof iclLon !== "undefined" && typeof iclLat !== "undefined") {
        window.map.setView([iclLat, iclLon], 7);
    }
}

// 使用所有K-NET测站进行缩放
function fitBoundsByKnetStations() {
    if (!window.map || Object.keys(knetStationMarkers).length === 0) {
        // 没有K-NET测站时，使用默认缩放
        fitBoundsByEventOnly();
        return;
    }
    
    // 创建包含所有K-NET测站的边界框
    const bounds = L.latLngBounds();
    
    // 添加当前事件的震中
    if (iclLat !== undefined && iclLon !== undefined) {
        bounds.extend([iclLat, iclLon]);
    }
    
    // 添加所有K-NET测站
    Object.values(knetStationMarkers).forEach(marker => {
        const latlng = marker.getLatLng();
        if (latlng) {
            bounds.extend(latlng);
        }
    });
    
    // 应用缩放，添加边距
    if (bounds.isValid()) {
        const paddedBounds = bounds.pad(0.2); // 20%边距
        
        // 动态计算合适的缩放级别
        const boundsSize = paddedBounds.getNorthEast().distanceTo(paddedBounds.getSouthWest());
        let zoomLevel;
        
        // 根据区域大小设置缩放级别
        if (boundsSize > 1000000) { // 大于1000km
            zoomLevel = 5;
        } else if (boundsSize > 500000) { // 500-1000km
            zoomLevel = 6;
        } else if (boundsSize > 200000) { // 200-500km
            zoomLevel = 7;
        } else if (boundsSize > 100000) { // 100-200km
            zoomLevel = 8;
        } else if (boundsSize > 50000) { // 50-100km
            zoomLevel = 9;
        } else { // 小于50km
            zoomLevel = 10;
        }
        
        // 限定缩放范围在5-10之间
        zoomLevel = Math.max(5, Math.min(10, zoomLevel));
        
        window.map.flyToBounds(paddedBounds, {
            padding: [50, 50],
            maxZoom: zoomLevel,
            duration: 1.5
        });
    }
}

// 使用P波半径进行缩放（非日本地区）
function fitBoundsByPWave() {
    if (!pWaves || pWaves.length === 0) {
        fitBoundsByEventOnly();
        return;
    }
    
    // 只对当前事件索引的P波进行缩放
    const currentPWave = pWaves[iclCurrentIndex];
    if (!currentPWave) {
        fitBoundsByEventOnly();
        return;
    }
    
    const group = L.featureGroup([currentPWave]);
    const bounds = group.getBounds();
    
    if (bounds.isValid()) {
        const paddedBounds = bounds.pad(0.2); // 20%边距
        
        // 动态计算合适的缩放级别
        const boundsSize = paddedBounds.getNorthEast().distanceTo(paddedBounds.getSouthWest());
        let zoomLevel;
        
        // 根据区域大小设置缩放级别
        if (boundsSize > 1000000) { // 大于1000km
            zoomLevel = 5;
        } else if (boundsSize > 500000) { // 500-1000km
            zoomLevel = 6;
        } else if (boundsSize > 200000) { // 200-500km
            zoomLevel = 7;
        } else if (boundsSize > 100000) { // 100-200km
            zoomLevel = 8;
        } else if (boundsSize > 50000) { // 50-100km
            zoomLevel = 9;
        } else { // 小于50km
            zoomLevel = 10;
        }
        
        // 限定缩放范围在5-10之间
        zoomLevel = Math.max(5, Math.min(10, zoomLevel));
        
        window.map.flyToBounds(paddedBounds, {
            padding: [50, 50],
            maxZoom: zoomLevel,
            duration: 1.5
        });
    }
}

// 仅使用震中进行缩放（兜底函数）
function fitBoundsByEventOnly() {
    if (typeof iclLon !== "undefined" && typeof iclLat !== "undefined") {
        // 根据震级动态调整缩放级别
        const magnitude = iclEvents[iclCurrentIndex]?.Magunitude || 6;
        let zoomLevel;
        
        if (magnitude >= 8) {
            zoomLevel = 6; // 大地震看得更广
        } else if (magnitude >= 7) {
            zoomLevel = 7;
        } else if (magnitude >= 6) {
            zoomLevel = 8;
        } else {
            zoomLevel = 9; // 小地震看得更近
        }
        
        // 限定缩放范围在5-10之间
        zoomLevel = Math.max(5, Math.min(10, zoomLevel));
        
        window.map.flyTo([iclLat, iclLon], zoomLevel, {
            duration: 1.5
        });
    }
}


function iclWaveExpand() {
    if (!window.map || !iclSta) return;
    const now = Date.now();
    console.log(`震波扩展: 当前时间=${now}, 事件数量=${iclEvents.length}`);
    
    for (let i = 0; i < iclEvents.length; i++) {
        const ev = iclEvents[i];
        const originTime = new Date(ev.OriginTime).getTime();
        if (!isNaN(originTime)) {
            const depth = Number(ev.Depth) || 10;
            
            // 修改：使用走时表计算波半径
            if (sWaves[i]) {
                const sRadius = getWaveRadius(originTime, now, depth, 's');
                sWaves[i].setRadius(Math.max(1, sRadius));
                console.log(`事件 ${i} S波半径: ${sRadius}m`);
            }
            if (sFillWaves[i]) {
                const sRadius = getWaveRadius(originTime, now, depth, 's');
                sFillWaves[i].setRadius(Math.max(1, sRadius));
            }
            if (pWaves[i]) {
                const pRadius = getWaveRadius(originTime, now, depth, 'p');
                pWaves[i].setRadius(Math.max(1, pRadius));
                console.log(`事件 ${i} P波半径: ${pRadius}m`);
            }
        }
    }
    fitWaveBounds();
}


function iclWaveDraw() {
    if (!window.map) return;
    
    // 只有有事件时才自动缩放和绘制
    if (!iclSta) {
        if (pandTimer) clearInterval(pandTimer);
        pandTimer = null;
        if (quakeLayer) quakeLayer.clearLayers();
        epicenterMarkers = [];
        sWaves = [];
        pWaves = [];
        sFillWaves = [];
        return;
    }
    
    if (pandTimer) clearInterval(pandTimer); // 防止多次叠加
    if (quakeLayer) quakeLayer.clearLayers(); // 只清 quakeLayer
    epicenterMarkers = [];
    sWaves = [];
    pWaves = [];
    sFillWaves = [];
    
    console.log("开始绘制震波");
    displayAllIclEpicenters();
    
    // 只有有事件时才自动缩放
    if (iclSta && iclEvents && iclEvents.length > 0) {
        fitWaveBounds();
    }
    
    // 每0.5秒刷新一次震波圈
    pandTimer = setInterval(() => {
        if (!iclSta) {
            clearInterval(pandTimer);
            pandTimer = null;
            if (quakeLayer) quakeLayer.clearLayers();
            epicenterMarkers = [];
            sWaves = [];
            pWaves = [];
            sFillWaves = [];
            return;
        }
        iclWaveExpand();
    }, 500); // 改为500ms更新一次
}

function onD3Ready(callback) {
    if (typeof d3 !== "undefined") {
        callback();
    } else {
        var d3Script = document.createElement('script');
        d3Script.src = "https://d3js.org/d3.v7.min.js";
        d3Script.onload = callback;
        document.head.appendChild(d3Script);
    }
}
function initProgram() {
    localName = getCookie("localName");
    $("#settings_LocalInputName").val(localName);
    localLat = getCookie("localLat");
    $("#settings_LocalInputLat").val(localLat);
    localLon = getCookie("localLon");
    $("#settings_LocalInputLon").val(localLon);

    bound = getCookie("bound");
    if (bound == "true") bound = true;
    if (bound == "false") bound = false;
    if (bound) {
        $("#zdsf").prop("checked", true);
    } else if (!bound) {
        $("#zdsf").prop("checked", false);
    }
    if (bound == null || bound == "null") {
        $("#zdsf").prop("checked", true);
        bound = "true";
        setCookie("bound", bound);
    }

    bbzd = getCookie("bbzd");
    if (bbzd == "true") bbzd = true;
    if (bbzd == "false") bbzd = false;
    if (bbzd) {
        $("#bbzd").prop("checked", true);
        $("#bbzdMap").removeAttr("disabled");
    } else if (!bbzd) {
        $("#bbzd").prop("checked", false);
        $("#bbzdMap").attr("disabled", "disabled");
        $("#currentTime").css("bottom", "8px");
    }

    if (bbzd == null || bbzd == "null") {
        $("#bbzdMap").removeAttr("disabled");
        $("#bbzd").prop("checked", true);
        bbzd = "true";
        setCookie("bbzd", bbzd);
    }

    bbzdMap = getCookie("bbzdMap");
    if (bbzdMap == "shindo") {
        $("#bbzdMap").val("震度");
    } else if (bbzdMap == "PGA") {
        $("#bbzdMap").val("PGA");
    }
    if (bbzdMap == undefined || bbzdMap == null || bbzdMap == "null" || bbzdMap == "") {
        $("#bbzdMap").val("PGA");
        bbzdMap = "PGA";
        setCookie("bbzdMap", "PGA");
    }

    hideStationOnEew = getCookie("hideStationOnEew") === "true";
}
initProgram();

loadEewBar(); // 页面初始化时立即显示预警栏状态
$.getJSON('http://154.9.252.189:3000/getapi', function(data){
    console.log(data);
});
//var
var bbzdMap;
var bound;
var cencType;
var cencLat;
var cencLon;
var cencDepth;
var cencEpicenter;
var cencStartAt;
var cencMagnitude;
var cencMaxInt;
var cencMd5;
var cencMd51;
var cencMd52;
var iclEventId;
var iclUpdates;
var iclLat;
var iclLon;
var iclDepth;
var iclEpicenter;
var iclStartAt;
var iclMagnitude;
var iclMaxInt;
var iclMaxInt2;
var iclOriTime;
var iclMd5;
var iclMd51;
var iclMd52;
var iclType;
var iclSta = false;
var currentTime;

// 新增：报文缓存用于多事件识别和保留所有生效事件
let iclEventCache = {}; // { EventID: { ReportNum, event, lastUpdate } }
const ICL_EVENT_CACHE_MAX = 30;
const ICL_EVENT_EXPIRE_MS = 5 * 60 * 1000; // 5分钟

// 修复：只启动一个轮换定时器，且每次新数据到来时重置
function iclDataGet() {
    let tried = 0;
    function tryFetch(urls) {
        if (!urls || !urls.length) {
            console.error("iclDataGet: 未配置接口地址或接口地址为空");
            showApiError("icl");
            iclSta = false;
            iclEvents = [];
            loadEewBar();
            hideLoading();
            iclWaveDraw(); // 新增：清除震波
            return;
        }
        if (tried >= urls.length) {
            console.error("iclDataGet: 所有接口尝试失败");
            showApiError("icl");
            iclSta = false;
            iclEvents = [];
            loadEewBar();
            hideLoading();
            iclWaveDraw(); // 新增：清除震波
            return;
        }
        $.getJSON(urls[tried], function (data) {
            const now = Date.now();
            const filtered = (data || [])
                .filter(ev => !String(ev.EventID).includes("EARLTEST"))
                .filter(ev => {
                    const t = new Date(ev.OriginTime).getTime();
                    const intv = Number(ev.MaxEstimatedIntensity);
                    return !isNaN(t) && (now - t <= 300000) && typeof intv === "number" && intv > 0;
                });

            // 新增：合并缓存和新数据，保留所有生效事件
            let isNewEvent = false;
            // 更新缓存
            filtered.forEach(ev => {
                if (!ev.EventID) return;
                if (!iclEventCache[ev.EventID] || iclEventCache[ev.EventID].ReportNum !== ev.ReportNum) {
                    isNewEvent = true;
                }
                iclEventCache[ev.EventID] = {
                    ReportNum: ev.ReportNum,
                    event: ev,
                    lastUpdate: now
                };
            });
            // 清理过期事件
            Object.keys(iclEventCache).forEach(eid => {
                if (now - iclEventCache[eid].lastUpdate > ICL_EVENT_EXPIRE_MS) {
                    delete iclEventCache[eid];
                }
            });
            // 限制缓存数量
            let cacheKeys = Object.keys(iclEventCache);
            if (cacheKeys.length > ICL_EVENT_CACHE_MAX) {
                // 按 lastUpdate 升序移除最旧
                cacheKeys.sort((a, b) => iclEventCache[a].lastUpdate - iclEventCache[b].lastUpdate);
                for (let i = 0; i < cacheKeys.length - ICL_EVENT_CACHE_MAX; i++) {
                    delete iclEventCache[cacheKeys[i]];
                }
            }
            // 生成所有生效事件数组，按 OriginTime 降序
            iclEvents = Object.values(iclEventCache)
                .map(e => e.event)
                .sort((a, b) => new Date(b.OriginTime) - new Date(a.OriginTime));
            // 只有新报文才重置索引和定时器
            if (isNewEvent) {
                iclCurrentIndex = 0;
                if (iclSwitchTimer) clearInterval(iclSwitchTimer);
            }
            updateIclGlobalsByIndex(iclCurrentIndex);

        function safeDisplayEpicenters() {
            if (!window.map || !quakeLayer) {
                setTimeout(safeDisplayEpicenters, 100);
                return;
            }
            displayAllIclEpicenters();
            fitWaveBounds();
            loadEewBar();
            // 只在多事件且新报文时启动轮播定时器
            if (iclEvents.length > 1 && isNewEvent) {
                iclSwitchTimer = setInterval(() => {
                    iclCurrentIndex = (iclCurrentIndex + 1) % iclEvents.length;
                    updateIclGlobalsByIndex(iclCurrentIndex);
                    displayAllIclEpicenters();
                    fitWaveBounds();
                    loadEewBar();
                    iclWaveDraw();
                }, 6000);
            }
            hideLoading();
            iclWaveDraw();
        }
            safeDisplayEpicenters();
        }).fail(function (jqXHR, textStatus, errorThrown) {
            console.error("iclDataGet: 预警接口请求失败", textStatus, errorThrown);
            tried++;
            tryFetch(urls);
        });
    }
    tryFetch(API_CONFIG.icl);
}

// 新增：根据当前索引同步全局变量
function updateIclGlobalsByIndex(idx) {
    if (!iclEvents || !iclEvents.length) return;
    const latestEvent = iclEvents[idx];
    iclEventId = latestEvent.EventID;
    iclUpdates = latestEvent.ReportNum;
    iclLat = latestEvent.Latitude;
    iclLon = latestEvent.Longitude;
    iclDepth = latestEvent.Depth;
    iclEpicenter = latestEvent.HypoCenter;
    iclStartAt = new Date(latestEvent.OriginTime).toLocaleString();
    iclMagnitude = latestEvent.Magunitude;
    iclMaxInt = latestEvent.MaxEstimatedIntensity;
    iclMaxInt2 = Math.round(iclMaxInt);
    iclOriTime = new Date(latestEvent.OriginTime).getTime();
    iclMd5 = latestEvent.EventID;
    iclSta = true;
    // 新增：尝试播放音效
    tryPlaySoundOnNewEvent(latestEvent);
}

// 保证定时器只负责数据拉取，轮换逻辑只在有多事件时由 iclSwitchTimer 控制
iclDataGet();
setInterval(iclDataGet, 1000); // 修改为1秒刷新一次

// 预警结束时重置状态
function iclCancel() {
    if (!iclSta) return;
    if (currentTime - iclOriTime <= 300000) return;
    
    iclSta = false;
    
    // 停止动画定时器
    if (pandTimer) { 
        clearInterval(pandTimer); 
        pandTimer = null; 
    }
    
    // 清除地图上的震中和震波
    if (quakeLayer) quakeLayer.clearLayers();
    epicenterMarkers = [];
    sWaves = [];
    pWaves = [];
    sFillWaves = [];
    sClosed = true;
    pClosed = true;
    $(".marker").remove();
    cencRun();
    loadEewBar();
    iclWaveDraw(); // 新增：彻底清除震波
    
    // 重置高震度缩放相关状态
    zoomToHighIntensity = false;
    lastHighIntensityStations = [];
    intensityZoomLock = false;
}


let testEewTimer = null;
// 修复 triggerTestEew 轮换逻辑与正式接口一致
function triggerTestEew() {
    const now = Date.now();
    const testEvents = [];
    for (let i = 0; i < 3; i++) {
        testEvents.push({
            EventID: "TEST" + now + "_" + i,
            ReportNum: i + 1,
            Latitude: 37.78 + Math.random() + i * 0.2,
            Longitude: 143.77 + Math.random() + i * 0.2,
            Depth: 10 + i * 2,
            HypoCenter: "四川眉山市丹棱县" + (i + 1),
            OriginTime: new Date(now - 10000 - i * 5000).toISOString(),
            Magunitude: 7.5 + i * 0.3,
            MaxEstimatedIntensity: 9 + i
        });
    }
    iclEvents = testEvents;
    iclCurrentIndex = 0;

    updateIclGlobalsByIndex(iclCurrentIndex);

    iclSta = true;

    displayAllIclEpicenters(true);
    fitWaveBounds();
    loadEewBar();
    currentTime = Date.now();
    iclWaveDraw();

    // 修复：只启动一个轮换定时器
    if (testEewTimer) clearInterval(testEewTimer);
    testEewTimer = setInterval(() => {
        currentTime = Date.now();
    }, 1000);

    if (iclSwitchTimer) clearInterval(iclSwitchTimer);
    if (iclEvents.length > 1) {
        iclSwitchTimer = setInterval(() => {
            iclCurrentIndex = (iclCurrentIndex + 1) % iclEvents.length;
            updateIclGlobalsByIndex(iclCurrentIndex);
            displayAllIclEpicenters(true);
            fitWaveBounds();
            loadEewBar();
        }, 6000);
    } else {
        iclSwitchTimer = null;
    }

    setTimeout(() => {
        iclSta = false;
        iclEvents = [];
        loadEewBar();
        if (testEewTimer) {
            clearInterval(testEewTimer);
            testEewTimer = null;
        }
        if (iclSwitchTimer) {
            clearInterval(iclSwitchTimer);
            iclSwitchTimer = null;
        }
        iclDataGet();
    }, 300000);
}

function iclCheck() {
    iclMd51 = iclMd5;
    if (iclMd51 !== iclMd52) {
        iclMd52 = iclMd5;
        if (parseInt(currentTime) - parseInt(iclOriTime) <= 300000) {
            iclWaveDraw();
            loadEewBar();
        }
    }
}

// 替换 updateAdminLayerWithWarning，支持多震分布合并

// 修改：loadEewBar 挂钩震度分布逻辑
function loadEewBar() {
    // 修复：始终根据 iclCurrentIndex 取当前事件
    let event = null;
    if (iclEvents && iclEvents.length > 0 && typeof iclCurrentIndex === "number") {
        event = iclEvents[iclCurrentIndex];
    }
    // 判断当前是否有事件
    const hasEvent = !(iclSta == false || !event || typeof event.ReportNum === "undefined");

    if (!hasEvent) {
        $("#eewBar").css({
            "opacity": "0",
            "pointer-events": "none"
        });
        $("#status").css({
            "opacity": "1",
            "pointer-events": "auto"
        });
        document.getElementById("status").innerHTML = '<span style="position: relative; top: 3px;"><ion-icon name="information-circle"></ion-icon></span>暂无生效中的地震即时警告';
        $("#status").css("color", "black");
        $("#status").css("background-color", "white");
        $("#eewBar_shindo").html("");
        $("#eewBar_epicenter").text("");
        $("#eewBar_time").text("");
        $("#eewBar_magnitude").text("");
        $("#eewBar_depth").html('<span style="font-size:15px;"></span>');
        setTimeout(refreshAllStationLayers, 0);

        // 只在“有事件→无事件”状态变化时回到默认视角
        if (lastHasEvent === true && window.map) {
            window.map.setView([38.6329231, 138.4916350], 6);
        }

        // 无事件时清除轮播定时器
        if (iclSwitchTimer) {
            clearInterval(iclSwitchTimer);
            iclSwitchTimer = null;
        }
        lastHasEvent = false;



        return;
    }
    lastHasEvent = true;

    $("#eewBar").css({
        "opacity": "1",
        "pointer-events": "auto"
    });
    $("#status").css({
        "opacity": "1",
        "pointer-events": "auto"
    });
    const isTest = event.EventID && String(event.EventID).startsWith("TEST");
    const total = iclEvents.length;
    const idxLabel = total > 1 ? `${iclCurrentIndex + 1}/${total}` : "";
    // 左上角烈度数字只显示数字且居中
    const shindoDisplay = getEventShindoDisplay(event);
    $("#eewBar_shindo").html(`
        <span style="font-size:75px;display:block;text-align:center;line-height:1.1;">${shindoDisplay.text}</span>
    `);
    $("#eewBar_shindo").css("background-color", shindoDisplay.color);
    $("#eewBar_shindo").css("color", "#fff");
    $("#eewBar_epicenter").text(event.HypoCenter || "");
    // 优化：根据字数直接设置字号
    autoFitEpicenterFont();
    $("#eewBar_time").text((event.OriginTime ? new Date(event.OriginTime).toLocaleString() + " 发生" : ""));
    $("#eewBar_magnitude").text("M" + (event.Magunitude ?? ""));
    $("#eewBar_depth").html((event.Depth !== undefined && event.Depth !== null ? event.Depth : "") + '<span style="font-size:15px;">km</span>');
    // status 里保留 1/x
    // ===== 修改区域：添加机构名前缀 =====
    let orgName = event.MechanismName ? event.MechanismName : "";
    let labelText = isTest
        ? `${orgName}${orgName ? "" : ""}（测试第${event.ReportNum ?? "-"}报）`
        : `${orgName}${orgName ? "" : ""}（第${event.ReportNum ?? "-"}报）`;
    document.getElementById("status").innerHTML =
        '<span style="position: relative; top: 3px;"><ion-icon name="alert-circle"></ion-icon></span> ' + labelText +
        (idxLabel ? ` <span style="font-size:18px;">${idxLabel}</span>` : "");
    $("#status").css("color", "white");
    $("#status").css("background-color", "red");
    setTimeout(refreshAllStationLayers, 0);

    if (iclEvents.length > 1) {
        if (!iclSwitchTimer) {
            iclSwitchTimer = setInterval(() => {
                iclCurrentIndex = (iclCurrentIndex + 1) % iclEvents.length;
                updateIclGlobalsByIndex(iclCurrentIndex);
                loadEewBar();
                displayAllIclEpicenters();
                fitWaveBounds();
                iclWaveDraw();
            }, 6000);
        }
    } else {
        // 只有一个事件时清除定时器
        if (iclSwitchTimer) {
            clearInterval(iclSwitchTimer);
            iclSwitchTimer = null;
        }
    }


}

// 优化：根据地名长度直接设置字号
function autoFitEpicenterFont() {
    const el = document.getElementById("eewBar_epicenter");
    if (!el) return;
    const text = el.textContent || "";
    const len = text.length;
    let fontSize;
    if (len <= 8) {
        fontSize = 26;
    } else if (len <= 12) {
        fontSize = 22;
    } else if (len <= 16) {
        fontSize = 18;
    } else if (len <= 20) {
        fontSize = 16;
    } else {
        fontSize = 14;
    }
    el.style.fontSize = fontSize + "px";
    el.style.whiteSpace = "nowrap";
    el.style.overflow = "visible";
    el.style.textOverflow = "unset";
}

// ====== 音效功能相关 ======
// 音效设置（默认值，优先本地文件）
let soundNoticeUrl = getCookie("soundNoticeUrl") || "sound/eewalert.wav";
let soundAlertUrl = getCookie("soundAlertUrl") || "sound/eewcritical.wav";
let soundNoticeThreshold = Number(getCookie("soundNoticeThreshold")) || 4;
let soundAlertThreshold = Number(getCookie("soundAlertThreshold")) || 6;
let soundNoticeAudio = null;
let soundAlertAudio = null;
// 修改：音效文件引用持久化到 window，刷新后可用（仅本次会话）
window.soundNoticeFile = window.soundNoticeFile || null;
window.soundAlertFile = window.soundAlertFile || null;
let soundNoticeFile = window.soundNoticeFile;
let soundAlertFile = window.soundAlertFile;
// 修改：记录每个事件已播放的音效级别（"notice" 或 "alert"）
let soundPlayedEvents = {}; // 形如 { EventID: "notice" | "alert" }

function loadSoundSettingsFromCookie() {
    // 优先本地文件选择（blob:），否则cookie/文本框
    let noticeUrl = $("#settings_SoundNoticeUrl").val() || getCookie("soundNoticeUrl");
    let alertUrl = $("#settings_SoundAlertUrl").val() || getCookie("soundAlertUrl");
    soundNoticeUrl = noticeUrl ? noticeUrl : "sound/notice.mp3";
    soundAlertUrl = alertUrl ? alertUrl : "sound/alert.mp3";
    soundNoticeThreshold = Number($("#settings_SoundNoticeThreshold").val() || getCookie("soundNoticeThreshold")) || 4;
    soundAlertThreshold = Number($("#settings_SoundAlertThreshold").val() || getCookie("soundAlertThreshold")) || 6;
    // 只在没有文件引用时才新建 Audio
    if (!window.soundNoticeFile) soundNoticeAudio = new Audio(soundNoticeUrl);
    if (!window.soundAlertFile) soundAlertAudio = new Audio(soundAlertUrl);
}

// 音效播放函数
function playSoundForEvent(event) {
    if (!event || !event.EventID) return;
    let intv = Number(event.MaxEstimatedIntensity);
    if (isNaN(intv)) return;
    const played = soundPlayedEvents[event.EventID];

    // 优先警报
    if (intv >= soundAlertThreshold) {
        if (played !== "alert") {
            // 优先用文件
            if (window.soundAlertFile) {
                const url = URL.createObjectURL(window.soundAlertFile);
                let audio = new Audio(url);
                audio.currentTime = 0;
                audio.play().catch(()=>{});
                setTimeout(()=>URL.revokeObjectURL(url), 10000);
            } else {
                if (!soundAlertAudio) soundAlertAudio = new Audio(soundAlertUrl);
                soundAlertAudio.currentTime = 0;
                soundAlertAudio.play().catch(()=>{});
            }
            soundPlayedEvents[event.EventID] = "alert";
        }
    } else if (intv >= soundNoticeThreshold) {
        if (!played) {
            if (window.soundNoticeFile) {
                const url = URL.createObjectURL(window.soundNoticeFile);
                let audio = new Audio(url);
                audio.currentTime = 0;
                audio.play().catch(()=>{});
                setTimeout(()=>URL.revokeObjectURL(url), 10000);
            } else {
                if (!soundNoticeAudio) soundNoticeAudio = new Audio(soundNoticeUrl);
                soundNoticeAudio.currentTime = 0;
                soundNoticeAudio.play().catch(()=>{});
            }
            soundPlayedEvents[event.EventID] = "notice";
        }
    }
}

// 在每次新事件到来时尝试播放音效
function tryPlaySoundOnNewEvent(event) {
    playSoundForEvent(event);
}

// 新增：监听文件选择，持久化文件引用到 window，刷新后可用（仅本次会话）
$(function () {
    $("#settings_SoundNoticeFile").on("change", function (e) {
        const file = e.target.files[0];
        if (file) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (!["mp3", "wav", "ogg"].includes(ext)) {
                alert("请选择mp3、wav或ogg格式的音频文件！");
                $(this).val('');
                return;
            }
            window.soundNoticeFile = file;
            soundNoticeFile = file;
            const url = URL.createObjectURL(file);
            $("#settings_SoundNoticeUrl").val(file.name);
            soundNoticeAudio = null;
        }
    });
    $("#settings_SoundAlertFile").on("change", function (e) {
        const file = e.target.files[0];
        if (file) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (!["mp3", "wav", "ogg"].includes(ext)) {
                alert("请选择mp3、wav或ogg格式的音频文件！");
                $(this).val('');
                return;
            }
            window.soundAlertFile = file;
            soundAlertFile = file;
            const url = URL.createObjectURL(file);
            $("#settings_SoundAlertUrl").val(file.name);
            soundAlertAudio = null;
        }
    });

    // 页面刷新时自动检测文件引用是否存在，不存在则清空URL输入框并提示
    if (!window.soundNoticeFile) {
        $("#settings_SoundNoticeUrl").val("");
    }
    if (!window.soundAlertFile) {
        $("#settings_SoundAlertUrl").val("");
    }
});





function cookiesCheck() {
    if (localName == null || localLat == null || localLon == null || localName == "" || localLat == "" || localLon == "" || localName == "请手动输入") {
        $(".localIcon").css("height", "0px");
        infoPopup("warning", "请到设置中填写您所在地地名及经纬度信息，以免CEIV运行出错。")
    }
}

// 修复：添加 infoPopup 占位函数
function infoPopup(type, message) {
    console.warn(`infoPopup 未定义，类型: ${type}, 消息: ${message}`);
}

setTimeout(function () {
    cookiesCheck();
},
    5000);

function settings() {
    $("#settingsBackground").css("width", "100%");
    $("#settingsBackground").css("height", "100%");
    $("#settingsBackground").fadeTo("slow", 0.7);

    $("#settingsWindow").css("width", "300px");
    $("#settingsWindow").css("height", "calc(100% - 40px);");
    $("#settingsWindow").animate({
        right: '0px'
    });
    bound = getCookie("bound");
    if (bound == "true") bound = true;
    if (bound == "false") bound = false;
    if (bound) $("#zdsf").prop("checked", true);
    if (bound == null || bound == "null") {
        $("#zdsf").prop("checked", true);
        bound = "true";
    }
    bbzd = getCookie("bbzd");
    if (bbzd == "true") bbzd = true;
    if (bbzd == "false") bbzd = false;
    if (bbzd) {
        $("#bbzd").prop("checked", true);
        $("#bbzdMap").removeAttr("disabled");
    }
    if (!bbzd) {
        $("#bbzd").prop("checked", false);
        $("#bbzdMap").attr("disabled", "disabled");
    }
    localName = getCookie("localName");
    $("#settings_LocalInputName").val(localName);
    localLat = getCookie("localLat");
    $("#settings_LocalInputLat").val(localLat);
    localLon = getCookie("localLon");
    $("#settings_LocalInputLon").val(localLon);
    bbzdMap = getCookie("bbzdMap");
    if (bbzdMap == "震度") $("#bbzdMap").val("震度");
    if (bbzdMap == "PGA") $("#bbzdMap").val("PGA");
    if (bbzdMap == undefined || bbzdMap == null || bbzdMap == "null" || bbzdMap == "") {
        $("#bbzdMap").val("PGA");
        bbzdMap = "PGA";
    }
    $("#settings_SoundNoticeUrl").val(getCookie("soundNoticeUrl") || "");
    $("#settings_SoundAlertUrl").val(getCookie("soundAlertUrl") || "");
    $("#settings_SoundNoticeThreshold").val(getCookie("soundNoticeThreshold") || 4);
    $("#settings_SoundAlertThreshold").val(getCookie("soundAlertThreshold") || 6);
    $("#settings_HideStationOnEew").prop("checked", hideStationOnEew);

    // 新增：S-net显示选项
    if ($("#settings_ShowSnetLayer").length === 0) {
        $("#settingsWindow").append(`
            <div style="margin:10px 0;">
                <label>
                    <input type="checkbox" id="settings_ShowSnetLayer" ${showSnetLayer ? "checked" : ""}>
                    显示S-net海底测站
                </label>
            </div>
        `);
    } else {
        $("#settings_ShowSnetLayer").prop("checked", showSnetLayer);
    }

    // 新增：显示模式选项
    if ($("#settings_ShindoMode").length === 0) {
        $("#settingsWindow").append(`
            <div style="margin:10px 0;">
                <label>显示模式:</label>
                <select id="settings_ShindoMode">
                    <option value="intensity" ${getShindoMode() === "intensity" ? "selected" : ""}>烈度</option>
                    <option value="jma" ${getShindoMode() === "jma" ? "selected" : ""}>JMA震度</option>
                </select>
            </div>
        `);
    } else {
        $("#settings_ShindoMode").val(getShindoMode());
    }
}

// 设置保存时增加音效设置
function settingsSaveClose() {
    bbzdMap = $("#bbzdMap option:selected").text();
    if (bbzdMap == "震度") setCookie("bbzdMap", "shindo");
    if (bbzdMap == "PGA") setCookie("bbzdMap", "PGA");
    bbzd = $('#bbzd').is(":checked");
    if (bbzd) setCookie("bbzd", "true");
    if (!bbzd) setCookie("bbzd", "false");
    bound = $('#zdsf').is(":checked");
    if (bound) setCookie("bound", "true");
    if (!bound) setCookie("bound", "false");
    localName = $("#settings_LocalInputName").val();
    localLat = $("#settings_LocalInputLat").val();
    localLon = $("#settings_LocalInputLon").val();
    setCookie("localName", localName);
    setCookie("localLat", localLat);
    setCookie("localLon", localLon);

    setCookie("soundNoticeUrl", $("#settings_SoundNoticeUrl").val());
    setCookie("soundAlertUrl", $("#settings_SoundAlertUrl").val());
    setCookie("soundNoticeThreshold", $("#settings_SoundNoticeThreshold").val());
    setCookie("soundAlertThreshold", $("#settings_SoundAlertThreshold").val());
    loadSoundSettingsFromCookie();

    hideStationOnEew = $('#settings_HideStationOnEew').is(":checked");
    setCookie("hideStationOnEew", hideStationOnEew ? "true" : "false");

    // 新增：保存S-net显示设置
    showSnetLayer = $('#settings_ShowSnetLayer').is(":checked");
    setCookie("showSnetLayer", showSnetLayer ? "true" : "false");

    // 新增：保存显示模式设置
    const shindoMode = $('#settings_ShindoMode').val();
    setShindoMode(shindoMode);

    $("#settingsBackground").fadeTo("slow", 0.0);
    setTimeout(function () {
        $("#settingsBackground").css("width", "0%");
        $("#settingsBackground").css("height", "0%");
    },
        1000)

    $("#settingsWindow").animate({
        right: '-300px'
    });
    setTimeout(function () {
        location.reload();
    },
        500)
}

function settingsCancel() {
    $("#settings_LocalInputName").val(localName);
    $("#settings_LocalInputLat").val(localLat);
    $("#settings_LocalInputLon").val(localLon);
    $("#settingsBackground").fadeTo("slow", 0.0);
    setTimeout(function () {
        $("#settingsBackground").css("width", "0%");
        $("#settingsBackground").css("height", "0%");
    },
        1000);
    $("#settingsWindow").animate({
        right: '-300px'
    });
}

function Rad(d) {
    return d * Math.PI / 180.0;
}

function getDistance(lat1, lng1, lat2, lng2) {
    var radLat1 = Rad(lat1);
    var radLat2 = Rad(lat2);
    var a = radLat1 - radLat2;
    var b = Rad(lng1) - Rad(lng2);
    var s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a / 2), 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2)));
    s = s * 6378.137;
    s = Math.round(s * 10000) / 10000;
    return s;
}

var IPName = "",
    IPLat = "",
    IPLon = "";
function geoIP() {
    $.getJSON("https://api.wolfx.jp/geoip.php?" + currentTime,
        function (json) {
            if (json.province_name_zh == json.city_zh) IPName = json.province_name_zh;
            if (json.province_name_zh !== json.city_zh) IPName = json.province_name_zh + json.city_zh;
            if (json.province_name_zh == null) {
                IPName = "请手动输入";
                infoPopup("warning", "所在地地名获取失败，请手动输入。")
            }
            IPLat = json.latitude;
            IPLon = json.longitude;
            $("#settings_LocalInputName").val(IPName);
            $("#settings_LocalInputLat").val(IPLat);
            $("#settings_LocalInputLon").val(IPLon);
        })
}

function bbzdDisplay() {
    if (!bbzd) {
        $("#bbshindo").css("height", "0px");
        $("#bbshindo").css("width", "0px");
        setInterval(function () {
            $(".bbshindoMapPoint").css("height", "0px");
            $(".bbshindoMapPoint").css("width", "0px");
        },
            1000)
    } else {
        $("#bbshindo").css("height", "152px");
        $("#bbshindo").css("width", "302px");
        setInterval(function () {
            $(".bbshindoMapPoint").css("height", "10px");
            $(".bbshindoMapPoint").css("width", "10px");
        },
            1000)
    }
}
bbzdDisplay();

const bbGeoJson = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "properties": {},
        "geometry": {
            "type": "Point",
            "coordinates": [106.3944963, 29.81081081]
        }
    }]
};

var local = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "properties": {},
        "geometry": {
            "type": "Point",
            "coordinates": [localLon, localLat]
        }
    }]
};

function calclocalshindocolor(shindo, level) {
    var localshindo = shindo;
    if (localshindo >= (-3.0) && localshindo < (-2.0)) {
        var a = d3.rgb(0, 0, 205);
        var b = d3.rgb(0, 64, 245);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (localshindo >= (-2.0) && localshindo < (-1.0)) {
        var a = d3.rgb(0, 72,250);
        var b = d3.rgb(0, 194, 150);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (localshindo >= (-1.0) && localshindo < (0.0)) {
        var a = d3.rgb(0, 208, 139);
        var b = d3.rgb(56, 245, 62);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (localshindo >= (0.0) && localshindo < (1.0)) {
        var a = d3.rgb(63, 250, 54);
        var b = d3.rgb(176, 254, 16);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (localshindo >= (1.0) && localshindo < (2.0)) {
        var a = d3.rgb(189, 255, 12);
        var b = d3.rgb(248, 255, 1);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (localshindo >= (2.0) && localshindo < (3.0)) {
        var a = d3.rgb(255, 255, 0);
        var b = d3.rgb(255, 224, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (localshindo >= (3.0) && localshindo < (4.0)) {
        var a = d3.rgb(255, 221, 0);
        var b = d3.rgb(255, 151, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (localshindo >= (4.0) && localshindo < (5.0)) {
        var a = d3.rgb(255, 144, 0);
        var b = d3.rgb(255, 75, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (localshindo >= (5.0) && localshindo < (6.0)) {
        var a = d3.rgb(255, 68, 0);
        var b = d3.rgb(246, 6, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (localshindo >= (6.0) && localshindo < (7.0)) {
        var a = d3.rgb(245, 0, 0);
        var b = d3.rgb(177, 0, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (localshindo >= (7.0)) {
        var a = d3.rgb(170, 0, 0);
        var b = d3.rgb(170, 0, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    }
}

function calclocalpgacolor(pga) {
    if (pga <= (0.01)) {
        return "rgb(0, 6, 209)";
    } else if (pga == (0.02)) {
        return "rgb(0, 33, 186)";
    } else if (pga > (0.02) && pga <= (0.05)) {
        let level = (pga * 10 - 0.2) * 0.333333;
        var a = d3.rgb(0, 45, 223);
        var b = d3.rgb(0, 108, 202);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (0.05) && pga <= (0.1)) {
        let level = (pga - 0.05) * 20;
        var a = d3.rgb(0, 125, 204);
        var b = d3.rgb(0, 205, 148);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (0.1) && pga <= (0.2)) {
        let level = (pga - 0.1) * 10;
        var a = d3.rgb(2, 214, 136);
        var b = d3.rgb(26, 228, 82);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (0.2) && pga <= (0.5)) {
        let level = (pga - 0.2) * 3.333;
        var a = d3.rgb(39, 246, 75);
        var b = d3.rgb(92, 246, 28);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (0.5) && pga <= (1)) {
        let level = (pga - 0.5) * 2;
        var a = d3.rgb(111, 251, 24);
        var b = d3.rgb(179, 250, 12);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (1) && pga <= (2)) {
        let level = (pga - 1);
        var a = d3.rgb(193, 248, 10);
        var b = d3.rgb(229, 232, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (2) && pga <= (10)) {
        let level = (pga - 2) * 0.333;
        var a = d3.rgb(255, 255, 0);
        var b = d3.rgb(255, 226, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (10) && pga <= (20)) {
        let level = (pga - 10) * 0.1;
        var a = d3.rgb(255, 217, 0);
        var b = d3.rgb(225, 180, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (20) && pga <= (50)) {
        let level = (pga - 20) * 0.0333;
        var a = d3.rgb(255, 167, 0);
        var b = d3.rgb(255, 121, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (50) && pga <= (100)) {
        let level = (pga - 50) * 0.02;
        var a = d3.rgb(255, 105, 0);
        var b = d3.rgb(255, 75, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (100) && pga <= (200)) {
        let level = (pga - 100) * 0.01;
        var a = d3.rgb(255, 61, 0);
        var b = d3.rgb(255, 25, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (200) && pga <= (500)) {
        let level = (pga - 200) * 0.00333;
        var a = d3.rgb(250, 20, 0);
        var b = d3.rgb(220, 0, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (500) && pga <= (1000)) {
        let level = (pga - 500) * 0.002;
        var a = d3.rgb(210, 0, 0);
        var b = d3.rgb(160, 0, 0);
        var compute = d3.interpolate(a, b);
        return compute(level);
    } else if (pga > (1000)) {
        return "rgb(160, 0, 0)";
    }
}

function bbzdCbCheck() {
    bbzdCbStatus = $('#bbzd').is(":checked");
    if (bbzdCbStatus) $("#bbzdMap").removeAttr("disabled");
    if (!bbzdCbStatus) $("#bbzdMap").attr("disabled", "disabled");
}

function fullScreen() {
    var element = document.documentElement;
    if (element.requestFullscreen) {
        element.requestFullscreen();
    } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
    } else if (element.mozRequestFullScreen) {
        element.mozFullScreen();
    } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
    }
}

function exitFullScreen() {
    if (document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.msExitFullscreen) {
    } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
    } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
    }

}

var i = 1;
function fullScreenF() {
    if (i == 1) {
        fullScreen();
    } else if (i == 2) {
        exitFullScreen();
    }
}

function isFullScreen() {
    return document.fullscreenElement || document.msFullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || false;
}

function fullScreenCheck() {
    if (isFullScreen() == false) {
        i = 1;
        document.getElementById("fullScreenBu").innerHTML = "全屏显示";
    } else {
        i = 2;
        document.getElementById("fullScreenBu").innerHTML = "退出全屏";
    }
}

setInterval(fullScreenCheck, 1000);

function backToEpicenter() {
    if (iclSta) {
        pb = (pWave.getBounds());
        pbj = eval(pb);
        pwswlon = pb.sw.lng;
        pwswlat = pb.sw.lat;
        pwnelon = pb.ne.lng;
        pwnelat = pb.ne.lat;
        window.map.fitBounds([[pwswlon - 1, pwswlat - 1],
        [pwnelon + 1, pwnelat + 1]]);
    }
    if (!iclSta) {
        var randomzoom = randomFrom(4.0, 5.0);
        window.map.flyTo({
            center: [cencLon, cencLat],
            essential: true,
            speed: 0.8,
            zoom: randomzoom,
            curve: 1
        });
    }
}

document.addEventListener("DOMContentLoaded", function() {
    updateKnetTimeCapsule(null, false);
});

function shouldShowStationMarker() {
    return !(hideStationOnEew && iclSta);
}



// 新增：监听设置变化时立即切换S-net显示
$(document).on("change", "#settings_ShowSnetLayer", function() {
    showSnetLayer = $(this).is(":checked");
    setCookie("showSnetLayer", showSnetLayer ? "true" : "false");
    if (SnetLayer) {
        if (showSnetLayer && !window.map.hasLayer(SnetLayer)) {
            window.map.addLayer(SnetLayer);
        } else if (!showSnetLayer && window.map.hasLayer(SnetLayer)) {
            window.map.removeLayer(SnetLayer);
        }
    }
});

// 新增：站点worker（S-net、Wolfx、台湾测站）
let stationWorker = null;
let stationWorkerReady = false;
let stationWorkerCallbacks = {};
let stationWorkerMsgId = 1;

function initStationWorker() {
    if (stationWorker) return;
    stationWorker = new Worker("js/station-worker.js");
    stationWorker.onmessage = function(e) {
        const { msgId, type, result } = e.data;
        if (msgId && stationWorkerCallbacks[msgId]) {
            try {
                stationWorkerCallbacks[msgId](type, result);
            } finally {
                delete stationWorkerCallbacks[msgId];
            }
        }
    };
    stationWorker.onerror = function(e) {
        console.error("Station Worker error", e);
    };
    stationWorkerReady = true;
}
initStationWorker();

// --- S-net Worker解析 ---
function SnetRedraw() {
    if (!SnetColorTable || !SnetLayer) return;

    const cacheKey = SnetLastValidTime ? SnetLastValidTime : null;
    const imagedata = cacheKey && SnetImageCache[cacheKey] ? SnetImageCache[cacheKey] : null;
    if (
        stationWorkerReady &&
        imagedata &&
        SnetPoints.length > 0
    ) {
        const msgId = stationWorkerMsgId++;
        // 直接用所有点位，不做Y偏移
        stationWorker.postMessage({
            msgId,
            type: "snet",
            imagedata: imagedata.buffer,
            points: SnetPoints,
            colorTable: SnetColorTable,
            width: 256,
            height: 512
        }, [imagedata.buffer]);
        stationWorkerCallbacks[msgId] = function(type, result) {
            SnetRedrawWithParsed(result, SnetLayer, SnetMarkers, SnetShindoIcons, SnetShindoIconLevel);
        };
    }
}


// --- 台湾测站 Worker解析 ---
function redrawTwStations() {
    if (!window.map || !twStationLayer) return;

    if (stationWorkerReady && Object.keys(twStationData).length > 0 && Object.keys(twStationInfo).length > 0) {
        const msgId = stationWorkerMsgId++;
        stationWorker.postMessage({
            msgId,
            type: "tw",
            twStationData,
            twStationInfo
        });
        stationWorkerCallbacks[msgId] = function(type, result) {
            TwStationsRedrawWithParsed(result);
        };
    }
}

// --- Wolfx Worker解析 ---
function redrawWolfxStations() {
    if (!window.map || !wolfxStationLayer) return;

    if (stationWorkerReady && (Object.keys(wolfxStationInfo).length > 0 || Object.keys(wolfxStationData).length > 0)) {
        const msgId = stationWorkerMsgId++;
        stationWorker.postMessage({
            msgId,
            type: "wolfx",
            wolfxStationInfo,
            wolfxStationData
        });
        stationWorkerCallbacks[msgId] = function(type, result) {
            WolfxStationsRedrawWithParsed(result);
        };
    }
}

// 新增：台湾测站初始化
function tryInitTwStationLayer() {
    if (!window.map) return setTimeout(tryInitTwStationLayer, 200);
    if (!twStationLayer) {
        twStationLayer = L.layerGroup().addTo(window.map);
    }
    // 基础信息每6小时刷新一次
    function refreshTwStationInfo() {
        loadTwStationInfo().then(() => {
            fetchTwStationData();
        });
    }
    refreshTwStationInfo();
    if (!twStationInfoTimer) {
        twStationInfoTimer = setInterval(refreshTwStationInfo, 6 * 60 * 60 * 1000); // 6小时
    }
    // 定时刷新实时数据
    if (!twStationTimer) {
        twStationTimer = setInterval(fetchTwStationData, 1000);
    }
}

// 新增：Wolfx测站初始化
function tryInitWolfxStationLayer() {
    if (!window.map) return setTimeout(tryInitWolfxStationLayer, 200);
    if (!wolfxStationLayer) {
        wolfxStationLayer = L.layerGroup().addTo(window.map);
    }
    // 基础信息每10分钟刷新一次
    function refreshWolfxStationInfo() {
        loadWolfxStationInfo().then(() => {
            redrawWolfxStations();
        });
    }
    refreshWolfxStationInfo();
    if (!wolfxStationInfoTimer) {
        wolfxStationInfoTimer = setInterval(refreshWolfxStationInfo, 10 * 60 * 1000); // 10分钟
    }
    // 启动 WebSocket
    connectWolfxWebSocket();
}

// 替换 index.js 中的 S-net 相关逻辑，采用 示例.js 方式

let SnetPoints = [];
let SnetMarkers = {};
let SnetLayer = null;
let SnetColorTable = null;
let SnetTiledCanvas = null;
let SnetTiledWidth = 0;
let SnetTiledHeight = 0;
let SnetTimer = null;
let SnetShindoIcons = {};
let SnetShindoIconLevel = {};
let msil_lastTime = 0;
let SnetLastValidTime = null;

function loadSnetColorTable() {
    if (SnetColorTable) return Promise.resolve();
    return fetch("./Resource/Knet_ColorTable.json")
        .then(res => res.json())
        .then(json => { SnetColorTable = json; });
}

function loadSnetPoints() {
    if (SnetPoints.length > 0) return Promise.resolve();
    return fetch("./Resource/Snet_Points.json")
        .then(res => res.json())
        .then(json => {
            SnetPoints = json.filter(elm => elm.Point && !elm.IsSuspended && elm.Location &&
                typeof elm.Location.Latitude === "number" && typeof elm.Location.Longitude === "number" &&
                typeof elm.Point.X === "number" && typeof elm.Point.Y === "number");
        });
}

function fetchValidTime() {
    const proxyUrl = "http://192.168.1.223:3001/proxy-img?url=";
    const targetUrl = encodeURIComponent("https://www.msil.go.jp/tiles/smoni/targetTimes.json");
    return fetch(proxyUrl + targetUrl)
        .then(res => res.json())
        .then(json => json.length ? json[json.length - 1].validtime : null);
}

function loadTileImage(url, x, y, range, ctx) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const dx = (x - range.xMin) * 256;
            const dy = (y - range.yMin) * 256;
            ctx.drawImage(img, dx, dy);
            resolve();
        };
        img.onerror = () => resolve();
        img.src = "http://192.168.1.223:3001/proxy-img?url=" + encodeURIComponent(url);
    });
}

function fetchSnetImageFromMsil() {
    fetchValidTime().then(validTime => {
        if (!validTime || validTime === msil_lastTime) return;
        SnetLastValidTime = validTime;

        const tileRange = { xMin: 26, xMax: 29, yMin: 11, yMax: 13 };
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = (tileRange.xMax - tileRange.xMin + 1) * 256;
        tempCanvas.height = (tileRange.yMax - tileRange.yMin + 1) * 256;
        const ctx = tempCanvas.getContext("2d");

        const tilePromises = [];
        for (let x = tileRange.xMin; x <= tileRange.xMax; x++) {
            for (let y = tileRange.yMin; y <= tileRange.yMax; y++) {
                const tileUrl = `https://www.msil.go.jp/tiles/smoni/${validTime}/${validTime}/5/${x}/${y}.png`;
                tilePromises.push(loadTileImage(tileUrl, x, y, tileRange, ctx));
            }
        }

        Promise.all(tilePromises).then(() => {
            msil_lastTime = validTime;
            SnetTiledCanvas = tempCanvas;
            SnetTiledWidth = tempCanvas.width;
            SnetTiledHeight = tempCanvas.height;
            SnetRedraw();
        });
    });
}

function SnetRedraw() {
    if (!SnetPoints || !SnetTiledCanvas || !SnetColorTable || !SnetLayer || !window.map) return;
    const ctx = SnetTiledCanvas.getContext('2d');
    const imagedata = ctx.getImageData(0, 0, SnetTiledWidth, SnetTiledHeight).data;

    SnetLayer.clearLayers();
    SnetMarkers = {}; SnetShindoIcons = {}; SnetShindoIconLevel = {};

    SnetPoints.forEach(elm => {
        const x = Math.floor(elm.Point.X);
        const y = Math.floor(elm.Point.Y);
        if (x < 0 || y < 0 || x >= SnetTiledWidth || y >= SnetTiledHeight) return;
        const idx = (y * SnetTiledWidth + x) * 4;
        const r = imagedata[idx], g = imagedata[idx + 1], b = imagedata[idx + 2], a = imagedata[idx + 3];
        if (a < 10) return;
        const lat = elm.Location.Latitude;
        const lon = elm.Location.Longitude;
        let shindo = SnetColorTable?.[r]?.[g]?.[b] ?? null;
        if (shindo === null) {
            const p = RGBtoP(r, g, b);
            const tmpNum = 10 ** (5 * p - 2);
            shindo = 0.868589 * Math.log(tmpNum) + 1;
        }
        if (!isFinite(shindo)) return;
        const marker = L.circleMarker([lat, lon], {
            radius: 6, color: "none", weight: 0, fillColor: calclocalshindocolor(shindo,0.5), fillOpacity: 0.95
        }).addTo(SnetLayer);
        SnetMarkers[elm.Code] = marker;
        marker.bindPopup(`站点: ${elm.Code}<br>物理震度: ${shindo.toFixed(1)}`);

        let iconName = null, shindoLevel = 0;
        if (typeof shindo === "number" && shindo >= -0.5) {      // 允许负值
            if (shindo < 0.5) {           // 新区间：-0.5 ≤ shindo ＜ 0.5
                iconName = "1-"; shindoLevel = 1;
            } else if (shindo < 1.5) {    // 0.5 起跳，后续不变
                iconName = "1"; shindoLevel = 2;
            } else if (shindo < 2.5) {
                iconName = "2"; shindoLevel = 3;
            } else if (shindo < 3.5) {
                iconName = "3"; shindoLevel = 4;
            } else if (shindo < 4.5) {
                iconName = "4"; shindoLevel = 5;
            } else if (shindo < 5.0) {
                iconName = "5-"; shindoLevel = 6;
            } else if (shindo < 5.5) {
                iconName = "5+"; shindoLevel = 7;
            } else if (shindo < 6.0) {
                iconName = "6-"; shindoLevel = 8;
            } else if (shindo < 6.5) {
                iconName = "6+"; shindoLevel = 9;
            } else {
                iconName = "7"; shindoLevel = 10;
            }
        }
        if (iconName) {
            const icon = L.divIcon({
                className: 'station-shindo-icon leaflet-div-icon',
                iconSize: [22, 22], iconAnchor: [11, 11],
                html: `<img src="shindopng/${iconName}.svg" style="width:48px;height:48px;display:block;"/>`
            });
            const iconMarker = L.marker([lat, lon], {
                icon, interactive: false, zIndexOffset: 10000 + shindoLevel * 100
            }).addTo(SnetLayer);
            SnetShindoIcons[elm.Code] = iconMarker;
            SnetShindoIconLevel[elm.Code] = iconName;
        }
    });
}

function tryInitSnetLayer() {
    if (!window.map) return setTimeout(tryInitSnetLayer, 200);
    if (!SnetLayer) SnetLayer = L.layerGroup().addTo(window.map);
    if (!SnetTimer) SnetTimer = setInterval(fetchSnetImageFromMsil, 5000);
    fetchSnetImageFromMsil();
}

Promise.all([loadSnetColorTable(), loadSnetPoints()]).then(tryInitSnetLayer);



function refreshAllStationLayers() {
    redrawTwStations();
    redrawWolfxStations();
    // 只有全部准备好时才刷新 S-net
    if ( Array.isArray(SnetPoints) && SnetColorTable) {
        SnetRedraw();
    }
}

let tsunamiLayer = null;
let blinkingLayers = [];
let blinkState = true;
let geojsonData = null;
let initialized = false;
let lastTsunamiReport = loadSavedReport();  // ← localStorage 记忆上次情报

const tsunamiColors = {
  MajorWarning: "#F901A2",
  Warning: "#F90101",
  Watch: "#F79400"
};

// 音效播放函数
function playSound(type) {
  const soundMap = {
    Watch: "sounds/tsunami_watch.wav",
    Warning: "sounds/tsunami_warning.wav",
    MajorWarning: "sounds/tsunami_major.wav",
    Clear: "sounds/tsunami_clear.wav"
  };
  const src = soundMap[type];
  if (src) {
    const audio = new Audio(src);
    audio.play().catch((e) => console.warn("音效播放失败：", e));
  }
}

// localStorage 工具
function loadSavedReport() {
  const json = localStorage.getItem("lastTsunamiReport");
  if (json) {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  return null;
}
function saveReport(report) {
  localStorage.setItem("lastTsunamiReport", JSON.stringify(report));
}
function clearSavedReport() {
  localStorage.removeItem("lastTsunamiReport");
}

// GeoJSON 加载一次
function loadGeoJSON(callback) {
  if (geojsonData) {
    callback(geojsonData);
    return;
  }
  fetch("Resource/jp.tsunami.geo.json")
    .then((res) => res.json())
    .then((json) => {
      geojsonData = json;
      callback(json);
    });
}

// 判断两个警报是否完全相同
function isSameReport(newReport, oldReport) {
  if (!oldReport || !newReport) return false;
  if (newReport.areas.length !== oldReport.areas.length) return false;
  for (let i = 0; i < newReport.areas.length; i++) {
    const a = newReport.areas[i];
    const b = oldReport.areas[i];
    if (a.name !== b.name || a.grade !== b.grade) return false;
  }
  return true;
}

// 主更新函数
function updateTsunamiLayer() {
  fetch("https://api.p2pquake.net/v2/jma/tsunami?limit=1")
    .then((res) => res.json())
    .then((data) => {
      const report = data[0];

      // 🔕 没有情报
      if (!report || report.cancelled || !report.areas || report.areas.length === 0) {
        if (tsunamiLayer && window.map) {
          window.map.removeLayer(tsunamiLayer);
          tsunamiLayer = null;
          blinkingLayers = [];
        }

        if (initialized && lastTsunamiReport && lastTsunamiReport.areas.length > 0) {
          playSound("Clear");
        }

        lastTsunamiReport = null;
        clearSavedReport();
        initialized = true;
        return;
      }

      initialized = true;
      const same = isSameReport(report, lastTsunamiReport);

      // 🔈 如果是首次发布，播放音效
      if (!same && !lastTsunamiReport) {
        const levels = report.areas.map(a => a.grade);
        if (levels.includes("MajorWarning")) playSound("MajorWarning");
        else if (levels.includes("Warning")) playSound("Warning");
        else if (levels.includes("Watch")) playSound("Watch");
      }

      // 保存当前为 last
      lastTsunamiReport = report;
      saveReport(report);

      // 无论是否相同都更新图层
      const areas = report.areas;
      const activeNames = areas.map((a) => a.name);

      loadGeoJSON((geojson) => {
        const filtered = {
          type: "FeatureCollection",
          features: geojson.features.filter(
            (f) => f.properties && activeNames.includes(f.properties.name)
          )
        };

        if (tsunamiLayer && window.map) {
          window.map.removeLayer(tsunamiLayer);
        }

        blinkingLayers = [];

        tsunamiLayer = L.geoJSON(filtered, {
          style: function (feature) {
            const area = areas.find((a) => a.name === feature.properties.name);
            const color = area && area.grade ? tsunamiColors[area.grade] : "#00BFFF";
            return {
              color: color,
              weight: 5,
              opacity: 1,
              fill: false
            };
          },
          onEachFeature: function (feature, layer) {
            blinkingLayers.push(layer);
            const area = areas.find((a) => a.name === feature.properties.name);
            if (area) {
              layer.bindTooltip(`${area.name}（${area.grade}）`);
            }
          }
        });

        tsunamiLayer.addTo(window.map);
      });
    });
}

// 闪烁控制
setInterval(() => {
  blinkState = !blinkState;
  blinkingLayers.forEach((layer) => {
    layer.setStyle({ opacity: blinkState ? 1 : 0 });
  });
}, 800);

// 初始化与定期更新
updateTsunamiLayer();
setInterval(updateTsunamiLayer, 30000);


// ===== Raspberry Shake 测站集成（优化版） =====
let rsStations = {};      // { code: { ...stationInfo, marker, popupBound, pga, pgv, disp, timestamp } }
let rsLayer = null;

// 初始化图层和定时刷新
function tryInitRsLayer() {
    if (!window.map) return setTimeout(tryInitRsLayer, 200);
    if (!rsLayer) {
        rsLayer = L.layerGroup().addTo(window.map);
    }

    fetchRsStations(); // 首次拉取基础信息
    fetchRsPgv();      // 首次拉取实时数据

    // 实时数据每 3 秒更新一次
    setInterval(fetchRsPgv, 1000);

    // 基础信息每 10 分钟更新一次
    setInterval(fetchRsStations, 10 * 60 * 1000);
}

function fetchRsStations() {
    fetch('http://192.168.1.223:1998/proxy?url=' + encodeURIComponent('https://stationview.raspberryshake.org/stations?online=true&net=AM'))
        .then(res => res.json())
        .then(data => {
            if (!Array.isArray(data)) return;
            data.forEach(sta => {
                if (!sta.code || !sta.latitude || !sta.longitude) return;

                // ✅ 屏蔽日本和台湾测站
                if (sta.country?.includes("Japan") || sta.country?.includes("Taiwan")) return;

                if (!rsStations[sta.code]) {
                    rsStations[sta.code] = {
                        ...sta,
                        marker: null,
                        popupBound: false,
                        pga: 0,
                        pgv: 0,
                        disp: 0,
                        timestamp: null
                    };
                } else {
                    Object.assign(rsStations[sta.code], sta);
                }
            });
        });
}

function fetchRsPgv() {
    fetch('http://192.168.1.223:1998/proxy?url=' + encodeURIComponent('https://stationview.raspberryshake.org/query/objects.json?QC&GM'))
        .then(res => res.json())
        .then(json => {
            if (!json?.request?.GM?.list) return;
            json.request.GM.list.forEach(obj => {
                const code = obj.id.split('.')[1];
                if (!rsStations[code]) return;

                const acc = obj.acc;

                // ✅ 屏蔽换算后超过 999 gal 的站点（acc > 9,990,000 µm/s²）
                if (acc > 9990000) return;

                rsStations[code].pga = acc / 10000;         // µm/s² → gal
                rsStations[code].pgv = obj.vel / 10000;     // µm/s → cm/s
                rsStations[code].disp = obj.disp / 10000;   // µm → cm
                rsStations[code].timestamp = obj.timestamp;
            });
            redrawRsStations();
        });
}

// 渲染测站（复用 marker，避免重建）
function redrawRsStations() {
    if (!rsLayer || !window.map) return;

    const bounds = window.map.getBounds(); // 当前地图视野范围

    Object.values(rsStations).forEach(sta => {
        if (!sta.latitude || !sta.longitude) return;
        
        // 原始位置
        if (bounds.contains([sta.latitude, sta.longitude])) {
            createOrUpdateStationMarker(sta, sta.latitude, sta.longitude);
        }
        
        // 平移位置（经度 +360）
        const shiftedLng = sta.longitude + 360;
        if (bounds.contains([sta.latitude, shiftedLng])) {
            createOrUpdateStationMarker(sta, sta.latitude, shiftedLng, true);
        }
    });
}

// 创建或更新测站标记
function createOrUpdateStationMarker(sta, lat, lng, isShifted = false) {
    const markerKey = isShifted ? 'shiftedMarker' : 'marker';
    const popupKey = isShifted ? 'shiftedPopupBound' : 'popupBound';
    
    const color = calclocalpgacolor(sta.pga || 0);

    let marker = sta[markerKey];
    if (!marker) {
        marker = L.circleMarker([lat, lng], {
            radius: 5,
            color: "#222",
            weight: 1,
            fillColor: color,
            fillOpacity: 0.95
        }).addTo(rsLayer);
        sta[markerKey] = marker;
        sta[popupKey] = false;
    } else {
        marker.setLatLng([lat, lng]);
        marker.setStyle({ fillColor: color });
    }

    if (!sta[popupKey]) {
        const popupContent = `
            <b>Raspberry Shake</b><br>
            站点: ${sta.code}<br>
            设备: ${sta.deviceName || "-"}<br>
            类型: ${sta.geophoneType || "-"}<br>
            国家: ${sta.country || "-"}<br>
            纬度: ${sta.latitude}<br>
            经度: ${sta.longitude}<br>
            <b>PGA:</b> ${sta.pga !== undefined ? sta.pga.toFixed(3) : "-"} gal<br>
            <b>PGV:</b> ${sta.pgv !== undefined ? sta.pgv.toFixed(3) : "-"} cm/s<br>
            <b>位移:</b> ${sta.disp !== undefined ? sta.disp.toFixed(5) : "-"} cm<br>
            更新时间: ${sta.timestamp ? new Date(sta.timestamp).toLocaleString() : "-"}`;
        marker.bindPopup(popupContent);
        sta[popupKey] = true;
    }
}

// 启动
tryInitRsLayer();

// ===== P-Alert 测站集成 =====

// 全局变量
let palertStationInfo = {};      
let palertStationData = {};      
let palertStationLayer = null;   
let palertStationMarkers = {};   
let palertStationShindoIcons = {};
let palertStationShindoIconLevel = {};
let palertStationInfoTimer = null;
let palertStationTimer = null;

function pgaToShindo(pga_gal) {
    if (typeof pga_gal !== "number" || pga_gal <= 0) return null;
    // JMA 连续震度公式（单位 gal）
    return 2 * Math.log10(pga_gal) - 0.94;
}
function loadPalertStationInfo() {
    return fetch("http://192.168.1.223:1995/proxy?url=https://palert.earth.sinica.edu.tw/graphql/", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: "query ($staFilter: staList_filter_choices) {\n  stationList(staFilter: $staFilter) {\n    staInfos\n    timestamp\n    version\n  }\n}",
            variables: { staFilter: "onlineDot15" }
        })
    })
    .then(res => res.json())
    .then(json => {
        if (json?.data?.stationList?.staInfos) {
            json.data.stationList.staInfos.forEach(sta => {
                palertStationInfo[sta.station] = {
                    lat: sta.lat,
                    lon: sta.lon,
                    name: sta.locname || sta.station,
                    area: sta.area
                };
            });
        }
    })
    .catch(err => console.error("P-Alert 基础信息失败", err));
}

// 实时 PGA
function fetchPalertStationData() {
    fetch("http://192.168.1.223:1995/proxy?url=https://palert.earth.sinica.edu.tw/graphql/", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: "query ($recordTime: Float, $type: Int, $token: String) {\n  realtimePGA(recordTime: $recordTime, type: $type, token: $token) {\n    dataVals\n    timestamp\n  }\n}",
            variables: { token: "", type: 0, recordTime: 0 }
        })
    })
    .then(res => res.json())
    .then(json => {
        if (json?.data?.realtimePGA?.dataVals) {
            for (const code in json.data.realtimePGA.dataVals) {
                const pga_g = json.data.realtimePGA.dataVals[code];
                const shindo = pgaToShindo(pga_g);
                palertStationData[code] = { pga: pga_g, shindo };
            }
            redrawPalertStations();
        }
    })
    .catch(err => console.error("P-Alert 实时数据失败", err));
}

// 渲染
function redrawPalertStations() {
    if (!palertStationLayer) return;
    const prevMarkers = { ...palertStationMarkers };
    const prevIcons = { ...palertStationShindoIcons };
    const usedCodes = new Set();

    for (const code in palertStationInfo) {
        const info = palertStationInfo[code];
        const data = palertStationData[code] || {};
        const shindo = data.shindo;
        const pga = data.pga;

        usedCodes.add(code);
        const color = (typeof d3 !== "undefined" && typeof shindo === "number") ?
            calclocalshindocolor(shindo, 0.5) : "#00a0f1";

        // 圆点
        let marker = palertStationMarkers[code];
        if (!marker) {
            marker = L.circleMarker([info.lat, info.lon], {
                radius: 5,
                color: "none",
                weight: 0,
                fillColor: color,
                fillOpacity: 0.95
            }).addTo(palertStationLayer);
            palertStationMarkers[code] = marker;
        } else {
            marker.setLatLng([info.lat, info.lon]);
            marker.setStyle({ fillColor: color });
        }
        marker.bindPopup(
            `P-Alert 测站: ${info.name}<br>` +
            `位置: ${info.area || "-"}<br>` +
            `震度: ${typeof shindo === "number" ? shindo.toFixed(1) : "-"}<br>` +
            `PGA: ${typeof pga === "number" ? pga.toFixed(2) : "-"} gal`
        );

        // 震度图标
        let iconName = null, shindoLevel = 0;
        if (typeof shindo === "number" && shindo >= 0.5) {
            if (shindo < 1.5) { iconName = "1"; shindoLevel = 1; }
            else if (shindo < 2.5) { iconName = "2"; shindoLevel = 2; }
            else if (shindo < 3.5) { iconName = "3"; shindoLevel = 3; }
            else if (shindo < 4.5) { iconName = "4"; shindoLevel = 4; }
            else if (shindo < 5.0) { iconName = "5-"; shindoLevel = 5; }
            else if (shindo < 5.5) { iconName = "5+"; shindoLevel = 6; }
            else if (shindo < 6.0) { iconName = "6-"; shindoLevel = 7; }
            else if (shindo < 6.5) { iconName = "6+"; shindoLevel = 8; }
            else { iconName = "7"; shindoLevel = 9; }
        }
        if (iconName) {
            let iconMarker = palertStationShindoIcons[code];
            const shindoIcon = L.divIcon({
                className: 'station-shindo-icon leaflet-div-icon',
                iconSize: [22, 22],
                iconAnchor: [11, 11],
                html: `<img src="shindopng/${iconName}.svg" style="width:48px;height:48px;display:block;"/>`
            });
            if (!iconMarker) {
                iconMarker = L.marker([info.lat, info.lon], {
                    icon: shindoIcon,
                    interactive: false,
                    zIndexOffset: 10000 + shindoLevel * 100
                }).addTo(palertStationLayer);
                palertStationShindoIcons[code] = iconMarker;
                palertStationShindoIconLevel[code] = iconName;
            } else {
                iconMarker.setLatLng([info.lat, info.lon]);
                if (palertStationShindoIconLevel[code] !== iconName) {
                    iconMarker.setIcon(shindoIcon);
                    iconMarker.setZIndexOffset(10000 + shindoLevel * 100);
                    palertStationShindoIconLevel[code] = iconName;
                }
            }
        } else {
            if (palertStationShindoIcons[code]) {
                palertStationLayer.removeLayer(palertStationShindoIcons[code]);
                delete palertStationShindoIcons[code];
                delete palertStationShindoIconLevel[code];
            }
        }
    }

    // 清除失效
    Object.keys(prevMarkers).forEach(code => {
        if (!usedCodes.has(code)) {
            palertStationLayer.removeLayer(prevMarkers[code]);
            delete palertStationMarkers[code];
        }
    });
    Object.keys(prevIcons).forEach(code => {
        if (!usedCodes.has(code)) {
            palertStationLayer.removeLayer(prevIcons[code]);
            delete palertStationShindoIcons[code];
            delete palertStationShindoIconLevel[code];
        }
    });
}


function tryInitPalertStationLayer() {
    if (!window.map) return setTimeout(tryInitPalertStationLayer, 200);
    if (!palertStationLayer) {
        palertStationLayer = L.layerGroup().addTo(window.map);
    }
    loadPalertStationInfo().then(() => {
        fetchPalertStationData();
        if (!palertStationInfoTimer) {
            palertStationInfoTimer = setInterval(loadPalertStationInfo, 6 * 60 * 60 * 1000);
        }
        if (!palertStationTimer) {
            palertStationTimer = setInterval(fetchPalertStationData, 1000);
        }
    });
}

onD3Ready(() => {
    tryInitPalertStationLayer();
});


// ===== 台风路径显示功能（添加在代码末尾） =====

// 台风相关全局变量
let typhoonLayer = null;
let typhoonTimer = null;
let activeTyphoons = [];
let lastTyphoonUpdate = {}; // 记录每个台风上一次的最新时间
let allTyphoonPoints = {};  // 保存每个台风的所有路径点

// 初始化台风图层
function initTyphoonLayer() {
    if (!window.map) return setTimeout(initTyphoonLayer, 200);

    if (!typhoonLayer) {
        typhoonLayer = L.layerGroup().addTo(window.map);
    }

    if (!typhoonTimer) {
        fetchTyphoons();
        typhoonTimer = setInterval(fetchTyphoons, 10 * 60 * 1000); // 每10分钟更新一次
    }
}

// 获取台风列表
function fetchTyphoons() {
    fetch('http://192.168.1.223:1998/proxy?url=' + encodeURIComponent('https://typhoon.slt.zj.gov.cn/Api/TyhoonActivity'))
        .then(response => response.json())
        .then(data => {
            if (Array.isArray(data) && data.length > 0) {
                activeTyphoons = data;
                data.forEach(typhoon => {
                    fetchTyphoonDetail(typhoon.tfid);
                });
            } else {
                if (typhoonLayer) typhoonLayer.clearLayers();
            }
        })
        .catch(error => {
            console.error('获取台风列表失败:', error);
        });
}

function fetchTyphoonDetail(tfid) {
    fetch('http://192.168.1.223:1998/proxy?url=' + encodeURIComponent(`https://typhoon.slt.zj.gov.cn/Api/TyphoonInfo/${tfid}`))
        .then(response => response.json())
        .then(data => {
            if (data && data.points) {
                drawTyphoon(data);
            }
        })
        .catch(error => {
            console.error(`获取台风详情失败: ${tfid}`, error);
        });
}

// 绘制台风路径和标记
function drawTyphoon(typhoonData) {
    if (!typhoonLayer || !typhoonData.points || typhoonData.points.length === 0) return;

    // 清除该台风之前的图层
    typhoonLayer.eachLayer(layer => {
        if (layer._typhoonId === typhoonData.tfid) {
            typhoonLayer.removeLayer(layer);
        }
    });

    // 当前点来自 TyhoonActivity
    const latestFromList = activeTyphoons.find(t => t.tfid === typhoonData.tfid);
    const latestLat = parseFloat(latestFromList?.lat);
    const latestLng = parseFloat(latestFromList?.lng);
    const latestTime = latestFromList?.time;

    // 历史点（橙色）
    const historyPoints = typhoonData.points.filter(p => p.time !== latestTime);
    if (historyPoints.length > 1) {
        const historicalPath = historyPoints.map(p => [parseFloat(p.lat), parseFloat(p.lng)]);
        const historicalPolyline = L.polyline(historicalPath, {
            color: 'orange',
            weight: 4,
            opacity: 1
        }).addTo(typhoonLayer);
        historicalPolyline._typhoonId = typhoonData.tfid;
    }
    historyPoints.forEach(p => {
        const historyIcon = L.divIcon({
            className: 'typhoon-history-marker',
            html: `<div style="background-color: orange; border: 2px solid white; border-radius: 50%; width: 10px; height: 10px;"></div>`,
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        });
        L.marker([parseFloat(p.lat), parseFloat(p.lng)], { icon: historyIcon })
            .addTo(typhoonLayer)._typhoonId = typhoonData.tfid;
    });

    // 当前点（红色 12px）
    if (latestLat && latestLng) {
        const typhoonIcon = L.divIcon({
            className: 'typhoon-current-marker',
            html: `<div style="background-color: red; border: 2px solid white; border-radius: 50%; width: 12px; height: 12px;"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });
        const marker = L.marker([latestLat, latestLng], { icon: typhoonIcon }).addTo(typhoonLayer);
        marker._typhoonId = typhoonData.tfid;

        const popupContent = `
            <strong>${typhoonData.name} (${typhoonData.enname})</strong><br>
            当前位置: ${latestLat.toFixed(2)}°N, ${latestLng.toFixed(2)}°E<br>
            强度: ${latestFromList.strong}<br>
            风速: ${latestFromList.speed} m/s<br>
            气压: ${latestFromList.pressure} hPa<br>
            移动方向: ${latestFromList.movedirection}<br>
            移动速度: ${latestFromList.movespeed} km/h<br>
            更新时间: ${latestFromList.timeformate}
        `;
        marker.bindPopup(popupContent);

        if (typhoonData.tfid === activeTyphoons[0]?.tfid) {

        }
    }

    // 未来点（浅蓝色，跳过第一个避免和当前点叠加）
    const lastPoint = typhoonData.points[typhoonData.points.length - 1];
    if (lastPoint.forecast && lastPoint.forecast.length > 0) {
        const chinaForecast = lastPoint.forecast.find(f => f.tm === "中国");
        if (chinaForecast && chinaForecast.forecastpoints) {
            const forecastPath = [[latestLat, latestLng]];
            chinaForecast.forecastpoints.slice(1).forEach(p => {
                forecastPath.push([parseFloat(p.lat), parseFloat(p.lng)]);
            });

            const forecastPolyline = L.polyline(forecastPath, {
                color: '#00BFFF',
                weight: 4,
                opacity: 1,
                dashArray: '5, 8'
            }).addTo(typhoonLayer);
            forecastPolyline._typhoonId = typhoonData.tfid;

            chinaForecast.forecastpoints.slice(1).forEach(p => {
                const forecastIcon = L.divIcon({
                    className: 'typhoon-forecast-marker',
                    html: `<div style="background-color: #00BFFF; border: 2px solid white; border-radius: 50%; width: 10px; height: 10px;"></div>`,
                    iconSize: [10, 10],
                    iconAnchor: [5, 5]
                });
                L.marker([parseFloat(p.lat), parseFloat(p.lng)], { icon: forecastIcon })
                    .addTo(typhoonLayer)._typhoonId = typhoonData.tfid;
            });
        }
    }
    // === 仅在有新数据时才跳转视角 ===
    if (typhoonData.points && typhoonData.points.length > 0) {
        const newestPoint = typhoonData.points[typhoonData.points.length - 1];
        const newestTime = newestPoint.time;

        if (lastTyphoonUpdate[typhoonData.tfid] !== newestTime) {
            // 更新记录
            lastTyphoonUpdate[typhoonData.tfid] = newestTime;

            // 保存该台风的所有点
            allTyphoonPoints[typhoonData.tfid] = typhoonData.points.map(p => [parseFloat(p.lat), parseFloat(p.lng)]);

            // 收集所有台风的路径点
            let mergedPoints = [];
            Object.values(allTyphoonPoints).forEach(points => {
                mergedPoints = mergedPoints.concat(points);
            });

            if (mergedPoints.length > 0) {
                const bounds = L.latLngBounds(mergedPoints);
                window.map.fitBounds(bounds, { padding: [50, 50] });
            }
        }
    }
}


// 在页面加载完成后初始化台风图层
setTimeout(initTyphoonLayer, 3000);

// 添加台风标记的CSS样式
const typhoonStyle = document.createElement('style');
typhoonStyle.innerHTML = `
    .typhoon-current-marker,
    .typhoon-history-marker,
    .typhoon-forecast-marker {
        will-change: transform;
        pointer-events: auto;
    }
`;
document.head.appendChild(typhoonStyle);



/********************************************************************
 *  JMA 海啸预报图层（仅「津波予報」类型）
 ********************************************************************/
(() => {
  const JMA_TSUNAMI_LIST = 'https://www.jma.go.jp/bosai/tsunami/data/list.json';
  const JMA_TSUNAMI_DATA = 'https://www.jma.go.jp/bosai/tsunami/data/';   // 后面拼文件名
  const GEOJSON_URL = 'Resource/jp.tsunami.geo.json';                       // 与既有警报同一套岸段

  let layer = null;
  let blinkLayers = [];
  let geojson = null;
  let lastFile = null;          // 记录上一次处理的文件名，避免重复
  let blinkTimer = null;
  let blinkOn = true;

  /* ---- 1. 工具：闪烁 ---- */
  function startBlink() {
    stopBlink();
    blinkTimer = setInterval(() => {
      blinkOn = !blinkOn;
      blinkLayers.forEach(l => l.setStyle({ opacity: blinkOn ? 1 : 0 }));
    }, 1200);
  }
  function stopBlink() {
    if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
    blinkLayers.forEach(l => l.setStyle({ opacity: 1 }));
  }

  /* ---- 2. 加载岸段 GeoJSON（仅一次）---- */
  async function loadGeoJSON() {
    if (geojson) return geojson;
    const res = await fetch(GEOJSON_URL);
    geojson = await res.json();
    return geojson;
  }

  /* ---- 3. 主函数：获取列表 → 取最新「津波予報」→ 加载详情 → 绘图 ---- */
  async function updateJmaTsunamiForecast() {
    try {
      const list = await (await fetch(JMA_TSUNAMI_LIST)).json();
      if (!Array.isArray(list) || !list.length) return;

      // 按 ctt 降序，取最新一条
      const latest = list.sort((a, b) => b.ctt - a.ctt)[0];
      if (latest.ttl !== '津波予報') {           // 非预报类型直接无视
        clearLayer();
        return;
      }

      const file = latest.json;                  // 形如 "20250919043336_20250919040133_VTSE41_0.json"
      if (file === lastFile) return;             // 文件未变化
      lastFile = file;

      // 3.1 取详情
      const detail = await (await fetch(JMA_TSUNAMI_DATA + file)).json();
      const valid = detail.Head.ValidDateTime;   // 解除时间
      if (new Date(valid) < new Date()) {        // 已过期
        clearLayer();
        return;
      }

      // 3.2 提取预报岸段
      const codes = new Set(
        detail.Body.Tsunami.Forecast.Item.map(it => it.Area.Code)
      );

      // 3.3 画图
      await drawForecast(codes, detail);
    } catch (e) {
      console.error('[JMA Tsunami Forecast] 更新失败', e);
    }
  }

  /* ---- 4. 绘制预报岸段 ---- */
  async function drawForecast(codes, detail) {
    await loadGeoJSON();
    clearLayer();               // 先清旧图

    const filtered = {
      type: 'FeatureCollection',
      features: geojson.features.filter(f =>
        f.properties && codes.has(f.properties.code)
      )
    };

    if (!filtered.features.length) return;

    layer = L.geoJSON(filtered, {
      style: () => ({ color: '#00BFFF', weight: 5, opacity: 1, fill: false }),
      onEachFeature: (f, l) => {
        blinkLayers.push(l);
        const name = f.properties.name || f.properties.enName || '';
        l.bindTooltip(`${name}（津波予報）`, { sticky: true });
      }
    }).addTo(window.map);

    startBlink();

    // 控制台打印摘要
    const names = filtered.features.map(f => f.properties.name).join('、');
    console.log(
      `[JMA 海啸预报] 生效岸段：${names} | 预计波高＜0.2 m | 解除时间：${detail.Head.ValidDateTime}`
    );
  }

  /* ---- 5. 清理图层 ---- */
  function clearLayer() {
    if (layer) {
      window.map.removeLayer(layer);
      layer = null;
    }
    blinkLayers = [];
    lastFile = null;
    stopBlink();
  }

  /* ---- 6. 启动定时器 ---- */
  function init() {
    if (!window.map) { setTimeout(init, 300); return; }
    updateJmaTsunamiForecast();
    setInterval(updateJmaTsunamiForecast, 30_000); // 30 秒刷新
  }

  init();
})();

// 新增：安全格式化数字函数
function safeFormatNumber(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) {
        return '-';
    }
    return Number(num).toFixed(decimals);
}






// ===== JMA 测站震度速报功能 =====
let jmaIntensityLayer = null;
let jmaIntensityData = null;
let jmaIntensityTimer = null;
let jmaIntensityMarkers = {};
let jmaIntensityEpicenterMarker = null;
let lastJmaEventId = null; // 记录上次的地震ID
let lastJmaUpdateTime = null; // 记录上次的更新时间

// 初始化 JMA 测站震度速报图层
function initJmaIntensityLayer() {
    if (!window.map) return setTimeout(initJmaIntensityLayer, 200);
    
    // 创建独立图层
    if (!jmaIntensityLayer) {
        jmaIntensityLayer = L.layerGroup().addTo(window.map);
    }
    
    // 启动定时获取数据
    if (!jmaIntensityTimer) {
        jmaIntensityTimer = setInterval(fetchJmaIntensity, 15000); // 15秒刷新
        fetchJmaIntensity(); // 立即执行一次
    }
}

// 获取 JMA 测站震度速报数据
function fetchJmaIntensity() {
    // 独立判断：仅在无预警时显示
    if (iclSta) {
        clearJmaIntensity();
        return;
    }

    // 第一步：获取地震列表
    fetch('http://192.168.1.223:1998/proxy?url=' + encodeURIComponent('https://www.jma.go.jp/bosai/quake/data/list.json'))
        .then(res => res.json())
        .then(listData => {
            if (!Array.isArray(listData) || listData.length === 0) {
                clearJmaIntensity();
                return;
            }

            // 找到最新的地震事件（第一条）
            const latestEvent = listData[0];
            if (!latestEvent || latestEvent.ttl !== "震源・震度情報") {
                clearJmaIntensity();
                return;
            }

            // 检查事件是否更新
            const currentEventId = latestEvent.eid;
            const currentUpdateTime = latestEvent.ctt;
            
            if (currentEventId === lastJmaEventId && currentUpdateTime === lastJmaUpdateTime) {
                return; // 数据未更新
            }

            // 第二步：获取详细数据
            const detailUrl = 'https://www.jma.go.jp/bosai/quake/data/' + latestEvent.json;
            return fetch('http://192.168.1.223:1998/proxy?url=' + encodeURIComponent(detailUrl))
                .then(res => res.json())
                .then(detailData => {
                    jmaIntensityData = {
                        eventInfo: latestEvent,
                        detailData: detailData
                    };
                    lastJmaEventId = currentEventId;
                    lastJmaUpdateTime = currentUpdateTime;
                    drawJmaIntensity();
                    
                    // 数据更新时自动调整视角
                    autoFitJmaIntensityView();
                });
        })
        .catch(err => {
            console.error('JMA 测站震度速报获取失败:', err);
            clearJmaIntensity();
        });
}

// 绘制 JMA 测站震度速报
function drawJmaIntensity() {
    if (!jmaIntensityData || !jmaIntensityLayer) return;

    // 清除之前的标记
    jmaIntensityLayer.clearLayers();
    jmaIntensityMarkers = {};

    const { eventInfo, detailData } = jmaIntensityData;
    const earthquake = detailData.Body?.Earthquake;
    const intensity = detailData.Body?.Intensity;

    if (!earthquake || !intensity) return;

    // 绘制震中图标
    const hypocenter = earthquake.Hypocenter?.Area;
    if (hypocenter && hypocenter.Coordinate) {
        // 解析坐标字符串，格式: "+43.1+141.0+0/"
        const coordMatch = hypocenter.Coordinate.match(/\+([\d.]+)\+([\d.]+)/);
        if (coordMatch) {
            const lat = parseFloat(coordMatch[1]);
            const lon = parseFloat(coordMatch[2]);
            
            if (!isNaN(lat) && !isNaN(lon)) {
                // 使用与预警相同的震中图标
                const svgIcon = L.divIcon({
                    className: '',
                    iconSize: [40, 40],
                    iconAnchor: [20, 20],
                    html: `<img src="img (1)/Source-Copy.png" style="width:40px;height:40px;display:block;">`
                });
                
                jmaIntensityEpicenterMarker = L.marker([lat, lon], { 
                    icon: svgIcon, 
                    pane: "quakePane" 
                }).addTo(jmaIntensityLayer);
                
                // 震中弹窗信息
                const popupContent = `
                    <div style="min-width:200px">
                        <h3 style="margin:5px 0;color:#ff0000">JMA 震度速报</h3>
                        <p><strong>位置:</strong> ${hypocenter.Name || '未知'}</p>
                        <p><strong>震级:</strong> M${earthquake.Magnitude || '?'}</p>
                        <p><strong>发震时间:</strong> ${earthquake.OriginTime ? new Date(earthquake.OriginTime).toLocaleString() : '未知'}</p>
                        <p><strong>最大震度:</strong> ${intensity.Observation?.MaxInt || '?'}</p>
                        <p><strong>数据时间:</strong> ${eventInfo.rdt ? new Date(eventInfo.rdt).toLocaleString() : '未知'}</p>
                    </div>`;
                
                jmaIntensityEpicenterMarker.bindPopup(popupContent);
            }
        }
    }

    // 绘制测站SVG图标
    if (intensity.Observation?.Pref && Array.isArray(intensity.Observation.Pref)) {
        intensity.Observation.Pref.forEach(pref => {
            if (pref.Area && Array.isArray(pref.Area)) {
                pref.Area.forEach(area => {
                    if (area.City && Array.isArray(area.City)) {
                        area.City.forEach(city => {
                            if (city.IntensityStation && Array.isArray(city.IntensityStation)) {
                                city.IntensityStation.forEach(station => {
                                    if (station.latlon && station.Int) {
                                        const lat = station.latlon.lat;
                                        const lon = station.latlon.lon;
                                        const intensityValue = station.Int;
                                        
                                        // 确定SVG图标文件名
                                        let iconName;
                                        switch(intensityValue) {
                                            case "1": iconName = "1"; break;
                                            case "2": iconName = "2"; break;
                                            case "3": iconName = "3"; break;
                                            case "4": iconName = "4"; break;
                                            case "5-": iconName = "5-"; break;
                                            case "5+": iconName = "5+"; break;
                                            case "6-": iconName = "6-"; break;
                                            case "6+": iconName = "6+"; break;
                                            case "7": iconName = "7"; break;
                                            default: iconName = "1"; // 默认使用1级图标
                                        }
                                        
                                        // 创建SVG图标
                                        const svgIcon = L.divIcon({
                                            className: 'jma-station-shindo-icon leaflet-div-icon',
                                            iconSize: [48, 48],
                                            iconAnchor: [24, 24],
                                            html: `<img src="js/shindoicon/${iconName}.png" style="width:48px;height:48px;display:block;filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.5)); background: transparent; border: none;"/>`
});
                                        const marker = L.marker([lat, lon], {
                                            icon: svgIcon,
                                            interactive: false,
                                            zIndexOffset: 10000 + getShindoLevel(intensityValue) * 100
                                        }).addTo(jmaIntensityLayer);
                                        
                                        // 测站弹窗信息
                                        const stationPopup = `
                                            <div style="min-width:180px">
                                                <strong>JMA 测站: ${station.Name || '未知'}</strong><br>
                                                <strong>地区:</strong> ${pref.Name} - ${area.Name} - ${city.Name}<br>
                                                <strong>震度:</strong> ${intensityValue}<br>
                                                <strong>纬度:</strong> ${lat.toFixed(4)}°<br>
                                                <strong>经度:</strong> ${lon.toFixed(4)}°
                                            </div>`;
                                        
                                        marker.bindPopup(stationPopup);
                                        const stationKey = `${pref.Code}_${area.Code}_${city.Code}_${station.Code}`;
                                        jmaIntensityMarkers[stationKey] = marker;
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    }
    
    console.log(`JMA 震度速报：已绘制 ${Object.keys(jmaIntensityMarkers).length} 个测站`);
}

// 获取震度等级对应的数值（用于z-index排序）
function getShindoLevel(shindo) {
    switch(shindo) {
        case "1": return 1;
        case "2": return 2;
        case "3": return 3;
        case "4": return 4;
        case "5-": return 5;
        case "5+": return 6;
        case "6-": return 7;
        case "6+": return 8;
        case "7": return 9;
        default: return 0;
    }
}

// 自动调整视角到震中和测站
function autoFitJmaIntensityView() {
    if (!jmaIntensityData || !window.map) return;
    
    // 创建包含震中和所有测站的边界框
    const bounds = L.latLngBounds();
    
    // 添加震中
    const earthquake = jmaIntensityData.detailData.Body?.Earthquake;
    if (earthquake?.Hypocenter?.Area?.Coordinate) {
        const coordMatch = earthquake.Hypocenter.Area.Coordinate.match(/\+([\d.]+)\+([\d.]+)/);
        if (coordMatch) {
            const lat = parseFloat(coordMatch[1]);
            const lon = parseFloat(coordMatch[2]);
            if (!isNaN(lat) && !isNaN(lon)) {
                bounds.extend([lat, lon]);
            }
        }
    }
    
    // 添加所有测站
    const intensity = jmaIntensityData.detailData.Body?.Intensity;
    if (intensity?.Observation?.Pref) {
        intensity.Observation.Pref.forEach(pref => {
            pref.Area?.forEach(area => {
                area.City?.forEach(city => {
                    city.IntensityStation?.forEach(station => {
                        if (station.latlon) {
                            bounds.extend([station.latlon.lat, station.latlon.lon]);
                        }
                    });
                });
            });
        });
    }
    
    // 如果边界框有效，则调整视角
    if (bounds.isValid()) {
        // 添加一些边距，确保所有点都在视野内
        const paddedBounds = bounds.pad(0.1);
        
        // 根据区域大小动态调整缩放级别
        const boundsSize = paddedBounds.getNorthEast().distanceTo(paddedBounds.getSouthWest());
        
        // 计算合适的缩放级别
        let zoomLevel;
        if (boundsSize > 1000000) { // 大于1000km
            zoomLevel = 5;
        } else if (boundsSize > 500000) { // 500-1000km
            zoomLevel = 6;
        } else if (boundsSize > 200000) { // 200-500km
            zoomLevel = 7;
        } else if (boundsSize > 100000) { // 100-200km
            zoomLevel = 8;
        } else if (boundsSize > 50000) { // 50-100km
            zoomLevel = 9;
        } else { // 小于50km
            zoomLevel = 10;
        }
        
        // 限制最大和最小缩放级别
        zoomLevel = Math.max(5, Math.min(12, zoomLevel));
        
        // 平滑飞向目标区域
        window.map.flyToBounds(paddedBounds, {
            padding: [50, 50],
            maxZoom: zoomLevel,
            duration: 1.5
        });
        
        console.log(`JMA 震度速报：自动调整视角，缩放级别 ${zoomLevel}`);
    }
}

// 清除 JMA 测站震度速报
function clearJmaIntensity() {
    if (jmaIntensityLayer) {
        jmaIntensityLayer.clearLayers();
    }
    jmaIntensityData = null;
    jmaIntensityEpicenterMarker = null;
    jmaIntensityMarkers = {};
    lastJmaEventId = null;
    lastJmaUpdateTime = null;
}

// 独立的状态检查函数
function checkJmaIntensityVisibility() {
    if (iclSta) {
        // 有预警时隐藏
        if (jmaIntensityLayer && window.map.hasLayer(jmaIntensityLayer)) {
            window.map.removeLayer(jmaIntensityLayer);
        }
    } else {
        // 无预警时显示
        if (jmaIntensityLayer && !window.map.hasLayer(jmaIntensityLayer)) {
            window.map.addLayer(jmaIntensityLayer);
            // 重新获取数据
            fetchJmaIntensity();
        }
    }
}

// 独立的定时状态检查
let jmaVisibilityTimer = null;
function startJmaVisibilityCheck() {
    if (!jmaVisibilityTimer) {
        jmaVisibilityTimer = setInterval(checkJmaIntensityVisibility, 1000);
    }
}

// 页面加载完成后初始化
setTimeout(() => {
    initJmaIntensityLayer();
    startJmaVisibilityCheck();
}, 3500);



