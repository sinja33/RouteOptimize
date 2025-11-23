"""
Solve VRPTW using pre-computed matrices and your delivery fleet.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from ortools.constraint_solver import pywrapcp, routing_enums_pb2


@dataclass
class Order:
    order_id: str
    demand_kg: float
    priority: str
    window_start: int  # minutes from midnight
    window_end: int
    service_minutes: int


@dataclass
class Vehicle:
    vehicle_id: str
    vehicle_type: str
    capacity_kg: float
    fuel_type: str
    emission_g_co2_per_km: float


def time_str_to_minutes(time_str: str) -> int:
    """Convert HH:MM or HH:MM:SS to minutes from midnight."""
    parts = str(time_str).split(':')
    return int(parts[0]) * 60 + int(parts[1])


def minutes_to_hhmm(minutes: int) -> str:
    """Convert minutes from midnight to HH:MM."""
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"


def load_orders(csv_path: Path) -> list[Order]:
    """Load orders from CSV."""
    df = pd.read_csv(csv_path, sep=';', decimal=',')
    
    # Clean column names
    df.columns = df.columns.str.strip()
    
    # All deliveries take 3 minutes
    priority_service_times = {
        'urgent': 3,
        'express': 3,
        'standard': 3,
    }
    
    orders = []
    invalid_orders = []
    
    for idx, row in df.iterrows():
        try:
            priority = str(row.get('Priority', 'standard')).strip().lower()
            
            # Handle both column name formats
            weight_col = 'Weight_kg' if 'Weight_kg' in df.columns else 'Weight(kg)'
            
            order_id = str(row['OrderID']).strip()
            window_start = time_str_to_minutes(row['WindowStart'])
            window_end = time_str_to_minutes(row['WindowEnd'])
            
            # Validate time window
            if window_start >= window_end:
                invalid_orders.append(f"{order_id}: start ({window_start}) >= end ({window_end})")
                continue
            
            if window_start < 0 or window_end < 0:
                invalid_orders.append(f"{order_id}: negative time values")
                continue
            
            if window_end > 1440:  # 24 hours
                invalid_orders.append(f"{order_id}: window_end > 24 hours ({window_end})")
                continue
            
            orders.append(Order(
                order_id=order_id,
                demand_kg=float(str(row[weight_col]).replace(',', '.')),
                priority=priority,
                window_start=window_start,
                window_end=window_end,
                service_minutes=priority_service_times.get(priority, 5),
            ))
        except Exception as e:
            invalid_orders.append(f"{row.get('OrderID', f'row {idx}')}: {str(e)}")
    
    if invalid_orders:
        print(f"\n⚠️  Skipped {len(invalid_orders)} invalid orders:")
        for err in invalid_orders[:10]:
            print(f"    - {err}")
        if len(invalid_orders) > 10:
            print(f"    ... and {len(invalid_orders) - 10} more")
        print()
    
    return orders


def get_hardcoded_fleet() -> list[Vehicle]:
    """Return hardcoded fleet of 20 vehicles."""
    return [
        Vehicle('V001', 'truck', 7156.0, 'diesel', 300.0),
        Vehicle('V002', 'truck', 7319.0, 'diesel', 300.0),
        Vehicle('V003', 'truck', 4674.0, 'diesel', 300.0),
        Vehicle('V004', 'bike', 33.0, 'electric', 0.0),
        Vehicle('V005', 'van', 1102.0, 'electric', 0.0),
        Vehicle('V006', 'truck', 5317.0, 'diesel', 300.0),
        Vehicle('V007', 'bike', 32.0, 'electric', 0.0),
        Vehicle('V008', 'bike', 45.0, 'electric', 0.0),
        Vehicle('V009', 'bike', 49.0, 'electric', 0.0),
        Vehicle('V010', 'van', 816.0, 'diesel', 180.0),
        Vehicle('V011', 'truck', 6619.0, 'diesel', 300.0),
        Vehicle('V012', 'truck', 6830.0, 'diesel', 300.0),
        Vehicle('V013', 'bike', 48.0, 'electric', 0.0),
        Vehicle('V014', 'truck', 6393.0, 'diesel', 300.0),
        Vehicle('V015', 'bike', 36.0, 'electric', 0.0),
        Vehicle('V016', 'bike', 32.0, 'electric', 0.0),
        Vehicle('V017', 'van', 815.0, 'electric', 0.0),
        Vehicle('V018', 'bike', 32.0, 'electric', 0.0),
        Vehicle('V019', 'bike', 41.0, 'electric', 0.0),
        Vehicle('V020', 'bike', 34.0, 'electric', 0.0),
    ]


def load_fleet(csv_path: Path) -> list[Vehicle]:
    """Load vehicles from CSV."""
    df = pd.read_csv(csv_path, sep=';', decimal=',', skiprows=1)
    
    vehicles = []
    for _, row in df.iterrows():
        if pd.notna(row.get('vehicle_id')):
            vehicles.append(Vehicle(
                vehicle_id=str(row['vehicle_id']).strip(),
                vehicle_type=str(row.get('type', 'van')).strip(),
                capacity_kg=float(str(row['max_capacity_kg']).replace(',', '.')),
                fuel_type=str(row.get('fuel_type', 'diesel')).strip(),
                emission_g_co2_per_km=float(str(row.get('emission_g_co2_per_km', 0)).replace(',', '.')),
            ))
    
    return vehicles


def solve_vrptw(
    time_matrix: np.ndarray,
    distance_matrix: np.ndarray,
    orders: list[Order],
    vehicles: list[Vehicle],
    depot_window: tuple[int, int],
    time_limit_seconds: int = 120,
) -> tuple[list[list[tuple[int, int]]], list[float], list[str]]:
    """
    Solve VRPTW with OR-Tools.
    
    Returns:
        routes: list of [(node_index, arrival_time), ...]
        distances: list of route distances in km
        unassigned: list of unassigned order IDs
    """
    n = len(time_matrix)
    manager = pywrapcp.RoutingIndexManager(n, len(vehicles), 0)
    routing = pywrapcp.RoutingModel(manager)
    
    # Service times: depot=0, then one per order
    service_times = [0] + [order.service_minutes for order in orders]
    
    def time_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        service = service_times[from_node]
        travel = int(time_matrix[from_node][to_node])
        return service + travel
    
    transit_callback_index = routing.RegisterTransitCallback(time_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)
    
    # Time dimension - use horizon large enough for full day
    # Since we use absolute times (not relative to depot start), set horizon to end of day
    horizon = 1440  # 24 hours in minutes
    
    routing.AddDimension(
        transit_callback_index,
        slack_max=240,  # Allow up to 4 hours waiting
        capacity=horizon,  # Use full day horizon
        fix_start_cumul_to_zero=False,  # Use absolute times
        name='Time',
    )
    time_dimension = routing.GetDimensionOrDie('Time')
    
    # Capacity dimension
    def demand_callback(from_index: int) -> int:
        node = manager.IndexToNode(from_index)
        if node == 0:
            return 0
        return int(orders[node - 1].demand_kg * 1000)  # grams
    
    demand_index = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimensionWithVehicleCapacity(
        demand_index,
        slack_max=0,
        vehicle_capacities=[int(v.capacity_kg * 1000) for v in vehicles],
        fix_start_cumul_to_zero=True,
        name='Capacity',
    )
    
    
    # Set time windows
    for vehicle_idx in range(len(vehicles)):
        time_dimension.CumulVar(routing.Start(vehicle_idx)).SetRange(*depot_window)
        time_dimension.CumulVar(routing.End(vehicle_idx)).SetRange(*depot_window)
    
    for idx, order in enumerate(orders, start=1):
        index = manager.NodeToIndex(idx)
        # Ensure order time windows are within depot hours
        order_start = max(order.window_start, depot_window[0])
        order_end = min(order.window_end, depot_window[1])
        
        if order_start >= order_end:
            print(f"⚠️  Warning: Order {order.order_id} has impossible time window after depot constraint")
            # Set a default window in the middle of the day
            order_start = depot_window[0] + 60  # 1 hour after opening
            order_end = depot_window[1] - 60     # 1 hour before closing
        
        try:
            time_dimension.CumulVar(index).SetRange(order_start, order_end)
        except Exception as e:
            print(f"❌ Error setting time window for {order.order_id}: {e}")
            print(f"   Window: {order_start} - {order_end}, Depot: {depot_window}")
            raise
    
    # Minimize total time and distance
    for vehicle_idx in range(len(vehicles)):
        routing.AddVariableMinimizedByFinalizer(
            time_dimension.CumulVar(routing.Start(vehicle_idx))
        )
        routing.AddVariableMinimizedByFinalizer(
            time_dimension.CumulVar(routing.End(vehicle_idx))
        )
    
    # Search parameters
    # Allow dropping visits with penalties (makes problem feasible)
    penalty = 10000000  # Very high penalty for unassigned orders
    for node in range(1, len(orders) + 1):
        routing.AddDisjunction([manager.NodeToIndex(node)], penalty)
    
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_params.time_limit.seconds = time_limit_seconds
    
    print(f"Solving VRPTW with {len(orders)} orders and {len(vehicles)} vehicles...")
    print(f"Time limit: {time_limit_seconds}s\n")
    
    solution = routing.SolveWithParameters(search_params)
    
    if not solution:
        raise RuntimeError("No feasible solution found even with relaxed constraints.")
    
    # Extract routes
    routes = []
    distances_km = []
    assigned_nodes = set()
    
    for vehicle_idx in range(len(vehicles)):
        index = routing.Start(vehicle_idx)
        route = []
        total_distance = 0
        
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            arrival = solution.Value(time_dimension.CumulVar(index))
            route.append((node, arrival))
            
            if node != 0:
                assigned_nodes.add(node)
            
            next_index = solution.Value(routing.NextVar(index))
            next_node = manager.IndexToNode(next_index)
            total_distance += distance_matrix[node][next_node]
            index = next_index
        
        # Add final depot return
        node = manager.IndexToNode(index)
        arrival = solution.Value(time_dimension.CumulVar(index))
        route.append((node, arrival))
        
        routes.append(route)
        distances_km.append(total_distance / 1000.0)
    
    # Find unassigned orders
    unassigned = [
        orders[node - 1].order_id
        for node in range(1, len(orders) + 1)
        if node not in assigned_nodes
    ]
    
    return routes, distances_km, unassigned


def print_solution(
    routes: list[list[tuple[int, int]]],
    distances: list[float],
    unassigned: list[str],
    orders: list[Order],
    vehicles: list[Vehicle],
) -> None:
    """Print solution in readable format."""
    total_distance = 0.0
    vehicles_used = 0
    
    for vehicle_idx, (route, distance_km) in enumerate(zip(routes, distances)):
        if len(route) <= 2:  # Only depot start/end
            continue
        
        vehicles_used += 1
        vehicle = vehicles[vehicle_idx]
        
        print(f"Vehicle {vehicle.vehicle_id} ({vehicle.vehicle_type}, {vehicle.capacity_kg:.0f}kg)")
        print(f"  Distance: {distance_km:.2f} km")
        print(f"  Route:")
        
        for node, arrival in route:
            if node == 0:
                label = "DEPOT"
            else:
                order = orders[node - 1]
                label = f"{order.order_id} ({order.priority})"
            print(f"    {label:>20} @ {minutes_to_hhmm(arrival)}")
        
        total_distance += distance_km
        print()
    
    print(f"Summary:")
    print(f"  Vehicles used: {vehicles_used}/{len(vehicles)}")
    print(f"  Vehicles available but unused: {len(vehicles) - vehicles_used}")
    print(f"  Orders delivered: {len(orders) - len(unassigned)}/{len(orders)}")
    print(f"  Total distance: {total_distance:.2f} km")
    
    if len(unassigned) > 0 and vehicles_used < len(vehicles):
        print(f"\n💡 Tip: {len(unassigned)} order(s) unassigned with {len(vehicles) - vehicles_used} unused vehicles.")
        print(f"   Possible reasons:")
        print(f"   - Time window too tight (can't reach in time)")
        print(f"   - Location too far from all routes")
        print(f"   - Solver gave up (try longer --time-limit)")
    
    if unassigned:
        print(f"\n⚠️  Unassigned orders ({len(unassigned)}):")
        for order_id in unassigned[:20]:
            # Find the order details
            order = next((o for o in orders if o.order_id == order_id), None)
            if order:
                print(f"    - {order_id}:")
                print(f"        Weight: {order.demand_kg:.2f} kg")
                print(f"        Time window: {minutes_to_hhmm(order.window_start)} - {minutes_to_hhmm(order.window_end)}")
                print(f"        Priority: {order.priority}")
            else:
                print(f"    - {order_id}")
        if len(unassigned) > 20:
            print(f"    ... and {len(unassigned) - 20} more")


def main():
    parser = argparse.ArgumentParser(description="Solve VRPTW with pre-computed matrices")
    parser.add_argument(
        '--orders-csv',
        type=Path,
        default=Path('Vehicle Assignments-Table 1.csv'),
        help='Path to orders CSV',
    )
    parser.add_argument(
        '--vehicles-csv',
        type=Path,
        default=None,
        help='Path to vehicles CSV (optional, uses hardcoded fleet if not provided)',
    )
    parser.add_argument(
        '--num-vehicles',
        type=int,
        default=20,
        help='Number of vehicles to use from the fleet (default: 20, use all)',
    )
    parser.add_argument(
        '--matrix-dir',
        type=Path,
        default=Path('matrix_osrm'),
        help='Directory containing distance_matrix.csv and time_matrix_minutes.csv',
    )
    parser.add_argument(
        '--depot-start',
        type=str,
        default='06:00',
        help='Depot opening time (HH:MM)',
    )
    parser.add_argument(
        '--depot-end',
        type=str,
        default='22:30',
        help='Depot closing time (HH:MM)',
    )
    parser.add_argument(
        '--time-limit',
        type=int,
        default=120,
        help='Solver time limit in seconds',
    )
    parser.add_argument(
        '--max-route-duration',
        type=int,
        default=None,
        help='Maximum route duration per vehicle in minutes (e.g. 480 for 8-hour shifts)',
    )
    parser.add_argument(
        '--output-json',
        type=Path,
        help='Optional: save solution to JSON file',
    )
    
    args = parser.parse_args()
    
    # Load data
    print("Loading orders...")
    orders = load_orders(args.orders_csv)
    print(f"  Loaded {len(orders)} orders\n")
    
    print("Loading fleet...")
    if args.vehicles_csv:
        vehicles = load_fleet(args.vehicles_csv)
        print(f"  Loaded {len(vehicles)} vehicles from CSV")
    else:
        vehicles = get_hardcoded_fleet()
        print(f"  Using hardcoded fleet: {len(vehicles)} vehicles")
    
    # Limit to specified number of vehicles
    if args.num_vehicles and args.num_vehicles < len(vehicles):
        vehicles = vehicles[:args.num_vehicles]
        print(f"  Limited to {len(vehicles)} vehicles\n")
    else:
        print(f"  Using all {len(vehicles)} vehicles\n")
    
    print("Loading matrices...")
    distance_matrix = np.loadtxt(args.matrix_dir / 'distance_matrix.csv', delimiter=',')
    time_matrix = np.loadtxt(args.matrix_dir / 'time_matrix_minutes.csv', delimiter=',')
    print(f"  Matrix size: {distance_matrix.shape}\n")
    
    # Validate matrix size
    expected_size = len(orders) + 1  # depot + orders
    if distance_matrix.shape[0] != expected_size:
        print(f"⚠️  WARNING: Matrix size {distance_matrix.shape[0]} doesn't match {expected_size} (depot + orders)")
        print(f"   Using first {expected_size} rows/cols from matrix.\n")
        distance_matrix = distance_matrix[:expected_size, :expected_size]
        time_matrix = time_matrix[:expected_size, :expected_size]
    
    depot_window = (
        time_str_to_minutes(args.depot_start),
        time_str_to_minutes(args.depot_end),
    )
    
    # Solve
    routes, distances, unassigned = solve_vrptw(
        time_matrix=time_matrix,
        distance_matrix=distance_matrix,
        orders=orders,
        vehicles=vehicles,
        depot_window=depot_window,
        time_limit_seconds=args.time_limit,
    )
    
    print("\n" + "="*60)
    print("SOLUTION")
    print("="*60 + "\n")
    
    print_solution(routes, distances, unassigned, orders, vehicles)
    
    # Optionally save to JSON
    if args.output_json:
        output_data = {
            'routes': [
                {
                    'vehicle_id': vehicles[i].vehicle_id,
                    'distance_km': distances[i],
                    'stops': [
                        {
                            'node': node,
                            'order_id': 'DEPOT' if node == 0 else orders[node - 1].order_id,
                            'arrival_time': minutes_to_hhmm(arrival),
                        }
                        for node, arrival in route
                    ],
                }
                for i, route in enumerate(routes)
                if len(route) > 2
            ],
            'unassigned_orders': unassigned,
        }
        
        with open(args.output_json, 'w') as f:
            json.dump(output_data, f, indent=2)
        
        print(f"\n✓ Solution saved to {args.output_json}")


if __name__ == '__main__':
    main()

