import { useState } from 'react';
import Globe from 'react-globe.gl';

function App() {
  const [lat, setLat] = useState(-89.5);
  const [lon, setLon] = useState(0.0);
  const [date, setDate] = useState("2026-11-14T09:00"); // ⏱️ NEW: Hackathon Start Time
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Now accepts coordinates AND time
  const checkVisibility = async (targetLat, targetLon, targetDate) => {
    setLoading(true);
    try {
      // Send the date to the Python backend (adding :00 for seconds)
      const response = await fetch(`http://127.0.0.1:8000/api/visibility?lat=${targetLat}&lon=${targetLon}&date=${targetDate}:00`);
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error("Error fetching data:", error);
      alert("Make sure your Python backend is running!");
    }
    setLoading(false);
  };

  const handleGlobeClick = (event) => {
    const clickedLat = event.lat.toFixed(4);
    const clickedLon = event.lng.toFixed(4);
    
    setLat(clickedLat);
    setLon(clickedLon);
    
    // Send the current selected date
    checkVisibility(clickedLat, clickedLon, date);
  };

  // ⏱️ NEW: When the user changes the time slider
  const handleTimeChange = (event) => {
    const newDate = event.target.value;
    setDate(newDate);
    
    // If they already clicked a spot on the moon, recalculate immediately!
    if (data !== null) {
      checkVisibility(lat, lon, newDate);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#0f172a', color: 'white', fontFamily: 'system-ui, sans-serif' }}>
      
      {/* LEFT SIDE: The 3D Moon */}
      <div style={{ flex: 1, cursor: 'crosshair', position: 'relative', minHeight: '100vh' }}>
        <Globe
          globeImageUrl="https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/moon_1024.jpg"
          backgroundImageUrl="https://unpkg.com/three-globe/example/img/night-sky.png"
          onGlobeClick={handleGlobeClick}
          waitForGlobeReady={true}
        />
      </div>

      {/* RIGHT SIDE: The Telemetry Dashboard */}
      <div style={{ width: '400px', padding: '2rem', backgroundColor: '#1e293b', borderLeft: '2px solid #334155', display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ color: '#38bdf8', fontSize: '24px', marginTop: 0 }}>🌕 CLPS Mission Browser</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '2rem' }}>
          Spin the moon and <strong>click anywhere on the surface</strong> to calculate orbital visibility.
        </p>

        {/* ⏱️ TIME CONTROL BLOCK */}
        <div style={{ backgroundColor: '#0f172a', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#cbd5e1' }}>⏱️ Mission Time (UTC)</h3>
          <input 
            type="datetime-local" 
            value={date}
            onChange={handleTimeChange}
            style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #334155', backgroundColor: '#1e293b', color: '#38bdf8', fontSize: '1.1rem', colorScheme: 'dark', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ backgroundColor: '#0f172a', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#cbd5e1' }}>📍 Selected Coordinates</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#38bdf8', fontSize: '1.2rem' }}>
            <span>Lat: {lat}</span>
            <span>Lon: {lon}</span>
          </div>
        </div>

        {loading && (
          <div style={{ padding: '1rem', textAlign: 'center', color: '#fbbf24' }}>
            ⚙️ Calculating Orbital Mechanics...
          </div>
        )}

        {data && !loading && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            {/* SOLAR PANEL STATUS */}
            <div style={{ padding: '1rem', backgroundColor: '#0f172a', borderRadius: '8px', borderLeft: `4px solid ${data.sun.power_status === "ACTIVE" ? '#4ade80' : data.sun.power_status === "BLOCKED_BY_TERRAIN" ? '#fbbf24' : '#f87171'}` }}>
              <h3 style={{ margin: '0 0 10px 0' }}>☀️ Solar Power</h3>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: data.sun.power_status === "ACTIVE" ? '#4ade80' : data.sun.power_status === "BLOCKED_BY_TERRAIN" ? '#fbbf24' : '#f87171' }}>
                {data.sun.power_status === "ACTIVE" ? "🟢 ACTIVE" : data.sun.power_status === "BLOCKED_BY_TERRAIN" ? "⚠️ BLOCKED BY MOUNTAIN" : "🌙 NIGHTTIME"}
              </div>
              <div style={{ color: '#94a3b8', marginTop: '5px' }}>
                Sun Elevation: {data.sun.elevation_deg}° | Azimuth: {data.sun.azimuth_deg}°
              </div>
              {data.sun.power_status === "BLOCKED_BY_TERRAIN" && (
                <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#451a03', color: '#fde047', borderRadius: '4px', fontSize: '0.9rem' }}>
                  Mountain peak of <strong>{data.sun.blocker_elevation_m}m</strong> detected <strong>{data.sun.blocked_at_km}km</strong> away!
                </div>
              )}
            </div>

            {/* EARTH COMMS STATUS */}
            <div style={{ padding: '1rem', backgroundColor: '#0f172a', borderRadius: '8px', borderLeft: `4px solid ${data.earth.comm_status === "ONLINE" ? '#4ade80' : data.earth.comm_status === "BLOCKED_BY_TERRAIN" ? '#fbbf24' : '#f87171'}` }}>
              <h3 style={{ margin: '0 0 10px 0' }}>🌍 Earth Comm Link</h3>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: data.earth.comm_status === "ONLINE" ? '#4ade80' : data.earth.comm_status === "BLOCKED_BY_TERRAIN" ? '#fbbf24' : '#f87171' }}>
                {data.earth.comm_status === "ONLINE" ? "📡 ONLINE" : data.earth.comm_status === "BLOCKED_BY_TERRAIN" ? "⚠️ SIGNAL BLOCKED" : "🚫 NO SIGNAL"}
              </div>
              <div style={{ color: '#94a3b8', marginTop: '5px' }}>
                Earth Elevation: {data.earth.elevation_deg}° | Azimuth: {data.earth.azimuth_deg}°
              </div>
              {data.earth.comm_status === "BLOCKED_BY_TERRAIN" && (
                <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#451a03', color: '#fde047', borderRadius: '4px', fontSize: '0.9rem' }}>
                  Mountain peak of <strong>{data.earth.blocker_elevation_m}m</strong> detected <strong>{data.earth.blocked_at_km}km</strong> away blocking line-of-sight!
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

export default App;