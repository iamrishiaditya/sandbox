from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import spiceypy as spice
import numpy as np
import math
from datetime import datetime, timedelta

# 1. Initialize the App
app = FastAPI(title="CLPS Lunar Mission API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Load Terrain and Kernels ONCE on startup
print("Loading LOLA Terrain Map...")
terrain_raw = np.fromfile('data/lola/ldem_4.img', dtype='>i2').reshape((720, 1440)) * 0.5
terrain = np.where(terrain_raw > 10000, 0, terrain_raw) 
terrain = np.where(terrain < -10000, 0, terrain)

print("Loading NASA SPICE Kernels...")
spice.furnsh('data/spice/naif0012.tls')
spice.furnsh('data/spice/pck00010.tpc')
spice.furnsh('data/spice/moon_pa_de421_1900-2050.bpc')
spice.furnsh('data/spice/de432s.bsp')
print("✅ API Server Ready with Raycasting!")

moon_radius_km = 1737.4

# --- MATH ENGINE ---
def get_terrain_elevation(lat_deg, lon_deg):
    row = int((90.0 - lat_deg) * 4.0)
    col = int((lon_deg % 360.0) * 4.0)
    row = max(0, min(719, row))
    col = max(0, min(1439, col))
    return terrain[row, col]

def get_azimuth_and_elevation(target_pos, observer_pos):
    up = observer_pos / np.linalg.norm(observer_pos)
    z_axis = np.array([0, 0, 1])
    
    east = np.cross(z_axis, up)
    if np.linalg.norm(east) == 0:
        east = np.array([1, 0, 0]) # Prevent math errors exactly at the poles
    else:
        east = east / np.linalg.norm(east)
        
    north = np.cross(up, east)
    
    vector_to_target = target_pos - observer_pos
    v_norm = vector_to_target / np.linalg.norm(vector_to_target)
    
    v_up = np.dot(v_norm, up)
    v_east = np.dot(v_norm, east)
    v_north = np.dot(v_norm, north)
    
    elevation = math.degrees(math.asin(max(-1.0, min(1.0, v_up))))
    azimuth = math.degrees(math.atan2(v_east, v_north))
    if azimuth < 0:
        azimuth += 360.0
        
    return elevation, azimuth

def check_terrain_blockage(start_lat, start_lon, azimuth, target_elevation, rover_elevation_m, target_type="POINT"):
    angular_radius = 0.0
    if target_type == "SUN": angular_radius = 0.26
    elif target_type == "EARTH": angular_radius = 0.95
    
    adjusted_target_elevation = target_elevation + angular_radius
    
    max_terrain_angle = -90.0
    blocking_distance = None
    blocking_elevation = None
    
    start_lat_rad = math.radians(start_lat)
    start_lon_rad = math.radians(start_lon)
    azimuth_rad = math.radians(azimuth)
    
    for step in range(1, 201):
        distance_km = step * 0.25
        ad = distance_km / moon_radius_km
        new_lat_rad = math.asin(math.sin(start_lat_rad)*math.cos(ad) + 
                                math.cos(start_lat_rad)*math.sin(ad)*math.cos(azimuth_rad))
        new_lon_rad = start_lon_rad + math.atan2(math.sin(azimuth_rad)*math.sin(ad)*math.cos(start_lat_rad), 
                                                 math.cos(ad) - math.sin(start_lat_rad)*math.sin(new_lat_rad))
        
        step_elev_m = get_terrain_elevation(math.degrees(new_lat_rad), math.degrees(new_lon_rad))
        curvature_drop_km = (distance_km ** 2) / (2 * moon_radius_km)
        height_diff_km = ((step_elev_m - rover_elevation_m) / 1000.0) - curvature_drop_km
        
        angle_deg = math.degrees(math.atan2(height_diff_km, distance_km))
        
        if angle_deg > max_terrain_angle:
            max_terrain_angle = angle_deg
            if angle_deg > adjusted_target_elevation:
                blocking_distance = distance_km
                blocking_elevation = step_elev_m
                break
                
    return max_terrain_angle, blocking_distance, blocking_elevation

# --- API ENDPOINT ---
@app.get("/api/visibility")
def check_visibility(lat: float, lon: float, date: str = "2026-11-14T09:00:00"):
    try:
        rover_elevation_m = get_terrain_elevation(lat, lon)
        rover_radius_km = moon_radius_km + (rover_elevation_m / 1000.0)
        
        lat_rad = math.radians(lat)
        lon_rad = math.radians(lon)
        surface_pos = np.array([
            rover_radius_km * math.cos(lat_rad) * math.cos(lon_rad),
            rover_radius_km * math.cos(lat_rad) * math.sin(lon_rad),
            rover_radius_km * math.sin(lat_rad)
        ])
        
        et = spice.str2et(date)
        sun_state, _ = spice.spkpos('SUN', et, 'IAU_MOON', 'LT+S', 'MOON')
        earth_state, _ = spice.spkpos('EARTH', et, 'IAU_MOON', 'LT+S', 'MOON')
        
        sun_elev, sun_az = get_azimuth_and_elevation(sun_state, surface_pos)
        earth_elev, earth_az = get_azimuth_and_elevation(earth_state, surface_pos)
        
        _, sun_block_dist, sun_block_elev = check_terrain_blockage(lat, lon, sun_az, sun_elev, rover_elevation_m, "SUN")
        _, earth_block_dist, earth_block_elev = check_terrain_blockage(lat, lon, earth_az, earth_elev, rover_elevation_m, "EARTH")

        # 🌍 SCIENCE UPGRADE: Check apparent disk edges, not center point
        if sun_elev < -0.26:
            power_status = "HORIZON_NIGHT"
        elif sun_block_dist:
            power_status = "BLOCKED_BY_TERRAIN"
        else:
            power_status = "ILLUMINATED"
            
        if earth_elev < -0.95:
            comm_status = "HORIZON_BLOCKED"
        elif earth_block_dist:
            comm_status = "BLOCKED_BY_TERRAIN"
        else:
            comm_status = "ONLINE"
            
        return {
            "mission_coordinate": {"lat": lat, "lon": lon, "elevation_m": float(rover_elevation_m)},
            "timestamp": date,
            "sun": {
                "elevation_deg": round(sun_elev, 2),
                "azimuth_deg": round(sun_az, 2),
                "power_status": power_status,
                "blocked_at_km": sun_block_dist,
                "blocker_elevation_m": float(sun_block_elev) if sun_block_elev else None
            },
            "earth": {
                "elevation_deg": round(earth_elev, 2),
                "azimuth_deg": round(earth_az, 2),
                "comm_status": comm_status,
                "blocked_at_km": earth_block_dist,
                "blocker_elevation_m": float(earth_block_elev) if earth_block_elev else None
            }
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/mission-analysis")
def analyze_mission(lat: float, lon: float, start_date: str = "2026-11-14T09:00", days: int = 14, step_minutes: int = 10):
    try:
        rover_elevation_m = get_terrain_elevation(lat, lon)
        rover_radius_km = moon_radius_km + (rover_elevation_m / 1000.0)
        
        lat_rad = math.radians(lat)
        lon_rad = math.radians(lon)
        surface_pos = np.array([
            rover_radius_km * math.cos(lat_rad) * math.cos(lon_rad),
            rover_radius_km * math.cos(lat_rad) * math.sin(lon_rad),
            rover_radius_km * math.sin(lat_rad)
        ])
        
        start_dt = datetime.strptime(start_date[:16], "%Y-%m-%dT%H:%M")
        
        # ⏱️ SPEED UPGRADE: Dynamic time steps!
        total_steps = int((days * 24 * 60) / step_minutes)
        
        solar_active_steps = comm_active_steps = 0
        current_solar_outage = max_solar_outage = 0
        current_comm_outage = max_comm_outage = 0
        
        solar_timeline = []
        comm_timeline = []
        
        for step in range(total_steps):
            current_dt = start_dt + timedelta(minutes=step * step_minutes)
            et = spice.str2et(current_dt.strftime("%Y-%m-%dT%H:%M:00"))
            
            sun_state, _ = spice.spkpos('SUN', et, 'IAU_MOON', 'LT+S', 'MOON')
            earth_state, _ = spice.spkpos('EARTH', et, 'IAU_MOON', 'LT+S', 'MOON')
            
            sun_elev, sun_az = get_azimuth_and_elevation(sun_state, surface_pos)
            earth_elev, earth_az = get_azimuth_and_elevation(earth_state, surface_pos)
            
            _, sun_block, _ = check_terrain_blockage(lat, lon, sun_az, sun_elev, rover_elevation_m, "SUN")
            _, earth_block, _ = check_terrain_blockage(lat, lon, earth_az, earth_elev, rover_elevation_m, "EARTH")
            
            if earth_elev < -0.95 or earth_block:
                current_comm_outage += 1
                comm_timeline.append(0)
                if current_comm_outage > max_comm_outage: max_comm_outage = current_comm_outage
            else:
                comm_active_steps += 1
                comm_timeline.append(1)
                current_comm_outage = 0
                
            if sun_elev < -0.26 or sun_block:
                current_solar_outage += 1
                solar_timeline.append(0)
                if current_solar_outage > max_solar_outage: max_solar_outage = current_solar_outage
            else:
                solar_active_steps += 1
                solar_timeline.append(1)
                current_solar_outage = 0

        return {
            "duration_days": days,
            "solar_availability_percent": round((solar_active_steps / total_steps) * 100, 1),
            "comm_availability_percent": round((comm_active_steps / total_steps) * 100, 1),
            "max_solar_outage_hours": round(max_solar_outage * (step_minutes / 60), 1),
            "max_comm_outage_hours": round(max_comm_outage * (step_minutes / 60), 1),
            "solar_timeline": solar_timeline,
            "comm_timeline": comm_timeline
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/scan-region")
def scan_region(center_lat: float, center_lon: float, start_date: str = "2026-11-14T09:00", days: int = 14):
    try:
        results = []
        # 🚀 SPEED UPGRADE: Test 5 points (Center, North, South, East, West) to cut processing time in half
        test_points = [
            (0.0, 0.0),    # Center
            (0.5, 0.0),    # North
            (-0.5, 0.0),   # South
            (0.0, 5.0),    # East (Longitude shrinks near poles, so we jump 5 degrees)
            (0.0, -5.0)    # West
        ]
        
        for d_lat, d_lon in test_points:
            test_lat = max(-90.0, min(90.0, center_lat + d_lat))
            test_lon = (center_lon + d_lon) % 360
            
            # 🚀 SPEED UPGRADE: Pass step_minutes=60. Makes the scan 6x FASTER!
            stats = analyze_mission(test_lat, test_lon, start_date, days, step_minutes=60)
            if "error" in stats: continue
            
            sun_score = stats["solar_availability_percent"] * 0.4
            comm_score = stats["comm_availability_percent"] * 0.4
            sun_penalty = (stats["max_solar_outage_hours"] / 336.0) * 10
            comm_penalty = (stats["max_comm_outage_hours"] / 336.0) * 10
            reliability_score = max(0, 20 - sun_penalty - comm_penalty)
            
            overall_score = round(sun_score + comm_score + reliability_score, 1)
            
            results.append({
                "lat": round(test_lat, 4),
                "lon": round(test_lon, 4),
                "score": overall_score,
                "stats": stats
            })
                
        results = sorted(results, key=lambda x: x["score"], reverse=True)
        if not results:
            return {"error": "Math engine failed on all points. Invalid region."}
        return {"recommended_sites": results[:3]}
    except Exception as e:
        return {"error": str(e)}