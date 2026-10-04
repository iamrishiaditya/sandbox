import spiceypy as spice
import numpy as np
import math

print("\n🚀 Phase 2.2: Terrain Raycasting Engine...\n")

# 1. Load Data & Clean Terrain Map
terrain_raw = np.fromfile('data/lola/ldem_4.img', dtype='>i2').reshape((720, 1440)) * 0.5
terrain = np.where(terrain_raw > 10000, 0, terrain_raw) 
terrain = np.where(terrain < -10000, 0, terrain)

spice.furnsh('data/spice/naif0012.tls')
spice.furnsh('data/spice/pck00010.tpc')
spice.furnsh('data/spice/moon_pa_de421_1900-2050.bpc')
spice.furnsh('data/spice/de432s.bsp')

# Our CLPS Landing Site
lat = -89.5
lon = 0.0
moon_radius_km = 1737.4

# 2. Get Rover's Elevation from LOLA map
def get_terrain_elevation(lat_deg, lon_deg):
    # Convert lat/lon to map row/col
    row = int((90.0 - lat_deg) * 4.0)
    col = int((lon_deg % 360.0) * 4.0)
    # Ensure bounds so we don't crash at the poles
    row = max(0, min(719, row))
    col = max(0, min(1439, col))
    return terrain[row, col]

rover_elevation_m = get_terrain_elevation(lat, lon)
rover_radius_km = moon_radius_km + (rover_elevation_m / 1000.0)

# Convert Lat/Lon to 3D Math Coordinates (accounting for terrain height!)
lat_rad = math.radians(lat)
lon_rad = math.radians(lon)
surface_pos = np.array([
    rover_radius_km * math.cos(lat_rad) * math.cos(lon_rad),
    rover_radius_km * math.cos(lat_rad) * math.sin(lon_rad),
    rover_radius_km * math.sin(lat_rad)
])

# 3. Set the Time and get SPICE States
hackathon_start = "2026-11-14T09:00:00"
et = spice.str2et(hackathon_start)

sun_state, _ = spice.spkpos('SUN', et, 'IAU_MOON', 'LT+S', 'MOON')
earth_state, _ = spice.spkpos('EARTH', et, 'IAU_MOON', 'LT+S', 'MOON')

# 4. Calculate Elevation AND Azimuth (Compass Direction)
def get_azimuth_and_elevation(target_pos, observer_pos):
    up = observer_pos / np.linalg.norm(observer_pos)
    z_axis = np.array([0, 0, 1]) # Moon's North Pole axis
    
    # Calculate Local North and East Vectors
    east = np.cross(z_axis, up)
    east = east / np.linalg.norm(east)
    north = np.cross(up, east)
    
    # Vector to Target (Sun/Earth)
    vector_to_target = target_pos - observer_pos
    v_norm = vector_to_target / np.linalg.norm(vector_to_target)
    
    # Math angles
    v_up = np.dot(v_norm, up)
    v_east = np.dot(v_norm, east)
    v_north = np.dot(v_norm, north)
    
    elevation = math.degrees(math.asin(max(-1.0, min(1.0, v_up))))
    azimuth = math.degrees(math.atan2(v_east, v_north))
    if azimuth < 0:
        azimuth += 360.0
        
    return elevation, azimuth

sun_elev, sun_az = get_azimuth_and_elevation(sun_state, surface_pos)
earth_elev, earth_az = get_azimuth_and_elevation(earth_state, surface_pos)

# 5. --- THE TERRAIN RAYCASTER ---
def check_terrain_blockage(start_lat, start_lon, azimuth, target_elevation):
    print(f"🔍 Raycasting towards Azimuth {azimuth:.1f}°...")
    max_terrain_angle = -90.0
    blocking_distance = None
    blocking_elevation = None
    
    start_lat_rad = math.radians(start_lat)
    start_lon_rad = math.radians(start_lon)
    azimuth_rad = math.radians(azimuth)
    
    # Walk forward across the map from 1km to 50km
    for distance_km in range(1, 51):
        # Angular distance
        ad = distance_km / moon_radius_km
        
        # Spherical trigonometry to find new lat/lon along the path
        new_lat_rad = math.asin(math.sin(start_lat_rad)*math.cos(ad) + 
                                math.cos(start_lat_rad)*math.sin(ad)*math.cos(azimuth_rad))
        
        new_lon_rad = start_lon_rad + math.atan2(math.sin(azimuth_rad)*math.sin(ad)*math.cos(start_lat_rad), 
                                                 math.cos(ad) - math.sin(start_lat_rad)*math.sin(new_lat_rad))
        
        # Get terrain height at this new step
        step_elev_m = get_terrain_elevation(math.degrees(new_lat_rad), math.degrees(new_lon_rad))
        
        # Calculate angle to this mountain
        height_diff_km = (step_elev_m - rover_elevation_m) / 1000.0
        angle_deg = math.degrees(math.atan2(height_diff_km, distance_km))
        
        if angle_deg > max_terrain_angle:
            max_terrain_angle = angle_deg
            # If the mountain angle is higher than the Sun/Earth... it's blocked!
            if angle_deg > target_elevation:
                blocking_distance = distance_km
                blocking_elevation = step_elev_m
                break # We hit a mountain! Stop checking.
                
    return max_terrain_angle, blocking_distance, blocking_elevation

sun_horizon, sun_block_dist, sun_block_elev = check_terrain_blockage(lat, lon, sun_az, sun_elev)
earth_horizon, earth_block_dist, earth_block_elev = check_terrain_blockage(lat, lon, earth_az, earth_elev)

# 6. --- PRINT RESULTS ---
print("\n" + "="*50)
print(f"📍 Landing Site: Lat {lat}, Lon {lon} | Rover Elevation: {rover_elevation_m}m")
print("="*50)

print(f"☀️ SUN  | Elevation: {sun_elev:.2f}° | Azimuth: {sun_az:.2f}°")
if sun_block_dist:
    print(f"   ❌ BLOCKED by mountain {sun_block_dist}km away (Peak: {sun_block_elev}m).")
elif sun_elev < 0:
    print("   🌙 BLOCKED by horizon (Nighttime).")
else:
    print("   ✅ CLEAR LINE OF SIGHT! Solar panels active.")

print(f"\n🌍 EARTH | Elevation: {earth_elev:.2f}° | Azimuth: {earth_az:.2f}°")
if earth_block_dist:
    print(f"   ❌ BLOCKED by mountain {earth_block_dist}km away (Peak: {earth_block_elev}m).")
elif earth_elev < 0:
    print("   📡 BLOCKED by horizon (Moon curvature).")
else:
    print("   ✅ CLEAR LINE OF SIGHT! Comms online.")
print("="*50 + "\n")