// ================= 行政区震度计算 Worker =================
importScripts("https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js");

// ========== 公式 ==========
const calculateFaultLength = (Mw) => Math.pow(10, 0.5 * Mw - 1.85);
const calculateShortestDistance = (depth, Mw, distance) =>
  Math.max(3, Math.sqrt(distance * distance + depth * depth) - calculateFaultLength(Mw) / 2);
const calculatePGV600 = (Mw, depth, distance) => {
  const term1 = 0.58 * Mw + 0.0038 * depth - 1.29;
  const term2 = Math.log10(distance + 0.0028 * Math.pow(10, 0.5 * Mw));
  const term3 = 0.002 * distance;
  return Math.pow(10, term1 - term2 - term3);
};
const calculatePGV700 = (pgv600) => pgv600 * 0.9;
const calculateSurfacePGV = (pgv700, arv700 = 1.0) => pgv700 * arv700;
const estimateIINSTR = (pgvs) => 2.68 + 1.72 * Math.log10(pgvs);
const fmtShindoToText = (shindo) => {
  shindo = Math.round(shindo * 10) / 10;
  if (shindo < 0.5) return "0";
  if (shindo < 1.5) return "1";
  if (shindo < 2.5) return "2";
  if (shindo < 3.5) return "3";
  if (shindo < 4.5) return "4";
  if (shindo < 5.0) return "5-";
  if (shindo < 5.5) return "5+";
  if (shindo < 6.0) return "6-";
  if (shindo < 6.5) return "6+";
  return "7";
};
const convertMjmaToMw = (Mjma) => Mjma - 0.171;

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

// ========== 有效计算半径 ==========
function getEffectiveRadius(Mjma) {
  if (Mjma <= 4.5) return 150;
  if (Mjma <= 5.0) return 200;
  if (Mjma <= 6.0) return 400;
  if (Mjma <= 7.0) return 700;
  return 1000; // M8+
}

// ========== 小型 LRU 缓存 ==========
const PT_CACHE = new Map();
const PT_CACHE_MAX = 5000;
function cacheGetSet(key, calcFn) {
  if (PT_CACHE.has(key)) {
    const v = PT_CACHE.get(key);
    PT_CACHE.delete(key);
    PT_CACHE.set(key, v);
    return v;
  }
  const v = calcFn();
  PT_CACHE.set(key, v);
  if (PT_CACHE.size > PT_CACHE_MAX) {
    const firstKey = PT_CACHE.keys().next().value;
    PT_CACHE.delete(firstKey);
  }
  return v;
}

// ========== 单点震度 ==========
function calcShindoAtPoint(lat, lon, Mjma, depth, epicenterLat, epicenterLon) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)},${Mjma},${depth},${epicenterLat.toFixed(5)},${epicenterLon.toFixed(5)}`;
  return cacheGetSet(key, () => {
    const Mw = convertMjmaToMw(Mjma);
    const distance = turf.distance([epicenterLon, epicenterLat], [lon, lat], { units: "kilometers" });
    const x = calculateShortestDistance(depth, Mw, distance);
    const pgv600 = calculatePGV600(Mw, depth, x);
    const pgv700 = calculatePGV700(pgv600);
    let pgvs = calculateSurfacePGV(pgv700, 1.0);

    if (depth >= 60 && depth <= 100) pgvs *= 0.8;
    else if (depth > 100 && depth <= 150) pgvs *= 0.6;

    const computeMagnitudeGain = (Mjma) => {
      if (Mjma <= 5.5) return 1.0;
      if (Mjma >= 8.0) return 1.5;
      return 1.0 + 0.2 * (Mjma - 5.5);
    };
    pgvs *= computeMagnitudeGain(Mjma);

    if (pgvs <= 0) return "0";
    return fmtShindoToText(estimateIINSTR(pgvs));
  });
}

// ========== 辅助 ==========
function bboxInfo(feature) {
  const bbox = turf.bbox(feature);
  const [minX, minY, maxX, maxY] = bbox;
  const center = [(minX + maxX) / 2, (minY + maxY) / 2];
  const diag = turf.distance([minX, minY], [maxX, maxY], { units: "kilometers" });
  return { bbox, center, halfDiagKm: diag / 2 };
}

function minLooseDistanceToFeature(epiLon, epiLat, feature) {
  const { center, halfDiagKm } = bboxInfo(feature);
  const d = turf.distance([epiLon, epiLat], center, { units: "kilometers" });
  return Math.max(0, d - halfDiagKm);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function sampleBoundaryPoints(feature, stepKm) {
  const points = [];
  try {
    const line = turf.polygonToLine(feature);
    const length = turf.length(line, { units: "kilometers" });
    const n = Math.max(1, Math.floor(length / stepKm));
    for (let i = 0; i <= n; i++) {
      const pt = turf.along(line, (length * i) / n, { units: "kilometers" });
      if (pt && pt.geometry) points.push(pt.geometry.coordinates);
    }
  } catch (e) {}
  return points;
}

// ========== 行政区最大震度 ==========
function calcFeatureMaxShindo(feature, params) {
  const { Mjma, depth, epicenterLat, epicenterLon, baseStepKm = 10 } = params;
  const R = getEffectiveRadius(Mjma);
  let maxShindo = "0";
  const epiLon = epicenterLon, epiLat = epicenterLat;

  const dLoose = minLooseDistanceToFeature(epiLon, epiLat, feature);
  if (dLoose > R * 1.8) return "0";

  const centroid = turf.centroid(feature).geometry.coordinates;
  const centroidShindo = calcShindoAtPoint(centroid[1], centroid[0], Mjma, depth, epiLat, epiLon);
  maxShindo = centroidShindo;

  const distC = turf.distance([epiLon, epiLat], centroid, { units: "kilometers" });
  if (distC > R * 0.75) {
    return maxShindo;
  }

  const boundaryStep = clamp(baseStepKm * (0.6 + distC / R), Math.max(2, baseStepKm * 0.5), baseStepKm * 2.5);
  const boundaryPts = sampleBoundaryPoints(feature, boundaryStep);
  for (const [lon, lat] of boundaryPts) {
    const s = calcShindoAtPoint(lat, lon, Mjma, depth, epiLat, epiLon);
    if (parseShindoToNumber(s) > parseShindoToNumber(maxShindo)) maxShindo = s;
  }

  // —— 内部网格（更密，但有限制）——
  try {
    const { bbox } = bboxInfo(feature);
    const areaKm2 = Math.max(1, turf.area(feature) / 1e6);

    // 基准 5km 起，远区稍放大
    const step = clamp(baseStepKm * 0.5 * (0.6 + distC / R), 2, 15);

    const grid = turf.pointGrid(bbox, step, { units: "kilometers" });
    const pointsInside = turf.pointsWithinPolygon(grid, feature);
    const feats = pointsInside.features;

    // 上限点数 200~800
    const maxSamples = Math.min(800, Math.max(500, Math.floor(areaKm2 / (step * step)) * 4));

    // 远区抽稀
    const keepRatio = clamp(1.5 - distC / R, 0.3, 1.0);
    const targetSamples = Math.floor(maxSamples * keepRatio);

    const stride = Math.max(1, Math.floor(feats.length / targetSamples));
    for (let i = 0; i < feats.length; i += stride) {
      const [lon, lat] = feats[i].geometry.coordinates;
      const s = calcShindoAtPoint(lat, lon, Mjma, depth, epiLat, epiLon);
      if (parseShindoToNumber(s) > parseShindoToNumber(maxShindo)) maxShindo = s;
    }
  } catch (e) {}

  return maxShindo;
}

// ========== 结果去重缓存 ==========
let lastParamsHash = null;
let lastResults = null;

function featureSignature(f) {
  const fid = f.properties?.name ?? "";
  const bb = turf.bbox(f);
  return `${fid}|${bb.map(n => n.toFixed(4)).join(",")}`;
}

function generateParamsHash(features, params) {
  return JSON.stringify({
    params: {
      Mjma: params.Mjma,
      depth: params.depth,
      epicenterLat: +params.epicenterLat?.toFixed?.(4) ?? params.epicenterLat,
      epicenterLon: +params.epicenterLon?.toFixed?.(4) ?? params.epicenterLon,
      baseStepKm: params.baseStepKm
    },
  }) + "|" + features.map(featureSignature).join("#");
}

// ========== Worker 主入口 ==========
self.onmessage = function (e) {
  const { cmd, features, params } = e.data;
  if (cmd === "calc") {
    const currentHash = generateParamsHash(features, params);

    if (lastParamsHash === currentHash && lastResults) {
      self.postMessage({ results: lastResults });
      return;
    }
    lastParamsHash = currentHash;

    const results = features.map((f, idx) => {
      const fid = f.properties?.name ?? String(idx); // ✅ 固定 fid = name
      const maxShindo = calcFeatureMaxShindo(f, params);
      return { fid, maxShindo };
    });

    lastResults = results;
    self.postMessage({ results });
  }
};
