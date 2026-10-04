from __future__ import annotations

import csv
import io
import math
import os
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import spiceypy as spice
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

# ============================================================
# CLPS Lunar Mission Browser — mission-analysis backend
# NASA NAIF SPICE + LRO LOLA DEM
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
LOLA_PATH = DATA_DIR / "lola" / "ldem_4.img"
SPICE_DIR = DATA_DIR / "spice"

MOON_RADIUS_KM = 1737.4
SUN_ANGULAR_RADIUS_DEG = 0.2666
EARTH_ANGULAR_RADIUS_DEG = 0.95
DEM_ROWS = 720
DEM_COLS = 1440
DEM_PIXELS_PER_DEG = 4.0

app = FastAPI(
    title="CLPS Lunar Mission Browser API",
    version="2.0.0",
    description="Decision-support geometry engine for lunar South Pole landing-site analysis.",
)

# Local development defaults. Restrict this list for deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

terrain: np.ndarray | None = None
KERNELS_LOADED = False
KERNEL_STATUS: dict[str, Any] = {}


def load_data() -> None:
    global terrain, KERNELS_LOADED, KERNEL_STATUS

    if not LOLA_PATH.exists():
        raise RuntimeError(f"LOLA DEM not found: {LOLA_PATH}")

    expected = DEM_ROWS * DEM_COLS
    raw = np.fromfile(LOLA_PATH, dtype=">i2")
    if raw.size != expected:
        raise RuntimeError(
            f"Unexpected LOLA DEM size: {raw.size} samples; expected {expected} "
            f"for the configured 4 ppd global grid. Verify the product metadata."
        )

    terrain_raw = raw.reshape((DEM_ROWS, DEM_COLS)).astype(np.float32) * 0.5
    invalid = (~np.isfinite(terrain_raw)) | (terrain_raw > 10000) | (terrain_raw < -10000)
    terrain = np.where(invalid, np.nan, terrain_raw)

    kernel_files = [
        "naif0012.tls",
        "pck00010.tpc",
        "moon_pa_de421_1900-2050.bpc",
        "de432s.bsp",
    ]
    for name in kernel_files:
        path = SPICE_DIR / name
        if not path.exists():
            raise RuntimeError(f"SPICE kernel not found: {path}")
        spice.furnsh(str(path))

    KERNELS_LOADED = True
    KERNEL_STATUS = {
        "time_kernel": "naif0012.tls",
        "planetary_constants": "pck00010.tpc",
        "lunar_orientation": "moon_pa_de421_1900-2050.bpc",
        "ephemeris": "de432s.bsp",
        "coverage_note": "Configured SPICE set supports the current 2026 mission dates.",
    }


try:
    load_data()
except Exception as exc:
    # Keep the server importable so /api/health can explain the failure.
    KERNEL_STATUS = {"startup_error": str(exc)}


# ----------------------------- validation -----------------------------

def normalize_lon(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


def validate_lat_lon(lat: float, lon: float) -> tuple[float, float]:
    if not math.isfinite(lat) or not -90.0 <= lat <= 90.0:
        raise HTTPException(422, "Latitude must be between -90 and 90 degrees.")
    if not math.isfinite(lon):
        raise HTTPException(422, "Longitude must be a finite number.")
    return float(lat), normalize_lon(float(lon))


def parse_utc(value: str) -> datetime:
    try:
        raw = value.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(422, f"Invalid ISO date/time: {value}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def require_engine() -> None:
    if terrain is None or not KERNELS_LOADED:
        detail = KERNEL_STATUS.get("startup_error", "Scientific data engine is not ready.")
        raise HTTPException(503, detail)


# ----------------------------- terrain -----------------------------

def terrain_indices(lat: float, lon: float) -> tuple[int, int]:
    # Configured for the standard global 4 pixels/degree equirectangular DEM.
    # row 0 = +90°, row 719 approaches -90°; longitude wraps globally.
    row = int((90.0 - lat) * DEM_PIXELS_PER_DEG)
    col = int(((lon % 360.0) * DEM_PIXELS_PER_DEG))
    row = max(0, min(DEM_ROWS - 1, row))
    col = col % DEM_COLS
    return row, col


def get_terrain_elevation(lat: float, lon: float) -> float:
    require_engine()
    row, col = terrain_indices(lat, lon)
    value = float(terrain[row, col])  # type: ignore[index]
    return 0.0 if not math.isfinite(value) else value


def get_surface_position(lat: float, lon: float, elevation_m: float) -> np.ndarray:
    r = MOON_RADIUS_KM + elevation_m / 1000.0
    lat_r = math.radians(lat)
    lon_r = math.radians(lon)
    return np.array(
        [
            r * math.cos(lat_r) * math.cos(lon_r),
            r * math.cos(lat_r) * math.sin(lon_r),
            r * math.sin(lat_r),
        ],
        dtype=float,
    )


def destination_point(lat: float, lon: float, azimuth_deg: float, distance_km: float) -> tuple[float, float]:
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    az = math.radians(azimuth_deg)
    angular = distance_km / MOON_RADIUS_KM

    sin_lat2 = math.sin(lat1) * math.cos(angular) + math.cos(lat1) * math.sin(angular) * math.cos(az)
    lat2 = math.asin(max(-1.0, min(1.0, sin_lat2)))
    lon2 = lon1 + math.atan2(
        math.sin(az) * math.sin(angular) * math.cos(lat1),
        math.cos(angular) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), normalize_lon(math.degrees(lon2))


# ----------------------------- geometry -----------------------------

def local_basis(observer: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    up = observer / np.linalg.norm(observer)
    # Geographic north is the projection of the spin axis onto the local tangent plane.
    pole = np.array([0.0, 0.0, 1.0])
    north = pole - np.dot(pole, up) * up
    if np.linalg.norm(north) < 1e-10:
        north = np.array([1.0, 0.0, 0.0])
    north /= np.linalg.norm(north)
    east = np.cross(north, up)
    east /= np.linalg.norm(east)
    return up, east, north


def az_el(target_pos: np.ndarray, observer_pos: np.ndarray) -> tuple[float, float]:
    up, east, north = local_basis(observer_pos)
    v = target_pos - observer_pos
    v /= np.linalg.norm(v)
    elevation = math.degrees(math.asin(max(-1.0, min(1.0, float(np.dot(v, up))))))
    azimuth = math.degrees(math.atan2(float(np.dot(v, east)), float(np.dot(v, north)))) % 360.0
    return elevation, azimuth


def spice_vector(body: str, dt: datetime, observer: str = "MOON") -> np.ndarray:
    et = spice.datetime2et(dt)
    pos, _lt = spice.spkpos(body, et, "IAU_MOON", "LT+S", observer)
    return np.asarray(pos, dtype=float)


# ----------------------------- terrain LOS -----------------------------

def check_terrain_blockage(
    start_lat: float,
    start_lon: float,
    azimuth_deg: float,
    target_elevation_deg: float,
    observer_elevation_m: float,
    target_type: str,
) -> dict[str, Any]:
    angular_radius = {
        "SUN": SUN_ANGULAR_RADIUS_DEG,
        "EARTH": EARTH_ANGULAR_RADIUS_DEG,
    }.get(target_type.upper(), 0.0)

    # A disk target is visible if its upper limb can clear the terrain horizon.
    required = target_elevation_deg + angular_radius
    max_terrain_angle = -90.0
    blocking_distance = None
    blocking_elevation = None

    # Adaptive spacing: dense near the lander where narrow ridges matter, coarser farther out.
    distances = list(np.arange(0.25, 5.0, 0.25))
    distances += list(np.arange(5.0, 20.0, 0.5))
    distances += list(np.arange(20.0, 50.1, 1.0))

    for distance_km in distances:
        sample_lat, sample_lon = destination_point(start_lat, start_lon, azimuth_deg, float(distance_km))
        sample_elev_m = get_terrain_elevation(sample_lat, sample_lon)
        curvature_drop_km = (distance_km * distance_km) / (2.0 * MOON_RADIUS_KM)
        height_diff_km = (sample_elev_m - observer_elevation_m) / 1000.0 - curvature_drop_km
        terrain_angle = math.degrees(math.atan2(height_diff_km, distance_km))
        max_terrain_angle = max(max_terrain_angle, terrain_angle)

        if terrain_angle > required:
            blocking_distance = round(float(distance_km), 3)
            blocking_elevation = round(float(sample_elev_m), 2)
            return {
                "blocked": True,
                "max_terrain_angle_deg": round(max_terrain_angle, 4),
                "blocking_distance_km": blocking_distance,
                "blocking_elevation_m": blocking_elevation,
                "required_clearance_deg": round(required, 4),
            }

    return {
        "blocked": False,
        "max_terrain_angle_deg": round(max_terrain_angle, 4),
        "blocking_distance_km": None,
        "blocking_elevation_m": None,
        "required_clearance_deg": round(required, 4),
    }


# ----------------------------- point analysis -----------------------------

def analyze_point(lat: float, lon: float, dt: datetime) -> dict[str, Any]:
    lat, lon = validate_lat_lon(lat, lon)
    elevation = get_terrain_elevation(lat, lon)
    observer = get_surface_position(lat, lon, elevation)

    sun = spice_vector("SUN", dt)
    earth = spice_vector("EARTH", dt)
    sun_el, sun_az = az_el(sun, observer)
    earth_el, earth_az = az_el(earth, observer)

    sun_los = check_terrain_blockage(lat, lon, sun_az, sun_el, elevation, "SUN")
    earth_los = check_terrain_blockage(lat, lon, earth_az, earth_el, elevation, "EARTH")

    sun_horizon = sun_el >= -SUN_ANGULAR_RADIUS_DEG
    earth_horizon = earth_el >= -EARTH_ANGULAR_RADIUS_DEG
    sun_visible = bool(sun_horizon and not sun_los["blocked"])
    earth_visible = bool(earth_horizon and not earth_los["blocked"])

    if not sun_horizon:
        sun_status = "HORIZON_NIGHT"
    elif sun_los["blocked"]:
        sun_status = "BLOCKED_BY_TERRAIN"
    else:
        sun_status = "VISIBLE"

    if not earth_horizon:
        earth_status = "BELOW_HORIZON"
    elif earth_los["blocked"]:
        earth_status = "BLOCKED_BY_TERRAIN"
    else:
        earth_status = "VISIBLE"

    return {
        "timestamp_utc": dt.isoformat().replace("+00:00", "Z"),
        "latitude_deg": round(lat, 6),
        "longitude_deg": round(lon, 6),
        "terrain_elevation_m": round(elevation, 2),
        "sun": {
            "azimuth_deg": round(sun_az, 3),
            "elevation_deg": round(sun_el, 3),
            "angular_radius_deg": SUN_ANGULAR_RADIUS_DEG,
            "status": sun_status,
            "visible": sun_visible,
            "terrain": sun_los,
        },
        "earth": {
            "azimuth_deg": round(earth_az, 3),
            "elevation_deg": round(earth_el, 3),
            "angular_radius_deg": EARTH_ANGULAR_RADIUS_DEG,
            "status": earth_status,
            "visible": earth_visible,
            "terrain": earth_los,
        },
        "model": {
            "dem": "LRO LOLA global 4 pixels/degree configuration",
            "dem_resolution_note": "Verify product metadata before operational scientific use.",
            "spice_frame": "IAU_MOON",
            "time_scale": "UTC",
            "terrain_horizon_range_km": 50.0,
            "terrain_method": "adaptive great-circle sampling with lunar curvature",
        },
    }


# ----------------------------- mission analysis -----------------------------

def run_mission(
    lat: float,
    lon: float,
    start: datetime,
    days: int,
    step_minutes: int,
    include_vectors: bool = False,
) -> dict[str, Any]:
    if days < 1 or days > 90:
        raise HTTPException(422, "Mission duration must be between 1 and 90 days.")
    if step_minutes not in (10, 30, 60):
        raise HTTPException(422, "Analysis resolution must be 10, 30, or 60 minutes.")

    total_steps = int(days * 24 * 60 / step_minutes)
    solar_timeline: list[dict[str, Any]] = []
    comm_timeline: list[dict[str, Any]] = []
    solar_visible = 0
    comm_visible = 0
    solar_outage = 0
    comm_outage = 0
    max_solar_outage = 0
    max_comm_outage = 0
    current_solar_outage = 0
    current_comm_outage = 0
    solar_outage_count = 0
    comm_outage_count = 0

    for i in range(total_steps):
        dt = start + timedelta(minutes=i * step_minutes)
        result = analyze_point(lat, lon, dt)
        s = bool(result["sun"]["visible"])
        e = bool(result["earth"]["visible"])

        if s:
            solar_visible += 1
            if current_solar_outage:
                max_solar_outage = max(max_solar_outage, current_solar_outage)
                current_solar_outage = 0
        else:
            solar_outage += 1
            if current_solar_outage == 0:
                solar_outage_count += 1
            current_solar_outage += 1

        if e:
            comm_visible += 1
            if current_comm_outage:
                max_comm_outage = max(max_comm_outage, current_comm_outage)
                current_comm_outage = 0
        else:
            comm_outage += 1
            if current_comm_outage == 0:
                comm_outage_count += 1
            current_comm_outage += 1

        solar_timeline.append({
            "timestamp_utc": result["timestamp_utc"],
            "available": s,
            "elevation_deg": result["sun"]["elevation_deg"],
            "azimuth_deg": result["sun"]["azimuth_deg"],
            "status": result["sun"]["status"],
        })
        comm_timeline.append({
            "timestamp_utc": result["timestamp_utc"],
            "available": e,
            "elevation_deg": result["earth"]["elevation_deg"],
            "azimuth_deg": result["earth"]["azimuth_deg"],
            "status": result["earth"]["status"],
        })

    max_solar_outage = max(max_solar_outage, current_solar_outage)
    max_comm_outage = max(max_comm_outage, current_comm_outage)
    hours_per_step = step_minutes / 60.0
    total_hours = days * 24.0

    return {
        "latitude_deg": lat,
        "longitude_deg": lon,
        "start_date_utc": start.isoformat().replace("+00:00", "Z"),
        "duration_days": days,
        "step_minutes": step_minutes,
        "sample_count": total_steps,
        "solar_access_percent": round(100.0 * solar_visible / total_steps, 2),
        "communication_access_percent": round(100.0 * comm_visible / total_steps, 2),
        "max_solar_outage_hours": round(max_solar_outage * hours_per_step, 2),
        "max_comm_outage_hours": round(max_comm_outage * hours_per_step, 2),
        "solar_outage_count": solar_outage_count,
        "comm_outage_count": comm_outage_count,
        "average_solar_outage_hours": round((solar_outage / max(1, solar_outage_count)) * hours_per_step, 2),
        "average_comm_outage_hours": round((comm_outage / max(1, comm_outage_count)) * hours_per_step, 2),
        "total_analysis_hours": total_hours,
        "solar_timeline": solar_timeline,
        "comm_timeline": comm_timeline,
    }


# ----------------------------- scoring / scan -----------------------------

def mission_score(stats: dict[str, Any]) -> dict[str, Any]:
    solar = stats["solar_access_percent"]
    comm = stats["communication_access_percent"]
    solar_reliability = max(0.0, 100.0 - (stats["max_solar_outage_hours"] / 24.0) * 4.0)
    comm_reliability = max(0.0, 100.0 - (stats["max_comm_outage_hours"] / 24.0) * 4.0)

    # Explainable weighted score: availability dominates; long outages reduce reliability.
    score = (
        solar * 0.40
        + comm * 0.30
        + solar_reliability * 0.15
        + comm_reliability * 0.15
    )
    return {
        "score": round(max(0.0, min(100.0, score)), 2),
        "solar_component": round(solar * 0.40, 2),
        "communication_component": round(comm * 0.30, 2),
        "solar_reliability_component": round(solar_reliability * 0.15, 2),
        "communication_reliability_component": round(comm_reliability * 0.15, 2),
    }


def candidate_grid(center_lat: float, center_lon: float, radius_deg: float, spacing_deg: float) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    steps = int(math.floor(radius_deg / spacing_deg))
    for y in range(-steps, steps + 1):
        for x in range(-steps, steps + 1):
            lat = center_lat + y * spacing_deg
            lon = normalize_lon(center_lon + x * spacing_deg)
            if lat < -90.0 or lat > 90.0:
                continue
            # Circular region rather than a square.
            if math.hypot(y, x) <= steps + 0.01:
                points.append((round(lat, 5), round(lon, 5)))
    return points


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok" if terrain is not None and KERNELS_LOADED else "degraded",
        "engine_ready": terrain is not None and KERNELS_LOADED,
        "dem": {
            "file": str(LOLA_PATH),
            "shape": [DEM_ROWS, DEM_COLS],
            "pixels_per_degree": DEM_PIXELS_PER_DEG,
            "format": "big-endian int16, 0.5 m scale",
        },
        "spice": KERNEL_STATUS,
    }


@app.get("/api/data-info")
def data_info() -> dict[str, Any]:
    return {
        "data_sources": [
            {"name": "NASA NAIF LSK", "file": "naif0012.tls", "role": "time conversion"},
            {"name": "NASA NAIF PCK", "file": "pck00010.tpc", "role": "planetary constants"},
            {"name": "NASA NAIF lunar orientation", "file": "moon_pa_de421_1900-2050.bpc", "role": "Moon orientation"},
            {"name": "NASA NAIF SPK", "file": "de432s.bsp", "role": "Sun/Earth ephemerides"},
            {"name": "LRO LOLA / USGS Astrogeology", "file": "ldem_4.img", "role": "lunar terrain"},
        ],
        "method": [
            "SPICE vectors are evaluated in the IAU_MOON frame.",
            "Sun/Earth local azimuth and elevation are calculated from the selected lunar surface point.",
            "Terrain LOS uses great-circle sampling, lunar curvature, and approximate target angular radii.",
            "Mission statistics are sampled at the selected UTC resolution.",
        ],
        "limitations": [
            "The configured DEM is a 4 pixels/degree global equirectangular grid; verify the supplied product metadata before operational use.",
            "Solar access is Sun visibility, not a spacecraft electrical-power simulation.",
            "Communication access is geometric direct-to-Earth visibility and does not model antenna, relay, link budget, or spacecraft operations.",
            "Terrain LOS is an approximation based on DEM sampling and a 50 km search horizon.",
        ],
    }


@app.get("/api/visibility")
def visibility(
    lat: float = Query(...),
    lon: float = Query(...),
    date: str = Query("2026-11-14T09:00:00Z"),
) -> dict[str, Any]:
    require_engine()
    dt = parse_utc(date)
    return analyze_point(lat, lon, dt)


@app.get("/api/mission-analysis")
def mission_analysis(
    lat: float = Query(...),
    lon: float = Query(...),
    start_date: str = Query(...),
    days: int = Query(14, ge=1, le=90),
    step_minutes: int = Query(10),
) -> dict[str, Any]:
    require_engine()
    start = parse_utc(start_date)
    return run_mission(*validate_lat_lon(lat, lon), start, days, step_minutes)


@app.get("/api/horizon-profile")
def horizon_profile(
    lat: float = Query(...),
    lon: float = Query(...),
    samples: int = Query(72, ge=36, le=360),
    radius_km: float = Query(30.0, gt=1, le=50),
) -> dict[str, Any]:
    require_engine()
    lat, lon = validate_lat_lon(lat, lon)
    elevation = get_terrain_elevation(lat, lon)
    profile = []
    for i in range(samples):
        az = i * 360.0 / samples
        max_angle = -90.0
        max_distance = 0.0
        steps = np.linspace(0.25, radius_km, min(120, max(20, int(radius_km * 4))))
        for distance in steps:
            slat, slon = destination_point(lat, lon, az, float(distance))
            h = get_terrain_elevation(slat, slon)
            curvature = (float(distance) ** 2) / (2 * MOON_RADIUS_KM)
            angle = math.degrees(math.atan2((h - elevation) / 1000.0 - curvature, float(distance)))
            if angle > max_angle:
                max_angle = angle
                max_distance = float(distance)
        profile.append({"azimuth_deg": round(az, 2), "horizon_elevation_deg": round(max_angle, 3), "distance_km": round(max_distance, 2)})
    return {"latitude_deg": lat, "longitude_deg": lon, "profile": profile}


@app.get("/api/scan-region")
def scan_region(
    center_lat: float = Query(...),
    center_lon: float = Query(...),
    start_date: str = Query(...),
    days: int = Query(14, ge=1, le=30),
    radius_deg: float = Query(1.5, gt=0.25, le=5.0),
    candidates: int = Query(49, ge=9, le=100),
) -> dict[str, Any]:
    require_engine()
    center_lat, center_lon = validate_lat_lon(center_lat, center_lon)
    start = parse_utc(start_date)

    # Generate a deterministic candidate set and cap it to the requested count.
    spacing = max(0.12, radius_deg * 1.5 / max(2.0, math.sqrt(candidates)))
    points = candidate_grid(center_lat, center_lon, radius_deg, spacing)
    points.sort(key=lambda p: (p[0] - center_lat) ** 2 + (p[1] - center_lon) ** 2)
    points = points[:candidates]

    # Stage 1: fast screening.
    screened = []
    for plat, plon in points:
        stats = run_mission(plat, plon, start, days, 60)
        score = mission_score(stats)
        screened.append({
            "latitude_deg": plat,
            "longitude_deg": plon,
            "score": score["score"],
            "solar_access_percent": stats["solar_access_percent"],
            "communication_access_percent": stats["communication_access_percent"],
            "max_solar_outage_hours": stats["max_solar_outage_hours"],
            "max_comm_outage_hours": stats["max_comm_outage_hours"],
            "screening_resolution_minutes": 60,
        })

    screened.sort(key=lambda x: x["score"], reverse=True)
    finalists = screened[: min(10, len(screened))]

    # Stage 2: accurate refinement.
    refined = []
    for candidate in finalists:
        stats = run_mission(candidate["latitude_deg"], candidate["longitude_deg"], start, days, 10)
        score = mission_score(stats)
        refined.append({
            "rank": 0,
            "latitude_deg": candidate["latitude_deg"],
            "longitude_deg": candidate["longitude_deg"],
            "score": score["score"],
            "score_breakdown": score,
            "solar_access_percent": stats["solar_access_percent"],
            "communication_access_percent": stats["communication_access_percent"],
            "max_solar_outage_hours": stats["max_solar_outage_hours"],
            "max_comm_outage_hours": stats["max_comm_outage_hours"],
            "terrain_elevation_m": get_terrain_elevation(candidate["latitude_deg"], candidate["longitude_deg"]),
            "analysis_resolution_minutes": 10,
        })

    refined.sort(key=lambda x: x["score"], reverse=True)
    for i, item in enumerate(refined, 1):
        item["rank"] = i

    recommendation = None
    if refined:
        best = refined[0]
        recommendation = {
            "rank": 1,
            "latitude_deg": best["latitude_deg"],
            "longitude_deg": best["longitude_deg"],
            "score": best["score"],
            "why": (
                f"Ranked #1 with {best['solar_access_percent']:.1f}% Sun visibility and "
                f"{best['communication_access_percent']:.1f}% Earth visibility over the selected mission. "
                f"Longest modeled Sun outage is {best['max_solar_outage_hours']:.1f} h and longest modeled "
                f"communication blackout is {best['max_comm_outage_hours']:.1f} h."
            ),
        }

    return {
        "center": {"latitude_deg": center_lat, "longitude_deg": center_lon},
        "radius_deg": radius_deg,
        "duration_days": days,
        "screened_candidate_count": len(screened),
        "refined_candidate_count": len(refined),
        "screening_resolution_minutes": 60,
        "refinement_resolution_minutes": 10,
        "recommended_sites": refined[:3],
        "recommendation": recommendation,
        "all_refined_sites": refined,
    }


@app.get("/api/site-report.csv", response_class=PlainTextResponse)
def site_report_csv(
    lat: float = Query(...),
    lon: float = Query(...),
    start_date: str = Query(...),
    days: int = Query(14, ge=1, le=30),
) -> str:
    require_engine()
    lat, lon = validate_lat_lon(lat, lon)
    stats = run_mission(lat, lon, parse_utc(start_date), days, 10)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Metric", "Value"])
    writer.writerow(["Latitude (deg)", lat])
    writer.writerow(["Longitude (deg)", lon])
    writer.writerow(["Mission duration (days)", days])
    writer.writerow(["Solar access (%)", stats["solar_access_percent"]])
    writer.writerow(["Earth communication access (%)", stats["communication_access_percent"]])
    writer.writerow(["Max solar outage (hours)", stats["max_solar_outage_hours"]])
    writer.writerow(["Max communication blackout (hours)", stats["max_comm_outage_hours"]])
    writer.writerow(["Solar outage count", stats["solar_outage_count"]])
    writer.writerow(["Communication blackout count", stats["comm_outage_count"]])
    return output.getvalue()


@app.on_event("shutdown")
def shutdown() -> None:
    try:
        spice.kclear()
    except Exception:
        pass
