import { useState, useRef, useEffect } from 'react';
import Globe from 'react-globe.gl';

function App() {
  const globeRef = useRef();
  const [lat, setLat] = useState(-89.5);
  const [lon, setLon] = useState(0.0);
  const [date, setDate] = useState("2026-11-14T09:00");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const [missionStats, setMissionStats] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [savedSites, setSavedSites] = useState([]); // 📌 NEW: Array to hold our saved comparison sites

  // Set initial camera distance when globe loads
  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.pointOfView({ altitude: 2.2 }, 1000);
    }
  }, []);

  const runMissionAnalysis = async () => {
    setAnalyzing(true);
    setMissionStats(null);
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/mission-analysis?lat=${lat}&lon=${lon}&start_date=${date}&days=14`);
      const result = await response.json();
      setMissionStats(result);
    } catch (error) {
      console.error("Analysis Error:", error); // <-- This satisfies ESLint!
      setMissionStats({ error: "Failed to connect to backend engine." });
    }
    setAnalyzing(false);
  };

  const checkVisibility = async (targetLat, targetLon, targetDate) => {
    setLoading(true);
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/visibility?lat=${targetLat}&lon=${targetLon}&date=${targetDate}:00`);
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    setLoading(false);
  };

  const handleGlobeClick = (event) => {
    const clickedLat = event.lat.toFixed(4);
    const clickedLon = event.lng.toFixed(4);
    
    setLat(clickedLat);
    setLon(clickedLon);
    setMissionStats(null); 
    
    checkVisibility(clickedLat, clickedLon, date);
  };

  const handleTimeChange = (event) => {
    const newDate = event.target.value;
    setDate(newDate);
    if (data !== null) {
      checkVisibility(lat, lon, newDate);
    }
  };

  // 🎇 NEW: Generate the 3D Laser Beams!
  const buildLasers = () => {
    if (!data) return [];
    
    const createPath = (startLat, startLon, az, elev, status, type) => {
      const startLatNum = parseFloat(startLat);
      const startLonNum = parseFloat(startLon);
      
      let lengthDeg = 20; // How far the laser shoots into space
      let altMultiplier = Math.sin(elev * Math.PI / 180) * 0.8; 
      let color = type === 'sun' ? '#fde047' : '#38bdf8'; // Yellow (Sun) or Blue (Earth)
      
      if (status === 'BLOCKED_BY_TERRAIN') {
          lengthDeg = 2; // Stubby laser that hits the mountain
          altMultiplier = Math.sin(elev * Math.PI / 180) * 0.05;
          color = '#ef4444'; // Red! (Signal Crashed)
      } else if (elev < 0) {
          lengthDeg = 5; 
          altMultiplier = -0.05; // Point down into the ground
          color = '#475569'; // Dim Gray (Nighttime/Hidden)
      }

      // Spherical math to point the laser in the correct compass Azimuth direction
      const cosLat = Math.max(0.1, Math.abs(Math.cos(startLatNum * Math.PI / 180))); // Prevent pole glitching
      const endLat = startLatNum + (Math.cos(az * Math.PI / 180) * lengthDeg);
      const endLon = startLonNum + (Math.sin(az * Math.PI / 180) * lengthDeg / cosLat);
      
      return {
        coords: [[startLatNum, startLonNum, 0.005], [endLat, endLon, altMultiplier]],
        color: color
      };
    };

    return [
      createPath(lat, lon, data.sun.azimuth_deg, data.sun.elevation_deg, data.sun.power_status, 'sun'),
      createPath(lat, lon, data.earth.azimuth_deg, data.earth.elevation_deg, data.earth.comm_status, 'earth')
    ];
  };

  return (
    <>
      {/* Nuke Vite's default CSS that is causing the blank left space */}
      <style>{`
        * { box-sizing: border-box; }
        html, body, #root { margin: 0 !important; padding: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; overflow: hidden; background: #050505; }
        .glass-panel {
          background: rgba(10, 15, 30, 0.65);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(56, 189, 248, 0.15);
          border-radius: 12px;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
          padding: 1.5rem;
          color: #f8fafc;
        }
        input[type="datetime-local"]::-webkit-calendar-picker-indicator { filter: invert(1); cursor: pointer; }
      `}</style>

      <div style={{ position: 'relative', width: '100vw', height: '100vh', fontFamily: '"Inter", system-ui, sans-serif' }}>
        
        {/* 🌌 FULL SCREEN BACKGROUND GLOBE */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1, cursor: 'crosshair' }}>
          <Globe
            ref={globeRef}
            globeImageUrl="/ghibli-moon.svg"
            backgroundImageUrl="/ghibli-stars.svg"
            onGlobeClick={handleGlobeClick}
            waitForGlobeReady={true}
            
            // 📍 1. The Pulsing Green Radar Ring at the Rover Site
            ringsData={data ? [{ lat: parseFloat(lat), lng: parseFloat(lon) }] : []}
            ringColor={() => '#10b981'}
            ringMaxRadius={2.5}
            ringPropagationSpeed={1}
            ringRepeatPeriod={800}

            // 🔫 2. The Animated 3D Laser Beams
            pathsData={buildLasers()}
            pathPoints="coords"
            pathColor="color"
            pathWidth={3.5}
            pathDashLength={0.15}
            pathDashGap={0.05}
            pathDashAnimateTime={2000}
          />
        </div>

        {/* 🚀 TOP HEADER */}
        <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 10, textAlign: 'center', pointerEvents: 'none' }}>
          <h1 style={{ color: '#e0f2fe', margin: 0, fontSize: '28px', textTransform: 'uppercase', letterSpacing: '4px', textShadow: '0 0 10px rgba(56,189,248,0.5)' }}>
            🌕 CLPS Mission Browser
          </h1>
          <p style={{ color: '#38bdf8', margin: '5px 0 0 0', fontSize: '14px', letterSpacing: '2px', textTransform: 'uppercase' }}>
            Orbital Telemetry & Raycasting Engine
          </p>
        </div>

        {/* 📍 LEFT PANEL: TARGETING & ANALYTICS */}
        <div className="glass-panel" style={{ position: 'absolute', top: '100px', left: '30px', width: '380px', zIndex: 10 }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
            🎯 Surface Targeting
          </h3>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e0f2fe', fontSize: '1.4rem', fontFamily: 'monospace', marginBottom: '5px' }}>
            <span>LAT: <span style={{ color: '#38bdf8' }}>{lat}</span></span>
            <span>LON: <span style={{ color: '#38bdf8' }}>{lon}</span></span>
          </div>
          {data && !loading && (
            <div style={{ color: '#a7f3d0', fontSize: '0.9rem', marginBottom: '20px' }}>
              ↳ Local Elevation: {data.mission_coordinate.elevation_m}m
            </div>
          )}

          <h3 style={{ margin: '20px 0 15px 0', color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
            📊 Mission Simulator
          </h3>
          <button 
            onClick={runMissionAnalysis}
            disabled={analyzing || !data}
            style={{ width: '100%', padding: '0.8rem', backgroundColor: (analyzing || !data) ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.8)', color: 'white', border: '1px solid rgba(96, 165, 250, 0.5)', borderRadius: '6px', cursor: (analyzing || !data) ? 'not-allowed' : 'pointer', fontWeight: 'bold', letterSpacing: '1px', transition: 'all 0.3s' }}
          >
            {analyzing ? "⚙️ SIMULATING 336 HOURS..." : "🚀 RUN 14-DAY FORECAST"}
          </button>

          {/* Mission Stats Results */}
          {missionStats && (
            <div style={{ marginTop: '15px', padding: '12px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              {missionStats.error || missionStats.detail || missionStats.solar_availability_percent === undefined ? (
                 <div style={{ color: '#f87171', fontSize: '0.9rem', wordWrap: 'break-word' }}>
                   ⚠️ Backend Error: {missionStats.error || missionStats.detail || "Math Engine Crashed"}
                 </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ color: '#94a3b8' }}>☀️ Solar Uptime:</span>
                    <strong style={{ color: missionStats.solar_availability_percent > 50 ? '#4ade80' : '#f87171' }}>{missionStats.solar_availability_percent}%</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span style={{ color: '#94a3b8' }}>Max Darkness:</span>
                    <strong style={{ color: '#fbbf24' }}>{missionStats.max_solar_outage_hours} hrs</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ color: '#94a3b8' }}>🌍 Comm Uptime:</span>
                    <strong style={{ color: missionStats.comm_availability_percent > 50 ? '#4ade80' : '#f87171' }}>{missionStats.comm_availability_percent}%</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span style={{ color: '#94a3b8' }}>Max Blackout:</span>
                    <strong style={{ color: '#fbbf24' }}>{missionStats.max_comm_outage_hours} hrs</strong>
                  </div>

                  {/* 📌 SAVE SITE BUTTON */}
                  <button 
                    onClick={() => {
                      // Prevent saving the exact same spot twice
                      if (!savedSites.find(s => s.lat === lat && s.lon === lon)) {
                        setSavedSites([...savedSites, { lat, lon, stats: missionStats }]);
                      }
                    }}
                    style={{ width: '100%', padding: '0.6rem', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.5)', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', letterSpacing: '1px', transition: 'all 0.3s' }}
                  >
                    📌 SAVE CANDIDATE SITE
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* 📊 CANDIDATE SITE COMPARISON SCOREBOARD (BOTTOM LEFT) */}
        {savedSites.length > 0 && (
          <div className="glass-panel" style={{ position: 'absolute', bottom: '30px', left: '30px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: 'calc(100vw - 450px)', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                📊 Candidate Site Comparison
              </h3>
              <button onClick={() => setSavedSites([])} style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px' }}>[ CLEAR ]</button>
            </div>
            
            <div style={{ display: 'flex', gap: '15px' }}>
              {savedSites.map((site, idx) => (
                <div key={idx} style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px', borderRadius: '8px', minWidth: '170px' }}>
                  <div style={{ color: '#e0f2fe', fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
                    📍 Target {String.fromCharCode(65 + idx)} {/* Converts 0 to A, 1 to B, etc. */}
                  </div>
                  <div style={{ color: '#38bdf8', fontSize: '11px', fontFamily: 'monospace', marginBottom: '10px' }}>
                    LAT: {site.lat}<br/>LON: {site.lon}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                    <span style={{ color: '#94a3b8' }}>☀️ Solar:</span>
                    <span style={{ color: site.stats.solar_availability_percent > 50 ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>{site.stats.solar_availability_percent}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: '#94a3b8' }}>🌍 Comm:</span>
                    <span style={{ color: site.stats.comm_availability_percent > 50 ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>{site.stats.comm_availability_percent}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 📡 RIGHT PANEL: LIVE TELEMETRY */}
        <div className="glass-panel" style={{ position: 'absolute', top: '100px', right: '30px', width: '380px', zIndex: 10 }}>
           <h3 style={{ margin: '0 0 15px 0', color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
            📡 Live Telemetry Link
          </h3>

          {loading && (
            <div style={{ padding: '2rem 0', textAlign: 'center', color: '#38bdf8', fontStyle: 'italic', animation: 'pulse 1.5s infinite' }}>
              Establishing connection...
            </div>
          )}

          {!data && !loading && (
            <div style={{ padding: '2rem 0', textAlign: 'center', color: '#64748b' }}>
              Select a landing site to begin.
            </div>
          )}

          {data && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {/* SOLAR */}
              <div style={{ padding: '12px', background: 'rgba(0,0,0,0.5)', borderRadius: '8px', borderLeft: `4px solid ${data.sun.power_status === "ACTIVE" ? '#4ade80' : data.sun.power_status === "BLOCKED_BY_TERRAIN" ? '#fbbf24' : '#334155'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, color: '#e0f2fe', fontSize: '15px' }}>☀️ Solar Array</h3>
                  <span style={{ fontSize: '11px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '4px', backgroundColor: data.sun.power_status === "ACTIVE" ? 'rgba(74, 222, 128, 0.2)' : data.sun.power_status === "BLOCKED_BY_TERRAIN" ? 'rgba(251, 191, 36, 0.2)' : 'rgba(248, 113, 113, 0.2)', color: data.sun.power_status === "ACTIVE" ? '#4ade80' : data.sun.power_status === "BLOCKED_BY_TERRAIN" ? '#fbbf24' : '#f87171' }}>
                    {data.sun.power_status === "ACTIVE" ? "ONLINE" : data.sun.power_status === "BLOCKED_BY_TERRAIN" ? "OBSTRUCTED" : "ECLIPSED"}
                  </span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '13px', fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
                  <span>ELEV: {data.sun.elevation_deg}°</span>
                  <span>AZIM: {data.sun.azimuth_deg}°</span>
                </div>
                {data.sun.power_status === "BLOCKED_BY_TERRAIN" && (
                  <div style={{ marginTop: '10px', padding: '8px', backgroundColor: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', color: '#fde047', borderRadius: '4px', fontSize: '0.85rem' }}>
                    ⚠️ Terrain obstruction: <strong>{data.sun.blocker_elevation_m}m</strong> peak at <strong>{data.sun.blocked_at_km}km</strong> distance.
                  </div>
                )}
              </div>

              {/* EARTH */}
              <div style={{ padding: '12px', background: 'rgba(0,0,0,0.5)', borderRadius: '8px', borderLeft: `4px solid ${data.earth.comm_status === "ONLINE" ? '#4ade80' : data.earth.comm_status === "BLOCKED_BY_TERRAIN" ? '#fbbf24' : '#334155'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, color: '#e0f2fe', fontSize: '15px' }}>🌍 Earth Uplink</h3>
                  <span style={{ fontSize: '11px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '4px', backgroundColor: data.earth.comm_status === "ONLINE" ? 'rgba(74, 222, 128, 0.2)' : data.earth.comm_status === "BLOCKED_BY_TERRAIN" ? 'rgba(251, 191, 36, 0.2)' : 'rgba(248, 113, 113, 0.2)', color: data.earth.comm_status === "ONLINE" ? '#4ade80' : data.earth.comm_status === "BLOCKED_BY_TERRAIN" ? '#fbbf24' : '#f87171' }}>
                    {data.earth.comm_status === "ONLINE" ? "ESTABLISHED" : data.earth.comm_status === "BLOCKED_BY_TERRAIN" ? "OBSTRUCTED" : "LOS"}
                  </span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '13px', fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
                  <span>ELEV: {data.earth.elevation_deg}°</span>
                  <span>AZIM: {data.earth.azimuth_deg}°</span>
                </div>
                {data.earth.comm_status === "BLOCKED_BY_TERRAIN" && (
                  <div style={{ marginTop: '10px', padding: '8px', backgroundColor: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', color: '#fde047', borderRadius: '4px', fontSize: '0.85rem' }}>
                    ⚠️ Radio blocked: <strong>{data.earth.blocker_elevation_m}m</strong> peak at <strong>{data.earth.blocked_at_km}km</strong> distance.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ⏱️ BOTTOM TIMELINE SCRUBBER */}
        <div className="glass-panel" style={{ position: 'absolute', bottom: '30px', left: '50%', transform: 'translateX(-50%)', width: '500px', padding: '1rem 2rem', zIndex: 10, display: 'flex', alignItems: 'center', gap: '20px' }}>
          <span style={{ color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>Time (UTC)</span>
          <input 
            type="datetime-local" 
            value={date}
            onChange={handleTimeChange}
            style={{ flex: 1, padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(56, 189, 248, 0.4)', backgroundColor: 'rgba(15, 23, 42, 0.9)', color: '#38bdf8', fontSize: '1rem', outline: 'none' }}
          />
        </div>

      </div>
    </>
  );
}

export default App;