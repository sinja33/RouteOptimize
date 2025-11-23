"""
Build distance and time matrices from coordinates using OSRM Table API.
No geocoding required—reads coordinates directly from CSV.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests


def load_coordinates(csv_path: Path, depot_lat: float, depot_lon: float) -> tuple[list[str], list[tuple[float, float]]]:
    """
    Load coordinates from CSV with depot as first location.
    Returns (labels, coordinates) where coordinates[0] is the depot.
    """
    df = pd.read_csv(csv_path, sep=";", decimal=",")
    
    # Clean column names (remove spaces)
    df.columns = df.columns.str.strip()
    
    labels = ["DEPOT"]
    coordinates = [(depot_lat, depot_lon)]
    
    # Handle different column name formats
    lat_col = 'lat' if 'lat' in df.columns else 'Latitude'
    lon_col = 'lng' if 'lng' in df.columns else 'Longitude'
    
    for _, row in df.iterrows():
        order_id = str(row["OrderID"]).strip()
        
        # Skip orders with missing coordinates
        if pd.isna(row[lat_col]) or pd.isna(row[lon_col]):
            print(f"  ⚠️  Skipping {order_id}: missing coordinates")
            continue
            
        lat = float(str(row[lat_col]).replace(",", "."))
        lon = float(str(row[lon_col]).replace(",", "."))
        
        labels.append(order_id)
        coordinates.append((lat, lon))
    
    return labels, coordinates


def build_matrix_osrm(
    coordinates: list[tuple[float, float]],
    osrm_base_url: str = "https://router.project-osrm.org",
    batch_size: int = 100,
    delay_seconds: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Build full NxN distance and time matrices using OSRM Table API.
    
    Returns:
        distance_matrix: meters (NxN)
        time_matrix: minutes (NxN)
    """
    n = len(coordinates)
    distance_matrix = np.zeros((n, n))
    time_matrix = np.zeros((n, n))
    
    # OSRM Table API accepts up to ~100 locations per request
    # For larger sets, we need to batch
    if n <= batch_size:
        # Single request
        print(f"Fetching matrix for {n} locations in one request...")
        dist, dur = _fetch_osrm_table(coordinates, osrm_base_url)
        distance_matrix = dist
        time_matrix = dur / 60.0  # convert seconds to minutes
    else:
        # Batch requests using source/destination indices
        print(f"Fetching matrix for {n} locations in batches of {batch_size}...")
        total_batches = ((n + batch_size - 1) // batch_size) ** 2
        batch_count = 0
        
        for i in range(0, n, batch_size):
            for j in range(0, n, batch_size):
                i_end = min(i + batch_size, n)
                j_end = min(j + batch_size, n)
                
                batch_count += 1
                print(f"  Batch {batch_count}/{total_batches}: origins {i}..{i_end-1}, destinations {j}..{j_end-1}")
                
                # Fetch sub-matrix for this batch
                dist_batch, dur_batch = _fetch_osrm_table_batch(
                    coordinates,
                    source_indices=list(range(i, i_end)),
                    dest_indices=list(range(j, j_end)),
                    osrm_base_url=osrm_base_url,
                )
                
                # Fill in the corresponding block
                distance_matrix[i:i_end, j:j_end] = dist_batch
                time_matrix[i:i_end, j:j_end] = dur_batch / 60.0  # seconds to minutes
                
                if batch_count < total_batches:
                    time.sleep(delay_seconds)
    
    return distance_matrix, time_matrix


def _fetch_osrm_table(
    coordinates: list[tuple[float, float]],
    osrm_base_url: str,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Fetch OSRM table for given coordinates.
    Returns (distance_matrix_meters, duration_matrix_seconds).
    """
    # Build coordinate string: lon,lat;lon,lat;...
    coord_str = ";".join(f"{lon},{lat}" for lat, lon in coordinates)
    
    url = f"{osrm_base_url}/table/v1/driving/{coord_str}"
    params = {
        "annotations": "distance,duration",
    }
    
    print(f"  Calling OSRM Table API with {len(coordinates)} locations...")
    response = requests.get(url, params=params, timeout=300)
    
    if response.status_code != 200:
        raise RuntimeError(
            f"OSRM Table API failed ({response.status_code}): {response.text}"
        )
    
    data = response.json()
    
    if data.get("code") != "Ok":
        raise RuntimeError(f"OSRM returned error: {data}")
    
    # Extract matrices
    distances = np.array(data["distances"])  # meters
    durations = np.array(data["durations"])  # seconds
    
    return distances, durations


def _fetch_osrm_table_batch(
    coordinates: list[tuple[float, float]],
    source_indices: list[int],
    dest_indices: list[int],
    osrm_base_url: str,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Fetch OSRM table for a subset of origins and destinations.
    
    Instead of passing all coordinates and using source/dest indices (which causes 414 errors),
    we only send the needed coordinates and remap internally.
    
    Args:
        coordinates: Full list of all coordinates
        source_indices: Indices of origin locations
        dest_indices: Indices of destination locations
        osrm_base_url: OSRM server URL
        
    Returns:
        distance_matrix: (len(source_indices), len(dest_indices)) in meters
        duration_matrix: (len(source_indices), len(dest_indices)) in seconds
    """
    # Handle edge case: if source == dest and only 1 location, return zeros
    if len(source_indices) == 1 and len(dest_indices) == 1 and source_indices[0] == dest_indices[0]:
        # Distance/time from a location to itself is 0
        return np.array([[0.0]]), np.array([[0.0]])
    
    # Extract only the coordinates we need
    # Combine sources and destinations, keeping track of which is which
    needed_indices = list(set(source_indices + dest_indices))
    needed_coords = [coordinates[i] for i in needed_indices]
    
    # OSRM requires at least 2 coordinates - if we only have 1, duplicate it
    if len(needed_coords) == 1:
        needed_coords.append(needed_coords[0])
        needed_indices.append(needed_indices[0])
    
    # Build mapping from original index to position in needed_coords
    index_map = {orig_idx: new_idx for new_idx, orig_idx in enumerate(needed_indices)}
    
    # Remap source and destination indices
    remapped_sources = [index_map[i] for i in source_indices]
    remapped_dests = [index_map[i] for i in dest_indices]
    
    # Build coordinate string with only needed locations
    coord_str = ";".join(f"{lon},{lat}" for lat, lon in needed_coords)
    
    url = f"{osrm_base_url}/table/v1/driving/{coord_str}"
    
    # Use remapped indices
    sources_str = ";".join(str(i) for i in remapped_sources)
    destinations_str = ";".join(str(i) for i in remapped_dests)
    
    params = {
        "sources": sources_str,
        "destinations": destinations_str,
        "annotations": "distance,duration",
    }
    
    response = requests.get(url, params=params, timeout=300)
    
    if response.status_code != 200:
        raise RuntimeError(
            f"OSRM Table API failed ({response.status_code}): {response.text}"
        )
    
    data = response.json()
    
    if data.get("code") != "Ok":
        raise RuntimeError(f"OSRM returned error: {data}")
    
    # Extract matrices
    distances = np.array(data["distances"])  # meters
    durations = np.array(data["durations"])  # seconds
    
    return distances, durations


def save_matrices(
    distance_matrix: np.ndarray,
    time_matrix: np.ndarray,
    labels: list[str],
    coordinates: list[tuple[float, float]],
    output_dir: Path,
) -> None:
    """Save matrices and metadata to disk."""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Save numpy arrays
    np.save(output_dir / "distance_matrix.npy", distance_matrix)
    np.save(output_dir / "time_matrix_minutes.npy", time_matrix)
    
    # Save as CSV
    pd.DataFrame(distance_matrix).to_csv(
        output_dir / "distance_matrix.csv", index=False, header=False
    )
    pd.DataFrame(time_matrix).to_csv(
        output_dir / "time_matrix_minutes.csv", index=False, header=False
    )
    
    # Save locations metadata
    locations_meta = [
        {
            "index": i,
            "label": labels[i],
            "latitude": coordinates[i][0],
            "longitude": coordinates[i][1],
        }
        for i in range(len(labels))
    ]
    
    with open(output_dir / "locations.json", "w") as f:
        json.dump(locations_meta, f, indent=2)
    
    print(f"\n✓ Matrices saved to {output_dir}/")
    print(f"  - distance_matrix.npy ({distance_matrix.shape})")
    print(f"  - distance_matrix.csv")
    print(f"  - time_matrix_minutes.npy ({time_matrix.shape})")
    print(f"  - time_matrix_minutes.csv")
    print(f"  - locations.json ({len(labels)} locations)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build distance/time matrices from coordinates using OSRM"
    )
    parser.add_argument(
        "--orders-csv",
        type=Path,
        default=Path("Vehicle Assignments-Table 1.csv"),
        help="Path to CSV with OrderID, Latitude, Longitude columns",
    )
    parser.add_argument(
        "--depot-lat",
        type=float,
        default=46.223771,
        help="Depot latitude (default: Ljubljana airport area)",
    )
    parser.add_argument(
        "--depot-lon",
        type=float,
        default=14.457964,
        help="Depot longitude",
    )
    parser.add_argument(
        "--osrm-base-url",
        type=str,
        default="https://router.project-osrm.org",
        help="OSRM server base URL",
    )
    parser.add_argument(
        "--osrm-batch-size",
        type=int,
        default=100,
        help="Max locations per OSRM request (public server limit ~100)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Delay between OSRM requests (seconds)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("matrix_osrm"),
        help="Output directory for matrices",
    )
    
    args = parser.parse_args()
    
    print(f"Loading coordinates from {args.orders_csv}...")
    labels, coordinates = load_coordinates(
        args.orders_csv,
        args.depot_lat,
        args.depot_lon,
    )
    
    print(f"Loaded {len(coordinates)} locations (depot + {len(coordinates)-1} orders)")
    
    if len(coordinates) > args.osrm_batch_size:
        print(
            f"\n⚠️  WARNING: {len(coordinates)} locations exceed OSRM batch size {args.osrm_batch_size}."
        )
        print("   Public OSRM server may reject the request.")
        print("   Consider running your own OSRM instance or reducing order count.")
        print()
    
    distance_matrix, time_matrix = build_matrix_osrm(
        coordinates,
        osrm_base_url=args.osrm_base_url,
        batch_size=args.osrm_batch_size,
        delay_seconds=args.delay,
    )
    
    # Convert to integers before saving
    distance_matrix_int = distance_matrix.astype(int)
    time_matrix_int = np.round(time_matrix).astype(int)
    
    save_matrices(
        distance_matrix_int,
        time_matrix_int,
        labels,
        coordinates,
        args.output_dir,
    )
    
    print("\n✓ Matrix build complete!")


if __name__ == "__main__":
    main()

