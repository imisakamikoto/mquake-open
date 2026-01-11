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

onmessage = function(e) {
    const { msgId, type } = e.data;
    try {
        if (type === "snet") {
            let { imagedata, points, colorTable, width, height } = e.data;
            // 确保数据有效
            if (!imagedata || !points || !Array.isArray(points)) {
                console.error("Invalid snet data received");
                return postMessage({ msgId, type, result: [] });
            }
            
            let arr = new Uint8ClampedArray(imagedata);
            const result = [];
            
            // 调试日志
            console.log(`Processing S-net: ${points.length} points, image size: ${width}x${height}`);
            
            for (let i = 0; i < points.length; i++) {
                const elm = points[i];
                if (!elm || !elm.Point) continue;
                
                // 确保坐标在有效范围内
                let x = Math.max(0, Math.min(width - 1, Math.round(elm.Point.X)));
                let y = Math.max(0, Math.min(height - 1, Math.round(elm.Point.Y)));
                
                // 计算索引并确保在数组范围内
                const idx = y * width + x;
                if (4 * idx + 3 >= arr.length) {
                    console.warn(`Index out of bounds: ${idx} for point ${elm.Code}`);
                    continue;
                }
                
                const r = arr[4 * idx];
                const g = arr[4 * idx + 1];
                const b = arr[4 * idx + 2];
                const a = arr[4 * idx + 3];
                
                // 忽略透明像素
                if (a < 10) continue;
                
                let shindo = null;
                // 优先使用色表
                if (colorTable && colorTable[r] && colorTable[r][g] && colorTable[r][g][b]) {
                    shindo = colorTable[r][g][b];
                } 
                // 回退到计算
                else {
                    const p = RGBtoP(r, g, b);
                    const tmpNum = 10 ** (5 * p - 2);
                    shindo = 0.868589 * Math.log(tmpNum) + 1;
                }
                
                // 确保点位信息完整
                if (elm.Location && elm.Location.Latitude && elm.Location.Longitude) {
                    result.push({
                        code: elm.Code,
                        lat: elm.Location.Latitude,
                        lon: elm.Location.Longitude,
                        shindo
                    });
                }
            }
            
            console.log(`Parsed ${result.length} S-net stations`);
            postMessage({ msgId, type, result });
            // 内存释放
            arr = null;
            imagedata = null;
            // 彻底清空 result
            result.length = 0;
            // 彻底清空 points/colorTable
            points = null;
            colorTable = null;
        } else if (type === "tw") {
            let { twStationData, twStationInfo } = e.data;
            const result = [];
            Object.keys(twStationData).forEach(stationId => {
                const data = twStationData[stationId];
                const infoObj = twStationInfo[stationId];
                if (!infoObj || !infoObj.info || !Array.isArray(infoObj.info) || !infoObj.info.length) return;
                const info = infoObj.info[infoObj.info.length - 1];
                const lat = info.lat, lon = info.lon;
                if (typeof lat !== "number" || typeof lon !== "number") return;
                let shindo = typeof data.I === "number" ? data.I : (typeof data.i === "number" ? data.i : null);
                if (shindo === null) return;
                result.push({
                    code: stationId,
                    lat,
                    lon,
                    shindo,
                    pga: data.pga,
                    pgv: data.pgv
                });
            });
            postMessage({ msgId, type, result });
            // 内存释放
            result.length = 0;
            twStationData = null;
            twStationInfo = null;
        } else if (type === "wolfx") {
            let { wolfxStationInfo, wolfxStationData } = e.data;
            const allStationIds = Array.from(new Set([
                ...Object.keys(wolfxStationInfo),
                ...Object.keys(wolfxStationData)
            ]));
            const result = [];
            allStationIds.forEach(stationId => {
                const info = wolfxStationInfo[stationId];
                const data = wolfxStationData[stationId] || {};
                const lat = typeof data.latitude === "number" ? data.latitude : (info && typeof info.latitude === "number" ? info.latitude : null);
                const lon = typeof data.longitude === "number" ? data.longitude : (info && typeof info.longitude === "number" ? info.longitude : null);
                if (typeof lat !== "number" || typeof lon !== "number") return;
                let shindo = typeof data.CalcShindo === "number" ? data.CalcShindo : null;
                result.push({
                    code: stationId,
                    lat,
                    lon,
                    shindo,
                    region: data.region || (info && info.region) || "-",
                    pga: data.PGA,
                    pgv: data.PGV,
                    update_at: data.update_at
                });
            });
            postMessage({ msgId, type, result });
            // 内存释放
            result.length = 0;
            wolfxStationInfo = null;
            wolfxStationData = null;
        }
    } finally {
        // 强制垃圾回收提示（仅部分浏览器支持）
        if (typeof gc === "function") try { gc(); } catch {}
    }
};
