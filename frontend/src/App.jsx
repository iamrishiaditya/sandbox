import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";

const API = "http://127.0.0.1:8000";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function SectionTitle({ index, title, right }) {
  return (
    <div className="section-title">
      <span className="section-index">{index}</span>
      <span>{title}</span>
      {right && <span className="section-right">{right}</span>}
    </div>
  );
}

function Dock({ id, title, subtitle, icon, panel, setPanel, z, bringToFront, children, className = "", minWidth = 250, minHeight = 130 }) {
  const drag = useRef(null);
  const resize = useRef(null);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    bringToFront(id);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      x: panel.x,
      y: panel.y,
      pointerId: e.pointerId
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    setPanel(id, {
      ...panel,
      x: clamp(drag.current.x + dx, 10, window.innerWidth - panel.width - 10),
      y: clamp(drag.current.y + dy, 58, window.innerHeight - panel.height - 48),
      docked: null
    });
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    window.dispatchEvent(new CustomEvent("lmb-dock-snap", { detail: { id, mode: "move" } }));
  };

  const onResizePointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    bringToFront(id);
    resize.current = {
      startX: e.clientX,
      startY: e.clientY,
      width: panel.width,
      height: panel.height,
      pointerId: e.pointerId
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onResizePointerMove = (e) => {
    if (!resize.current) return;
    const width = clamp(resize.current.width + (e.clientX - resize.current.startX), minWidth, Math.max(minWidth, window.innerWidth - panel.x - 12));
    const height = clamp(resize.current.height + (e.clientY - resize.current.startY), minHeight, Math.max(minHeight, window.innerHeight - panel.y - 42));
    setPanel(id, { ...panel, width, height, docked: null });
  };

  const onResizePointerUp = () => {
    if (!resize.current) return;
    resize.current = null;
    window.dispatchEvent(new CustomEvent("lmb-dock-snap", { detail: { id, mode: "resize" } }));
  };

  return (
    <section
      className={`dock ${className}`}
      style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height, zIndex: z }}
      onMouseDown={() => bringToFront(id)}
    >
      <div
        className="dock-header"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Drag window. Double-click to return to dock position."
      >
        <div className="dock-title-wrap">
          <span className="dock-icon">{icon}</span>
          <div>
            <div className="dock-title">{title}</div>
            {subtitle && <div className="dock-subtitle">{subtitle}</div>}
          </div>
        </div>
        <div className="dock-window-actions">
          <button type="button" title="Bring forward" onPointerDown={(e) => e.stopPropagation()} onClick={() => bringToFront(id)}>●</button>
          <button type="button" title="Close panel" onPointerDown={(e) => e.stopPropagation()} onClick={() => setPanel(id, { ...panel, hidden: true })}>×</button>
        </div>
      </div>
      <div className="dock-body">{children}</div>
      <div
        className="resize-grip"
        title="Drag to resize"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
    </section>
  );
}

function App() {
  const globeRef = useRef(null);
  const workspaceRef = useRef(null);
  const [lat, setLat] = useState(-89.5);
  const [lon, setLon] = useState(0);
  const [date, setDate] = useState("2026-11-14T09:00");
  const [data, setData] = useState(null);
  const [missionStats, setMissionStats] = useState(null);
  const [savedSites, setSavedSites] = useState([]);
  const [horizon, setHorizon] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [health, setHealth] = useState("CHECKING");
  const [activeTab, setActiveTab] = useState("MISSION");
  const [layers, setLayers] = useState({ lasers: true, sites: true, terrain: true });
  const [resolution, setResolution] = useState(10);
  const [days, setDays] = useState(14);
  const [toast, setToast] = useState("");
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: Math.max(400, window.innerHeight - 88) });
  const [panelOrder, setPanelOrder] = useState(["planner", "inspector", "observation", "timeline", "tools"]);
  const [panels, setPanels] = useState({
    planner: { x: 22, y: 78, width: 350, height: 520, hidden: false, docked: "left" },
    inspector: { x: 1140, y: 78, width: 390, height: 520, hidden: false, docked: "right" },
    observation: { x: 1080, y: 615, width: 430, height: 245, hidden: false, docked: "bottom-right" },
    timeline: { x: 370, y: 700, width: 650, height: 160, hidden: false, docked: "bottom" },
    tools: { x: 380, y: 92, width: 270, height: 210, hidden: false, docked: "top-left" }
  });

  const setPanel = useCallback((id, next) => {
    setPanels((prev) => ({ ...prev, [id]: next }));
  }, []);

  const bringToFront = useCallback((id) => {
    setPanelOrder((prev) => [...prev.filter((x) => x !== id), id]);
  }, []);

  const toastTimer = useRef(null);
  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast("");
      toastTimer.current = null;
    }, 2800);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    const snap = (event) => {
      const id = event.detail?.id;
      if (!id) return;
      const p = panels[id];
      if (!p) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const snapDistance = 14;
      let next = { ...p };
      let snapped = false;

      if (Math.abs(p.x - 18) <= snapDistance) { next.x = 18; next.docked = "left"; snapped = true; }
      if (Math.abs(w - p.x - p.width - 18) <= snapDistance) { next.x = w - p.width - 18; next.docked = "right"; snapped = true; }
      if (Math.abs(p.y - 78) <= snapDistance) { next.y = 78; next.docked = "top"; snapped = true; }
      if (Math.abs(h - p.y - p.height - 56) <= snapDistance) { next.y = h - p.height - 56; next.docked = "bottom"; snapped = true; }

      Object.entries(panels).forEach(([otherId, other]) => {
        if (otherId === id || other.hidden) return;
        const right = p.x + p.width;
        const bottom = p.y + p.height;
        const otherRight = other.x + other.width;
        const otherBottom = other.y + other.height;

        if (Math.abs(right - other.x) <= snapDistance && Math.abs(p.y - other.y) < Math.max(p.height, other.height)) {
          next.x = other.x - p.width; next.docked = `to-${otherId}-left`; snapped = true;
        } else if (Math.abs(p.x - otherRight) <= snapDistance && Math.abs(p.y - other.y) < Math.max(p.height, other.height)) {
          next.x = otherRight; next.docked = `to-${otherId}-right`; snapped = true;
        } else if (Math.abs(bottom - other.y) <= snapDistance && Math.abs(p.x - other.x) < Math.max(p.width, other.width)) {
          next.y = other.y - p.height; next.docked = `to-${otherId}-top`; snapped = true;
        } else if (Math.abs(p.y - otherBottom) <= snapDistance && Math.abs(p.x - other.x) < Math.max(p.width, other.width)) {
          next.y = otherBottom; next.docked = `to-${otherId}-bottom`; snapped = true;
        }
      });

      if (snapped) setPanel(id, next);
    };
    window.addEventListener("lmb-dock-snap", snap);
    return () => window.removeEventListener("lmb-dock-snap", snap);
  }, [panels, setPanel]);

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: Math.max(400, window.innerHeight - 88) });
    const observer = new ResizeObserver(updateViewport);
    if (workspaceRef.current) observer.observe(workspaceRef.current);
    window.addEventListener("resize", updateViewport);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadInitialObservation = async () => {
      try {
        const response = await fetch(`${API}/api/visibility?lat=${-89.5}&lon=${0}&date=${encodeURIComponent("2026-11-14T09:00:00")}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (active) setData(result);
      } catch {
        if (active) setData({ error: "Initial visibility request failed." });
      }
    };
    loadInitialObservation();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch(`${API}/api/health`)
      .then((r) => r.json())
      .then(() => mounted && setHealth("ONLINE"))
      .catch(() => mounted && setHealth("OFFLINE"));
    return () => { mounted = false; };
  }, []);

  const checkVisibility = useCallback(async (targetLat, targetLon, targetDate) => {
    setLoading(true);
    try {
      const response = await fetch(`${API}/api/visibility?lat=${targetLat}&lon=${targetLon}&date=${encodeURIComponent(`${targetDate}:00`)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setData(result);
      setLat(Number(targetLat));
      setLon(Number(targetLon));
      setMissionStats(null);
      showToast("Site geometry updated");
    } catch (error) {
      setData({ error: error.message });
      showToast("Visibility engine unavailable");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const selectLocation = useCallback((targetLat, targetLon) => {
    const a = Number(targetLat).toFixed(4);
    const b = Number(targetLon).toFixed(4);
    checkVisibility(a, b, date);
    globeRef.current?.pointOfView({ lat: Number(a), lng: Number(b), altitude: 2.25 }, 850);
  }, [checkVisibility, date]);

  const handleGlobeClick = (event) => {
    selectLocation(event.lat, event.lng);
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const response = await fetch(`${API}/api/mission-analysis?lat=${lat}&lon=${lon}&start_date=${encodeURIComponent(date)}&days=${days}&step_minutes=${resolution}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setMissionStats(result);
      setActiveTab("MISSION");
      showToast("Mission forecast complete");
    } catch (error) {
      setMissionStats({ error: error.message });
      showToast("Mission analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const response = await fetch(`${API}/api/scan-region?center_lat=${lat}&center_lon=${lon}&start_date=${encodeURIComponent(date)}&days=${days}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setSavedSites(result.recommended_sites || []);
      setActiveTab("COMPARE");
      showToast(`${result.recommended_sites?.length || 0} candidate sites ranked`);
    } catch {
      showToast("Regional scan failed");
    } finally {
      setScanning(false);
    }
  };

  const loadHorizon = async () => {
    try {
      const response = await fetch(`${API}/api/horizon-profile?lat=${lat}&lon=${lon}`);
      if (!response.ok) throw new Error();
      setHorizon(await response.json());
      setActiveTab("TERRAIN");
      showToast("Horizon profile loaded");
    } catch {
      showToast("Terrain profile unavailable");
    }
  };

  const handleTimeChange = (e) => {
    const next = e.target.value;
    setDate(next);
    if (data) checkVisibility(lat, lon, next);
  };

  const buildLasers = useMemo(() => {
    if (!data || data.error || !layers.lasers) return [];
    const make = (azimuth, elevation, status, type) => {
      const startLat = Number(lat);
      const startLon = Number(lon);
      const rad = Math.PI / 180;
      const az = Number(azimuth || 0) * rad;
      const elev = Number(elevation || 0);
      let length = status === "BLOCKED_BY_TERRAIN" ? 2.2 : elev < 0 ? 5 : 18;
      const cosLat = Math.max(0.12, Math.abs(Math.cos(startLat * rad)));
      const endLat = clamp(startLat + Math.cos(az) * length, -89.9, 89.9);
      const endLon = startLon + (Math.sin(az) * length / cosLat);
      const color = status === "BLOCKED_BY_TERRAIN" || elev < -0.2 ? "#f06b6b" : type === "sun" ? "#e8b94b" : "#5ec7dc";
      const endAlt = elev > 0 ? clamp(0.55 + elev / 25, 0.55, 1.35) : 0.18;
      return { coords: [[startLat, startLon, 0.025], [endLat, endLon, endAlt]], color, altitude: endAlt };
    };
    return [
      make(data.sun?.azimuth_deg, data.sun?.elevation_deg, data.sun?.status, "sun"),
      make(data.earth?.azimuth_deg, data.earth?.elevation_deg, data.earth?.status, "earth")
    ];
  }, [data, lat, lon, layers.lasers]);

  const buildArcs = useMemo(() => {
    if (!data || data.error || !layers.lasers) return [];
    return buildLasers.map((beam) => {
      const [start, end] = beam.coords;
      return { startLat: start[0], startLng: start[1], endLat: end[0], endLng: end[1], color: beam.color, altitude: beam.altitude };
    });
  }, [buildLasers, data, layers.lasers]);

  const status = (value) => {
    if (!value) return "WAITING";
    return String(value).replaceAll("_", " ");
  };

  // The API returns `sun.status` / `earth.status` and boolean `visible`.
  // Do not invent power_status/comm_status values here: those were from an older API contract.
  const sunStatus = data?.sun?.status || null;
  const earthStatus = data?.earth?.status || null;
  const sunGood = data?.sun?.visible === true;
  const earthGood = data?.earth?.visible === true;
  const hasObservation = Boolean(data && !data.error && data.sun && data.earth);

  const forecastReadiness = missionStats && !missionStats.error
    ? Math.round(
        num(missionStats.solar_access_percent) * 0.4 +
        num(missionStats.communication_access_percent) * 0.3 +
        Math.max(0, 100 - num(missionStats.max_solar_outage_hours) * 4) * 0.15 +
        Math.max(0, 100 - num(missionStats.max_comm_outage_hours) * 4) * 0.15
      )
    : null;
  // Mission readiness is a forecast score only after the user runs the mission model.
  // Live geometry remains visible separately and is never presented as a fabricated readiness score.
  const readiness = forecastReadiness;

  const selectedLabel = `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? "S" : "N"} · ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? "W" : "E"}`;

  const orderedPanels = panelOrder.map((id) => ({ id, ...panels[id] })).filter((p) => !p.hidden);
  const zMap = Object.fromEntries(orderedPanels.map((p, i) => [p.id, 30 + i]));

  const renderInspector = () => {
    if (activeTab === "COMPARE") {
      return (
        <div className="inspector-scroll">
          <SectionTitle index="01" title="CANDIDATE RANKING" right={`${savedSites.length} SITES`} />
          {savedSites.length ? savedSites.map((site, i) => (
            <button className="candidate-row" key={`${site.latitude_deg}-${site.longitude_deg}-${i}`} type="button" onClick={() => selectLocation(site.latitude_deg, site.longitude_deg)}>
              <span className="rank">{String(i + 1).padStart(2, "0")}</span>
              <span className="candidate-main"><b>{Number(site.score || 0).toFixed(1)}</b><small>{Number(site.latitude_deg).toFixed(3)}°, {Number(site.longitude_deg).toFixed(3)}°</small></span>
              <span className="candidate-chevron">›</span>
            </button>
          )) : <div className="empty-state">Run AUTO-SCAN AREA to rank candidate landing locations.</div>}
        </div>
      );
    }
    if (activeTab === "TERRAIN") {
      return (
        <div className="inspector-scroll">
          <SectionTitle index="01" title="TERRAIN PROFILE" right="360°" />
          <button className="secondary-btn" type="button" onClick={loadHorizon} disabled={loading} style={{marginBottom:10}}>{horizon?.profile?.length ? "↻ REFRESH TERRAIN PROFILE" : "LOAD TERRAIN PROFILE"}</button>
          {horizon?.profile?.length ? (
            <div className="horizon-wrap">
              <div className="horizon-meta"><span>0° NORTH</span><span>90° E</span><span>180° S</span><span>270° W</span><span>360°</span></div>
              <svg className="horizon-svg" viewBox="0 0 720 210" preserveAspectRatio="none" aria-label="360 degree lunar terrain horizon profile">
                <line x1="0" y1="180" x2="720" y2="180" className="horizon-axis" />
                <line x1="0" y1="135" x2="720" y2="135" className="horizon-grid" />
                <line x1="0" y1="90" x2="720" y2="90" className="horizon-grid" />
                <line x1="0" y1="45" x2="720" y2="45" className="horizon-grid" />
                <polyline points={horizon.profile.map((p, i) => { const x=(i/Math.max(1,horizon.profile.length-1))*720; const e=num(p.horizon_elevation_deg); const y=180-clamp((e+5)*9,0,135); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ')} className="horizon-line" />
                <polyline points={horizon.profile.map((p, i) => { const x=(i/Math.max(1,horizon.profile.length-1))*720; const e=num(p.horizon_elevation_deg); const y=180-clamp((e+5)*9,0,135); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ') + ' 720,180 0,180'} className="horizon-fill" />
              </svg>
              <div className="horizon-scale"><span>+10°</span><span>0° horizon</span><span>-5°</span></div>
            </div>
          ) : <div className="empty-state">No horizon profile loaded.<br /><small>Calculate the 360° terrain horizon around the selected site.</small><button className="secondary-btn" type="button" onClick={loadHorizon}>LOAD TERRAIN PROFILE</button></div>}
          <div className="metric-grid">
            <Metric label="SITE ELEVATION" value={`${num(data?.terrain_elevation_m).toFixed(1)} m`} />
            <Metric label="FRAME" value="IAU_MOON" />
            <Metric label="TERRAIN" value="LOLA 4 PPD" />
            <Metric label="PROFILE" value="LOCAL HORIZON" />
          </div>
        </div>
      );
    }
    if (activeTab === "DATA") {
      return (
        <div className="inspector-scroll">
          <SectionTitle index="01" title="DATA & METHOD" />
          <div className="data-card"><b>NASA NAIF SPICE</b><span>DE432S · lunar orientation · PCK · LSK</span></div>
          <div className="data-card"><b>LRO LOLA</b><span>4 pixels/degree terrain model</span></div>
          <div className="data-card"><b>VISIBILITY MODEL</b><span>Sun/Earth geometry + terrain line-of-sight + lunar curvature</span></div>
          <div className="data-card"><b>TIME STANDARD</b><span>UTC / SPICE ephemeris time conversion</span></div>
          <SectionTitle index="02" title="LIMITATIONS" />
          <div className="notice">The terrain dataset is a global 4-ppd model. High-resolution polar-stereographic terrain can be substituted without changing the analysis architecture.</div>
        </div>
      );
    }
    return (
      <div className="inspector-scroll">
        <SectionTitle index="01" title="MISSION READINESS" right={readiness == null ? "NO RUN" : `${readiness}/100`} />
        <div className="readiness-box">
          <div className="readiness-score">{readiness == null ? "—" : readiness}</div>
          <div>
            <strong>{readiness == null ? "RUN MISSION ANALYSIS" : readiness >= 80 ? "HIGH READINESS" : readiness >= 60 ? "CONDITIONAL" : "REVIEW SITE"}</strong>
            <small>{readiness == null ? "No forecast score has been calculated yet." : "Mission decision-support indicator."}</small>
          </div>
        </div>
        <SectionTitle index="02" title="LIVE GEOMETRY" />
        <div className="metric-grid">
          <Metric label="SUN AZIMUTH" value={`${num(data?.sun?.azimuth_deg).toFixed(1)}°`} />
          <Metric label="SUN ELEVATION" value={`${num(data?.sun?.elevation_deg).toFixed(2)}°`} />
          <Metric label="EARTH AZIMUTH" value={`${num(data?.earth?.azimuth_deg).toFixed(1)}°`} />
          <Metric label="EARTH ELEVATION" value={`${num(data?.earth?.elevation_deg).toFixed(2)}°`} />
        </div>
        <SectionTitle index="03" title="ACCESS" />
        <StatusLine label="SOLAR ACCESS" value={status(sunStatus)} good={sunGood} />
        <StatusLine label="DIRECT-TO-EARTH" value={status(earthStatus)} good={earthGood} />
        <StatusLine label="TERRAIN" value={data?.sun?.terrain?.blocked || data?.earth?.terrain?.blocked ? "POTENTIAL BLOCKAGE" : "CLEAR"} good={!data?.sun?.terrain?.blocked && !data?.earth?.terrain?.blocked} />
      </div>
    );
  };

  return (
    <>
      <style>{`
        :root{
          --chrome:#363b40; --chrome2:#42484e; --panel:rgba(57,63,68,.94); --panel2:rgba(69,75,81,.94);
          --line:#667078; --line2:#7b858d; --text:#ffffff; --muted:#d2d7da; --dim:#aeb6bb;
          --gold:#e8b94b; --cyan:#5ec7dc; --green:#64c98b; --red:#f06b6b; --canvas:#070c13;
        }
        *{box-sizing:border-box}
        html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#202428;color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
        button,input,select{font:inherit}
        button{color:inherit}
        .app{position:relative;width:100vw;height:100vh;overflow:hidden;background:#0b1017;letter-spacing:.01em}
        .canvas{position:absolute;inset:0;background:var(--canvas);z-index:1}
        .canvas .scene{position:absolute;inset:0}
        .topbar{position:absolute;top:0;left:0;right:0;height:58px;background:rgba(53,58,63,.97);border-bottom:1px solid #707980;z-index:200;display:flex;align-items:center;padding:0 16px;box-shadow:0 4px 20px rgba(0,0,0,.28)}
        .brand{display:flex;align-items:center;gap:12px;min-width:300px}.brand-mark{width:34px;height:34px;border:1px solid #9ba3a9;border-radius:6px;display:grid;place-items:center;color:var(--gold);font-size:18px}.brand h1{font-size:15px;letter-spacing:.13em;margin:0;font-weight:750}.brand small{display:block;color:#fff;font-size:9px;letter-spacing:.14em;margin-top:3px}
        .tabs{display:flex;height:100%;align-items:center;gap:2px}.tab{height:100%;padding:0 18px;border:0;background:transparent;color:#fff;font-size:11px;letter-spacing:.1em;cursor:pointer;border-bottom:3px solid transparent}.tab.active{border-bottom-color:var(--gold);background:rgba(255,255,255,.055)}
        .top-status{margin-left:auto;display:flex;align-items:center;gap:8px;color:#fff;font-size:10px;letter-spacing:.1em}.top-layer{height:28px;padding:0 9px;border:1px solid #7b858d;background:#343a3f;color:#fff;border-radius:4px;font-size:9px;font-weight:800;cursor:pointer}.top-layer.active{border-color:var(--gold);color:#fff;background:#4a5055}.online{border:1px solid #708078;border-radius:5px;padding:9px 12px}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:7px;box-shadow:0 0 9px var(--green)}
        .workspace{position:absolute;left:0;right:0;top:58px;bottom:30px;overflow:hidden;z-index:2}
        .hud{position:absolute;z-index:12;left:22px;top:18px;background:rgba(44,49,54,.82);border:1px solid #788188;border-radius:6px;padding:11px 14px;backdrop-filter:blur(10px);font-size:11px}.hud b{font-size:12px}.hud span{color:#fff}.hud .live{color:var(--green);margin-right:10px}
        .axis{position:absolute;right:26px;top:20px;width:108px;height:108px;z-index:12;background:rgba(43,48,53,.82);border:1px solid #788188;border-radius:7px;backdrop-filter:blur(8px)}.axis .origin{position:absolute;left:48px;top:50px;width:9px;height:9px;border-radius:50%;background:#fff}.axis .x,.axis .y,.axis .z{position:absolute;transform-origin:left center;height:2px;width:42px}.axis .x{left:53px;top:54px;background:#df6666;transform:rotate(0)}.axis .y{left:53px;top:54px;background:#6bc78b;transform:rotate(135deg)}.axis .z{left:53px;top:54px;background:#65a9df;transform:rotate(-90deg)}.axis label{position:absolute;font-size:10px;font-weight:800}.axis .xl{right:5px;top:48px;color:#df6666}.axis .yl{left:8px;bottom:7px;color:#6bc78b}.axis .zl{left:47px;top:7px;color:#65a9df}.axis .axis-title{position:absolute;left:10px;bottom:7px;color:#fff;font-size:8px;letter-spacing:.12em}
        .dock{position:absolute;background:var(--panel);border:1px solid #7b858d;border-radius:8px;box-shadow:0 16px 42px rgba(0,0,0,.42);overflow:hidden;min-width:250px;min-height:130px;backdrop-filter:blur(14px)}.dock-header{height:55px;background:linear-gradient(#4a5056,#3e4449);border-bottom:1px solid #7a8389;display:flex;align-items:center;justify-content:space-between;padding:0 12px;cursor:grab;user-select:none}.dock-header:active{cursor:grabbing}.dock-title-wrap{display:flex;align-items:center;gap:10px}.dock-icon{width:30px;height:30px;border:1px solid #879097;border-radius:5px;display:grid;place-items:center;color:var(--gold);font-size:14px}.dock-title{font-weight:750;font-size:12px;letter-spacing:.1em;color:#fff}.dock-subtitle{font-size:9px;color:#fff;margin-top:3px}.dock-window-actions{display:flex;gap:5px}.dock-window-actions button{width:24px;height:24px;border:1px solid #879097;background:#343a3f;border-radius:4px;cursor:pointer;color:#fff}.dock-window-actions button:hover{background:#596168}.dock-body{height:calc(100% - 55px);overflow:auto;padding:16px}.resize-grip{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 45%,#9aa3a9 46%,#9aa3a9 54%,transparent 55%),linear-gradient(135deg,transparent 60%,#9aa3a9 61%,#9aa3a9 69%,transparent 70%)}
        .section-title{display:flex;align-items:center;gap:9px;color:#fff;font-weight:800;font-size:11px;letter-spacing:.11em;margin:2px 0 14px;padding-bottom:9px;border-bottom:1px solid #697279}.section-index{color:var(--gold);font-size:9px}.section-right{margin-left:auto;color:#fff;font-size:9px}
        .field-label{display:block;color:#fff;font-size:9px;letter-spacing:.1em;margin:0 0 6px;font-weight:700}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field{margin-bottom:13px}.input,.select{width:100%;height:39px;border:1px solid #899198;background:#30363b;color:#fff;border-radius:5px;padding:0 11px;outline:none}.input:focus,.select:focus{border-color:var(--gold);box-shadow:0 0 0 2px rgba(232,185,75,.15)}
        .primary-btn,.secondary-btn{width:100%;min-height:42px;border-radius:5px;border:1px solid #a4acb1;cursor:pointer;font-weight:800;font-size:11px;letter-spacing:.07em}.primary-btn{background:#e3e6e8;color:#222}.primary-btn:hover{background:#fff}.secondary-btn{background:#4b5258;color:#fff}.secondary-btn:hover{background:#5b636a}.button-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .tool-stack{display:grid;gap:7px}.tool-btn{width:100%;min-height:49px;border:1px solid #7e878e;background:#4a5157;border-radius:5px;text-align:left;padding:8px 11px;display:flex;gap:10px;align-items:center;cursor:pointer}.tool-btn:hover{background:#5a6269}.tool-btn strong{display:block;font-size:11px;color:#fff}.tool-btn small{display:block;font-size:9px;color:#fff;margin-top:3px}.tool-btn .tool-icon{font-size:16px;width:22px}
        .readiness-box{display:flex;align-items:center;gap:14px;border:1px solid #7c858c;background:#30363b;border-radius:6px;padding:13px;margin-bottom:18px}.readiness-score{font-size:38px;font-weight:800;color:#fff;line-height:1}.readiness-box strong{display:block;font-size:12px;color:#fff}.readiness-box small{display:block;color:#fff;font-size:9px;margin-top:5px}.metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:17px}.metric{border:1px solid #737c83;background:#343a3f;border-radius:5px;padding:10px}.metric small{display:block;color:#fff;font-size:8px;letter-spacing:.08em}.metric b{display:block;color:#fff;font-size:15px;margin-top:5px}.status-line{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #697279;font-size:10px}.status-line span:first-child{color:#fff}.status-line b{color:#fff;font-size:9px;letter-spacing:.05em}.status-good{color:var(--green)!important}.status-bad{color:var(--red)!important}
        .bottom-telemetry{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:min(860px,calc(100vw - 48px));height:84px;z-index:20;background:rgba(55,61,66,.96);border:1px solid #7b858d;border-radius:7px;display:grid;grid-template-columns:1.1fr 1fr 1fr 1fr;box-shadow:0 12px 30px rgba(0,0,0,.35);overflow:hidden}.telemetry-cell{padding:11px 16px;border-right:1px solid #697279;display:flex;align-items:center;gap:11px}.telemetry-cell:last-child{border-right:0}.telemetry-icon{width:35px;height:35px;border:1px solid #7d878d;border-radius:5px;display:grid;place-items:center}.telemetry-label{font-size:8px;color:#fff;letter-spacing:.1em;font-weight:700}.telemetry-value{font-size:13px;font-weight:800;color:#fff;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.telemetry-sub{font-size:8px;color:#fff;margin-top:3px}
        .observation{height:100%;display:grid;grid-template-rows:auto 1fr}.obs-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;overflow:auto}.obs-card{border:1px solid #717b82;background:#33393e;border-radius:5px;padding:10px}.obs-card h4{margin:0 0 8px;font-size:10px;color:#fff;letter-spacing:.08em}.obs-row{display:flex;justify-content:space-between;font-size:9px;padding:4px 0;border-bottom:1px solid #5e676e}.obs-row:last-child{border-bottom:0}.obs-row span{color:#fff}.obs-row b{color:#fff}
        .timeline{height:100%;display:grid;grid-template-rows:auto 1fr}.timeline-row{display:grid;grid-template-columns:100px 1fr 70px;align-items:center;gap:10px;margin:8px 0}.timeline-label{font-size:9px;font-weight:800;color:#fff}.timeline-bar{height:16px;background:#252b30;border:1px solid #677179;border-radius:3px;display:flex;overflow:hidden}.segment{height:100%;flex:1}.available{background:#65b883}.blocked{background:#b45c5c}.timeline-value{font-size:10px;text-align:right;color:#fff}
        .candidate-row{width:100%;display:flex;align-items:center;gap:11px;border:1px solid #717a81;background:#353b40;border-radius:5px;padding:10px;margin-bottom:7px;cursor:pointer;text-align:left}.candidate-row:hover{background:#4a5157}.rank{font-size:17px;font-weight:800;color:var(--gold);width:28px}.candidate-main{display:flex;flex-direction:column;gap:3px}.candidate-main b{font-size:14px;color:#fff}.candidate-main small{font-size:9px;color:#fff}.candidate-chevron{margin-left:auto;font-size:20px;color:#fff}.empty-state{border:1px dashed #737d84;padding:20px;text-align:center;color:#fff;font-size:11px;line-height:1.6}.empty-state .secondary-btn{margin-top:12px}.data-card,.notice{border:1px solid #707a81;background:#353b40;border-radius:5px;padding:11px;margin-bottom:8px}.data-card b{display:block;font-size:10px;color:#fff}.data-card span,.notice{display:block;font-size:9px;color:#fff;line-height:1.5;margin-top:4px}.horizon-wrap{border:1px solid #707a81;background:#292f34;border-radius:5px;margin-bottom:12px;padding:10px}.horizon-meta{display:flex;justify-content:space-between;color:#fff;font-size:8px;letter-spacing:.06em;margin-bottom:6px}.horizon-svg{display:block;width:100%;height:170px;overflow:visible}.horizon-axis{stroke:#9aa3a9;stroke-width:1}.horizon-grid{stroke:#586168;stroke-width:1;stroke-dasharray:4 5}.horizon-line{fill:none;stroke:#e8b94b;stroke-width:2.5;vector-effect:non-scaling-stroke}.horizon-fill{fill:rgba(232,185,75,.14);stroke:none}.horizon-scale{display:flex;justify-content:space-between;color:#fff;font-size:8px;margin-top:5px}
        .toast{position:absolute;top:74px;left:50%;transform:translateX(-50%);z-index:300;background:#3e454a;border:1px solid #879097;border-radius:5px;padding:10px 15px;color:#fff;font-size:11px;box-shadow:0 10px 25px rgba(0,0,0,.35)}
        .statusbar{position:absolute;left:0;right:0;bottom:0;height:30px;background:#3a4045;border-top:1px solid #687177;z-index:250;display:flex;align-items:center;justify-content:space-between;padding:0 12px;color:#fff;font-size:9px;letter-spacing:.06em}.statusbar strong{color:#fff}.statusbar .green{color:var(--green)}
        .inspector-scroll::-webkit-scrollbar,.dock-body::-webkit-scrollbar{width:7px}.inspector-scroll::-webkit-scrollbar-thumb,.dock-body::-webkit-scrollbar-thumb{background:#717b82;border-radius:5px}
        @media(max-width:1100px){.dock{transform-origin:top left}.topbar .brand{min-width:230px}.tab{padding:0 10px}.bottom-telemetry{width:calc(100vw - 30px)}}
      `}</style>

      <div className="app">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">◎</div>
            <div><h1>LUNAR MISSION BROWSER</h1><small>CLPS · SOUTH POLE DECISION SUPPORT</small></div>
          </div>
          <nav className="tabs">
            {["MISSION", "COMPARE", "TERRAIN", "DATA"].map((tab) => (
              <button key={tab} type="button" className={`tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>{tab}</button>
            ))}
          </nav>
          <div className="top-status">
            <span className="online"><span className="dot" style={{ background: health === "ONLINE" ? "var(--green)" : health === "OFFLINE" ? "var(--red)" : "#d8b54f" }} />ENGINE {health}</span>
            <button type="button" className={`top-layer ${layers.lasers ? "active" : ""}`} onClick={() => setLayers((v) => ({ ...v, lasers: !v.lasers }))}>LOS</button>
            <button type="button" className={`top-layer ${layers.sites ? "active" : ""}`} onClick={() => setLayers((v) => ({ ...v, sites: !v.sites }))}>SITES</button>
            <span>UTC</span><span>NAIF / LRO / LOLA</span>
          </div>
        </header>

        <main className="workspace" ref={workspaceRef}>
          <div className="canvas">
            <div className="scene">
              <Globe
                ref={globeRef}
                width={viewport.width}
                height={viewport.height}
                globeImageUrl="/ghibli-moon.svg"
                backgroundImageUrl="/ghibli-stars.svg"
                backgroundColor="#070c13"
                onGlobeClick={handleGlobeClick}
                pathsData={buildLasers}
                pathPoints="coords"
                pathColor="color"
                pathStroke={2.5}
                pathDashLength={0.25}
                pathDashGap={0.1}
                pathDashAnimateTime={1800}
                pathTransitionDuration={700}
                arcsData={buildArcs}
                arcStartLat="startLat"
                arcStartLng="startLng"
                arcEndLat="endLat"
                arcEndLng="endLng"
                arcColor="color"
                arcAltitude="altitude"
                arcAltitudeAutoScale={false}
                arcStroke={0.9}
                arcDashLength={0.35}
                arcDashGap={0.12}
                arcDashAnimateTime={1500}
                ringsData={[{ lat, lng: lon }]}
                ringLat="lat"
                ringLng="lng"
                ringColor={() => "#e8b94b"}
                ringMaxRadius={2.5}
                ringPropagationSpeed={1.4}
                ringRepeatPeriod={1800}
                pointsData={layers.sites ? savedSites : []}
                pointLat="lat"
                pointLng="lon"
                pointColor={() => "#e8b94b"}
                pointRadius={0.35}
                pointAltitude={0.015}
                enablePointerInteraction
                showAtmosphere={false}
                animateIn={false}
              />
            </div>
            <div className="hud"><span className="live">● {loading ? "UPDATING GEOMETRY" : "LIVE GEOMETRY"}</span><b>LUNAR SOUTH POLE</b><br /><span>{selectedLabel} · {date.replace("T", " ")} UTC</span></div>
            <div className="axis">
              <span className="origin" /><span className="x" /><span className="y" /><span className="z" />
              <label className="xl">X</label><label className="yl">Y</label><label className="zl">Z</label><span className="axis-title">IAU_MOON</span>
            </div>

            {!panels.tools.hidden && (
              <Dock id="tools" title="MISSION TOOLS" subtitle="SCENE COMMANDS" icon="▶" panel={panels.tools} setPanel={setPanel} z={zMap.tools} bringToFront={bringToFront} minWidth={250} minHeight={190}>
                <div className="tool-stack">
                  <button className="tool-btn" type="button" onClick={handleAnalyze}><span className="tool-icon">▷</span><span><strong>{analyzing ? "ANALYZING…" : "ANALYZE SITE"}</strong><small>Mission window forecast</small></span></button>
                  <button className="tool-btn" type="button" onClick={handleScan}><span className="tool-icon">⌖</span><span><strong>{scanning ? "SCANNING…" : "AUTO-SCAN AREA"}</strong><small>Rank candidate landing sites</small></span></button>
                  <button className="tool-btn" type="button" onClick={() => globeRef.current?.pointOfView({ lat, lng: lon, altitude: 2.25 }, 700)}><span className="tool-icon">◎</span><span><strong>CENTER SITE</strong><small>Return camera to selection</small></span></button>
                </div>
              </Dock>
            )}

            {!panels.planner.hidden && (
              <Dock id="planner" title="MISSION PLANNER" subtitle="LOCATION · WINDOW · RESOLUTION" icon="⌘" panel={panels.planner} setPanel={setPanel} z={zMap.planner} bringToFront={bringToFront} minWidth={320} minHeight={360}>
                <SectionTitle index="01" title="LOCATION" right="SELECTED" />
                <div className="field-row">
                  <div className="field"><label className="field-label">LATITUDE</label><input className="input" value={lat} onChange={(e) => setLat(e.target.value)} /></div>
                  <div className="field"><label className="field-label">LONGITUDE</label><input className="input" value={lon} onChange={(e) => setLon(e.target.value)} /></div>
                </div>
                <button className="primary-btn" type="button" onClick={() => selectLocation(lat, lon)}>◎ GO TO COORDINATES</button>
                <SectionTitle index="02" title="MISSION WINDOW" />
                <div className="field"><label className="field-label">LANDING DATE / TIME · UTC</label><input className="input" type="datetime-local" value={date} onChange={handleTimeChange} /></div>
                <div className="field-row">
                  <div className="field"><label className="field-label">DURATION</label><select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={1}>1 DAY</option><option value={7}>7 DAYS</option><option value={14}>14 DAYS</option><option value={30}>30 DAYS</option></select></div>
                  <div className="field"><label className="field-label">RESOLUTION</label><select className="select" value={resolution} onChange={(e) => setResolution(Number(e.target.value))}><option value={10}>10 MIN</option><option value={30}>30 MIN</option><option value={60}>60 MIN</option></select></div>
                </div>
                <button className="primary-btn" type="button" onClick={handleAnalyze}>{analyzing ? "RUNNING SPICE ANALYSIS…" : "▷ RUN MISSION ANALYSIS"}</button>
                <div style={{ marginTop: 15 }}><SectionTitle index="03" title="SITE" /><div className="notice">{selectedLabel}<br />Terrain: {num(data?.terrain_elevation_m).toFixed(1)} m</div></div>
              </Dock>
            )}

            {!panels.inspector.hidden && (
              <Dock id="inspector" title="MISSION INSPECTOR" subtitle="LIVE DECISION SUPPORT" icon="◫" panel={panels.inspector} setPanel={setPanel} z={zMap.inspector} bringToFront={bringToFront} minWidth={340} minHeight={360}>
                {renderInspector()}
              </Dock>
            )}

            {!panels.observation.hidden && (
              <Dock id="observation" title="OBSERVATION" subtitle="INSTANT SITE GEOMETRY" icon="◉" panel={panels.observation} setPanel={setPanel} z={zMap.observation} bringToFront={bringToFront} minWidth={360} minHeight={190}>
                <div className="observation">
                  <div className="section-title"><span className="section-index">LIVE</span><span>SELECTED SITE · {selectedLabel}</span><span className="section-right">UTC</span></div>
                  <div className="obs-grid">
                    <div className="obs-card"><h4>☀ SUN</h4><div className="obs-row"><span>AZIMUTH</span><b>{num(data?.sun?.azimuth_deg).toFixed(1)}°</b></div><div className="obs-row"><span>ELEVATION</span><b>{num(data?.sun?.elevation_deg).toFixed(2)}°</b></div><div className="obs-row"><span>STATUS</span><b className={sunGood ? "status-good" : "status-bad"}>{status(sunStatus)}</b></div></div>
                    <div className="obs-card"><h4>◉ EARTH</h4><div className="obs-row"><span>AZIMUTH</span><b>{num(data?.earth?.azimuth_deg).toFixed(1)}°</b></div><div className="obs-row"><span>ELEVATION</span><b>{num(data?.earth?.elevation_deg).toFixed(2)}°</b></div><div className="obs-row"><span>STATUS</span><b className={earthGood ? "status-good" : "status-bad"}>{status(earthStatus)}</b></div></div>
                  </div>
                </div>
              </Dock>
            )}

            {!panels.timeline.hidden && (
              <Dock id="timeline" title="MISSION WINDOWS" subtitle="SUNLIGHT · DIRECT-TO-EARTH" icon="▤" panel={panels.timeline} setPanel={setPanel} z={zMap.timeline} bringToFront={bringToFront} minWidth={480} minHeight={145}>
                <div className="timeline">
                  {missionStats ? <>
                    <div className="timeline-row"><span className="timeline-label">SUNLIGHT</span><div className="timeline-bar">{(missionStats.solar_timeline || []).map((v, i) => <span key={i} className={`segment ${v ? "available" : "blocked"}`} />)}</div><span className="timeline-value">{num(missionStats.solar_availability_percent).toFixed(1)}%</span></div>
                    <div className="timeline-row"><span className="timeline-label">EARTH LINK</span><div className="timeline-bar">{(missionStats.comm_timeline || []).map((v, i) => <span key={i} className={`segment ${v ? "available" : "blocked"}`} />)}</div><span className="timeline-value">{num(missionStats.comm_availability_percent).toFixed(1)}%</span></div>
                    <div className="timeline-row"><span className="timeline-label">MAX OUTAGE</span><div className="timeline-bar"><span className="segment blocked" style={{ flex: Math.min(100, num(missionStats.max_solar_outage_hours) * 2) }} /></div><span className="timeline-value">{num(missionStats.max_solar_outage_hours).toFixed(1)} h</span></div>
                  </> : <div className="empty-state">Run mission analysis to populate the forecast timeline.</div>}
                </div>
              </Dock>
            )}
          </div>

          <div className="bottom-telemetry">
            <div className="telemetry-cell"><div className="telemetry-icon">◎</div><div><div className="telemetry-label">SELECTED SITE</div><div className="telemetry-value">{Math.abs(lat).toFixed(3)}° {lat < 0 ? "S" : "N"} · {Math.abs(lon).toFixed(3)}° {lon < 0 ? "W" : "E"}</div><div className="telemetry-sub">{num(data?.terrain_elevation_m).toFixed(1)} m terrain</div></div></div>
            <div className="telemetry-cell"><div className="telemetry-icon" style={{ color: sunGood ? "var(--green)" : "var(--red)" }}>☼</div><div><div className="telemetry-label">SOLAR WINDOW</div><div className={`telemetry-value ${sunGood ? "status-good" : "status-bad"}`}>{status(sunStatus)}</div><div className="telemetry-sub">{num(data?.sun?.azimuth_deg).toFixed(1)}° AZ · {num(data?.sun?.elevation_deg).toFixed(2)}° EL</div></div></div>
            <div className="telemetry-cell"><div className="telemetry-icon" style={{ color: earthGood ? "var(--green)" : "var(--red)" }}>◉</div><div><div className="telemetry-label">DIRECT-TO-EARTH</div><div className={`telemetry-value ${earthGood ? "status-good" : "status-bad"}`}>{status(earthStatus)}</div><div className="telemetry-sub">{num(data?.earth?.azimuth_deg).toFixed(1)}° AZ · {num(data?.earth?.elevation_deg).toFixed(2)}° EL</div></div></div>
            <div className="telemetry-cell"><div className="telemetry-icon">▤</div><div><div className="telemetry-label">MISSION FORECAST</div><div className="telemetry-value">{missionStats ? `${num(missionStats.solar_availability_percent).toFixed(1)}% SUN` : "READY"}</div><div className="telemetry-sub">{missionStats ? `${num(missionStats.comm_availability_percent).toFixed(1)}% EARTH · ${days} DAYS` : "Click ANALYZE SITE"}</div></div></div>
          </div>
        </main>

        {toast && <div className="toast">{toast}</div>}

        <footer className="statusbar"><span><strong>OBJECTIVE</strong> · POWER · COMMUNICATION · TERRAIN</span><span><strong>DATA</strong> · NAIF SPICE · LRO LOLA · USGS</span><span className="green">● {health}</span></footer>
      </div>
    </>
  );
}

function Metric({ label, value }) {
  return <div className="metric"><small>{label}</small><b>{value}</b></div>;
}

function StatusLine({ label, value, good }) {
  return <div className="status-line"><span>{label}</span><b className={good ? "status-good" : "status-bad"}>{value}</b></div>;
}

export default App;
