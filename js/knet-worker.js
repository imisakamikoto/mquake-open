// K-NET Worker线程：解析像素并返回测站烈度
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
    let arr, stations, colorTable;
    try {
        const { msgId, imagedata } = e.data;
        stations = e.data.stations;
        colorTable = e.data.colorTable;
        arr = new Uint8ClampedArray(imagedata);
        const result = [];
        for (let i = 0; i < stations.length; i++) {
            const elm = stations[i];
            const x = elm.Point.X;
            const y = elm.Point.Y;
            if (x < 0 || y < 0 || x >= 352 || y >= 400) continue;
            const idx = y * 352 + x;
            const r = arr[4 * idx];
            const g = arr[4 * idx + 1];
            const b = arr[4 * idx + 2];
            const a = arr[4 * idx + 3];
            if (a === 0) continue;
            let shindo = colorTable?.[r]?.[g]?.[b] ?? null;
            if (!shindo) {
                const tmpNum = 10 ** (5 * RGBtoP(r, g, b) - 2);
                shindo = 0.868589 * Math.log(tmpNum) + 1;
            }
            result.push({
                code: elm.Code,
                lat: elm.Location?.Latitude,
                lon: elm.Location?.Longitude,
                shindo
            });
        }
        postMessage({ msgId, stations: result });

        // 内存释放
        arr = null;
        imagedata = null;
        result.length = 0;
        stations = null;
        colorTable = null;
    } finally {
        if (typeof gc === "function") try { gc(); } catch {}
    }
};
