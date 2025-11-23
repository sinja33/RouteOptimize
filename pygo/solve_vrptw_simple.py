"""
Simple VRPTW solver based on Google OR-Tools documentation.
Focuses on clarity and ease of understanding.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from ortools.constraint_solver import pywrapcp, routing_enums_pb2


def create_data_model(orders_csv: Path, matrix_dir: Path, num_vehicles: int = 20, vehicle_types: str = None, vehicle_ids: str = None):
    """
    Create data model for the problem.
    
    Args:
        orders_csv: Path to orders CSV
        matrix_dir: Path to matrix directory
        num_vehicles: Number of vehicles to use (1-20)
        vehicle_types: Filter by type: 'truck', 'van', 'bike', or 'all' (default)
        vehicle_ids: Specific vehicle IDs to use (e.g. "1,2,3,6,11")
    
    Returns dict with:
        - time_matrix: Travel times in minutes (NxN)
        - distance_matrix: Distances in meters (NxN)
        - time_windows: [(start, end), ...] for each location
        - demands: [weight, ...] for each location in grams
        - vehicle_capacities: [capacity, ...] for each vehicle in grams
        - vehicle_ids: [id, ...] vehicle identifiers
        - num_vehicles: Number of vehicles
        - depot: Index of depot (always 0)
    """
    # Load orders
    df = pd.read_csv(orders_csv, sep=';', decimal=',')
    df.columns = df.columns.str.strip()
    
    # Load matrices
    time_matrix = np.loadtxt(matrix_dir / 'time_matrix_minutes.csv', delimiter=',').astype(int)
    distance_matrix = np.loadtxt(matrix_dir / 'distance_matrix.csv', delimiter=',').astype(int)
    
    # Extract time windows (depot first, then orders)
    time_windows = [(360, 1350)]  # Depot: 06:00 - 22:30
    
    for _, row in df.iterrows():
        start_time = parse_time(row['WindowStart'])
        end_time = parse_time(row['WindowEnd'])
        time_windows.append((start_time, end_time))
    
    # Extract demands (depot = 0, then orders in grams)
    weight_col = 'Weight_kg' if 'Weight_kg' in df.columns else 'Weight(kg)'
    demands = [0]  # Depot has no demand
    for _, row in df.iterrows():
        weight_kg = float(str(row[weight_col]).replace(',', '.'))
        demands.append(int(weight_kg * 1000))  # Convert to grams
    
    # Vehicle fleet (id, type, capacity_kg, fuel_type, emission_g_co2_per_km)
    fleet = [
        ('V001', 'truck', 7156, 'diesel', 300),
        ('V002', 'truck', 7319, 'diesel', 300),
        ('V003', 'truck', 4674, 'diesel', 300),
        ('V004', 'bike', 33, 'electric', 0),
        ('V005', 'van', 1102, 'electric', 0),
        ('V006', 'truck', 5317, 'diesel', 300),
        ('V007', 'bike', 32, 'electric', 0),
        ('V008', 'bike', 45, 'electric', 0),
        ('V009', 'bike', 49, 'electric', 0),
        ('V010', 'van', 816, 'diesel', 180),
        ('V011', 'truck', 6619, 'diesel', 300),
        ('V012', 'truck', 6830, 'diesel', 300),
        ('V013', 'bike', 48, 'electric', 0),
        ('V014', 'truck', 6393, 'diesel', 300),
        ('V015', 'bike', 36, 'electric', 0),
        ('V016', 'bike', 32, 'electric', 0),
        ('V017', 'van', 815, 'electric', 0),
        ('V018', 'bike', 32, 'electric', 0),
        ('V019', 'bike', 41, 'electric', 0),
        ('V020', 'bike', 34, 'electric', 0),
    ]
    
    # Filter by specific vehicle IDs if specified
    if vehicle_ids:
        # Parse vehicle IDs (e.g., "1,2,3,6" -> ["V001", "V002", "V003", "V006"])
        selected_ids = []
        for vid_num in vehicle_ids.split(','):
            vid_num = vid_num.strip()
            selected_ids.append(f'V{int(vid_num):03d}')
        
        fleet = [(vid, vtype, cap, fuel, emission) for vid, vtype, cap, fuel, emission in fleet if vid in selected_ids]
        print(f"  Selected {len(fleet)} specific vehicles: {', '.join(selected_ids)}")
    
    # Otherwise filter by vehicle type
    elif vehicle_types and vehicle_types != 'all':
        types_to_use = [t.strip() for t in vehicle_types.split(',')]
        fleet = [(vid, vtype, cap, fuel, emission) for vid, vtype, cap, fuel, emission in fleet if vtype in types_to_use]
        print(f"  Filtered to {len(fleet)} vehicles of type(s): {types_to_use}")
    
    # Otherwise limit to num_vehicles
    else:
        fleet = fleet[:num_vehicles]
    
    vehicle_ids = [vid for vid, _, _, _, _ in fleet]
    vehicle_capacities = [int(cap * 1000) for _, _, cap, _, _ in fleet]  # Convert to grams
    vehicle_emissions = [emission for _, _, _, _, emission in fleet]  # g CO2/km
    vehicle_fuel_types = [fuel for _, _, _, fuel, _ in fleet]
    
    data = {
        'time_matrix': time_matrix.tolist(),
        'distance_matrix': distance_matrix.tolist(),
        'time_windows': time_windows,
        'demands': demands,
        'vehicle_capacities': vehicle_capacities,
        'vehicle_ids': vehicle_ids,
        'vehicle_emissions': vehicle_emissions,
        'vehicle_fuel_types': vehicle_fuel_types,
        'num_vehicles': len(fleet),
        'depot': 0,
        'service_time': 3,  # 3 minutes per delivery
    }
    
    return data


def parse_time(time_str: str) -> int:
    """Convert HH:MM to minutes from midnight."""
    parts = str(time_str).split(':')
    return int(parts[0]) * 60 + int(parts[1])


def format_time(minutes: int) -> str:
    """Convert minutes to HH:MM."""
    h = minutes // 60
    m = minutes % 60
    return f"{h:02d}:{m:02d}"


def print_solution(data, manager, routing, solution):
    """Print solution to console."""
    print(f"\nObjective: {solution.ObjectiveValue()}")
    
    time_dimension = routing.GetDimensionOrDie('Time')
    capacity_dimension = routing.GetDimensionOrDie('Capacity')
    
    total_distance = 0
    total_time = 0
    total_emissions = 0
    routes_used = 0
    
    for vehicle_id in range(data['num_vehicles']):
        if not routing.IsVehicleUsed(solution, vehicle_id):
            continue
        
        routes_used += 1
        index = routing.Start(vehicle_id)
        
        vehicle_name = data['vehicle_ids'][vehicle_id]
        plan_output = f'\nRoute for {vehicle_name}:\n'
        route_distance = 0
        
        while not routing.IsEnd(index):
            time_var = time_dimension.CumulVar(index)
            capacity_var = capacity_dimension.CumulVar(index)
            node = manager.IndexToNode(index)
            
            arrival_time = solution.Min(time_var)
            # Add service time to show departure time (depot has no service time)
            service_time = 0 if node == 0 else data['service_time']
            departure_time = arrival_time + service_time
            
            plan_output += (
                f"  {node}"
                f" Time({format_time(arrival_time)},{format_time(departure_time)})"
                f" Load({solution.Value(capacity_var)/1000:.1f}kg)"
                f" -> "
            )
            
            previous_index = index
            index = solution.Value(routing.NextVar(index))
            
            # Calculate actual distance (not time!)
            from_node = manager.IndexToNode(previous_index)
            to_node = manager.IndexToNode(index)
            route_distance += data['distance_matrix'][from_node][to_node]
        
        # Final node (depot - no service time)
        time_var = time_dimension.CumulVar(index)
        node = manager.IndexToNode(index)
        arrival_time = solution.Min(time_var)
        plan_output += (
            f"{node} Time({format_time(arrival_time)},{format_time(arrival_time)})\n"
        )
        
        route_time = solution.Min(time_var)
        route_emissions = (route_distance / 1000.0) * data['vehicle_emissions'][vehicle_id]
        
        plan_output += f"  Distance: {route_distance/1000:.2f}km\n"
        plan_output += f"  Time: {route_time}min ({format_time(route_time)})\n"
        plan_output += f"  CO2 Emissions: {route_emissions/1000:.2f}kg\n"
        
        print(plan_output)
        total_distance += route_distance
        total_time += route_time
        total_emissions += route_emissions
    
    print(f"\nSummary:")
    print(f"  Vehicles used: {routes_used}/{data['num_vehicles']}")
    print(f"  Total distance: {total_distance/1000:.2f}km")
    print(f"  Total time: {total_time}min")
    print(f"  Total CO2 emissions: {total_emissions/1000:.2f}kg")


def save_solution_json(data, manager, routing, solution, output_path: Path):
    """Save solution to JSON file."""
    time_dimension = routing.GetDimensionOrDie('Time')
    
    routes = []
    
    for vehicle_id in range(data['num_vehicles']):
        if not routing.IsVehicleUsed(solution, vehicle_id):
            continue
        
        index = routing.Start(vehicle_id)
        stops = []
        route_distance = 0
        
        while not routing.IsEnd(index):
            time_var = time_dimension.CumulVar(index)
            node = manager.IndexToNode(index)
            
            stops.append({
                'node': node,
                'location': 'DEPOT' if node == 0 else f'ORD{node:04d}',
                'arrival_time': format_time(solution.Min(time_var)),
                'arrival_minutes': solution.Min(time_var),
            })
            
            previous_index = index
            index = solution.Value(routing.NextVar(index))
            
            # Calculate actual distance (not time!)
            from_node = manager.IndexToNode(previous_index)
            to_node = manager.IndexToNode(index)
            route_distance += data['distance_matrix'][from_node][to_node]
        
        # Add final depot
        time_var = time_dimension.CumulVar(index)
        node = manager.IndexToNode(index)
        stops.append({
            'node': node,
            'location': 'DEPOT',
            'arrival_time': format_time(solution.Min(time_var)),
            'arrival_minutes': solution.Min(time_var),
        })
        
        routes.append({
            'vehicle_id': data['vehicle_ids'][vehicle_id],
            'distance_km': round(route_distance / 1000, 2),
            'stops': stops,
        })
    
    output = {
        'routes': routes,
        'summary': {
            'vehicles_used': len(routes),
            'total_vehicles': data['num_vehicles'],
            'total_distance_km': round(sum(r['distance_km'] for r in routes), 2),
        }
    }
    
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"\n✓ Solution saved to {output_path}")


def solve_vrptw(data, max_route_duration=None, emission_weight=0.0):
    """Solve the VRPTW.
    
    Args:
        data: Data model dictionary
        max_route_duration: Optional maximum minutes per vehicle route
        emission_weight: Weight for CO2 emissions in cost (0.0 = ignore emissions, 1.0 = equal to time)
    """
    # Create the routing index manager
    manager = pywrapcp.RoutingIndexManager(
        len(data['time_matrix']),
        data['num_vehicles'],
        data['depot']
    )
    
    # Create routing model
    routing = pywrapcp.RoutingModel(manager)
    
    # Create and register a transit callback (travel time + service time)
    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        
        # Service time at 'from' node (depot has no service time)
        service_time = 0 if from_node == 0 else data['service_time']
        
        # Travel time from -> to
        travel_time = data['time_matrix'][from_node][to_node]
        
        return service_time + travel_time
    
    transit_callback_index = routing.RegisterTransitCallback(time_callback)
    
    # Create cost callback that includes emissions if weight > 0
    if emission_weight > 0:
        def cost_callback(from_index, to_index, vehicle_id):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            
            # Time cost
            service_time = 0 if from_node == 0 else data['service_time']
            travel_time = data['time_matrix'][from_node][to_node]
            time_cost = service_time + travel_time
            
            # Emission cost (distance * emission rate)
            distance_km = data['distance_matrix'][from_node][to_node] / 1000.0
            emission_g_co2 = distance_km * data['vehicle_emissions'][vehicle_id]
            emission_cost = emission_g_co2 / 100.0  # Scale down to be comparable to time
            
            # Combined cost
            return int(time_cost + emission_weight * emission_cost)
        
        # Register per-vehicle cost callbacks
        cost_callback_indices = []
        for vehicle_id in range(data['num_vehicles']):
            def make_callback(vid):
                return lambda from_idx, to_idx: cost_callback(from_idx, to_idx, vid)
            
            cost_idx = routing.RegisterTransitCallback(make_callback(vehicle_id))
            cost_callback_indices.append(cost_idx)
            routing.SetArcCostEvaluatorOfVehicle(cost_idx, vehicle_id)
        
        print(f"  Using emission-aware cost (weight={emission_weight})")
    else:
        # Use simple time-based cost
        routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)
    
    # Add Time dimension
    routing.AddDimension(
        transit_callback_index,
        slack_max=60,  # Allow 60 minutes waiting time
        capacity=1440,  # Maximum time per vehicle (24 hours)
        fix_start_cumul_to_zero=False,  # Don't force start at time 0
        name='Time'
    )
    
    time_dimension = routing.GetDimensionOrDie('Time')
    
    # Add time window constraints for each location except depot
    for location_idx in range(1, len(data['time_windows'])):
        index = manager.NodeToIndex(location_idx)
        start_time, end_time = data['time_windows'][location_idx]
        time_dimension.CumulVar(index).SetRange(start_time, end_time)
    
    # Add time window constraints for depot (for each vehicle)
    depot_start, depot_end = data['time_windows'][0]
    for vehicle_id in range(data['num_vehicles']):
        index = routing.Start(vehicle_id)
        time_dimension.CumulVar(index).SetRange(depot_start, depot_end)
        
        index = routing.End(vehicle_id)
        time_dimension.CumulVar(index).SetRange(depot_start, depot_end)
        
        # Optional: Add maximum route duration constraint
        if max_route_duration:
            routing.AddVariableMaximizedByFinalizer(
                time_dimension.CumulVar(routing.End(vehicle_id))
            )
            # Limit the span (end time - start time) for each vehicle
            time_dimension.SetSpanCostCoefficientForVehicle(100, vehicle_id)
            # Set max duration
            time_dimension.SetSpanUpperBoundForVehicle(max_route_duration, vehicle_id)
    
    # Minimize route start and end times
    for vehicle_id in range(data['num_vehicles']):
        routing.AddVariableMinimizedByFinalizer(
            time_dimension.CumulVar(routing.Start(vehicle_id))
        )
        routing.AddVariableMinimizedByFinalizer(
            time_dimension.CumulVar(routing.End(vehicle_id))
        )
    
    # Add Capacity dimension
    def demand_callback(from_index):
        from_node = manager.IndexToNode(from_index)
        return data['demands'][from_node]
    
    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    
    routing.AddDimensionWithVehicleCapacity(
        demand_callback_index,
        slack_max=0,  # No slack
        vehicle_capacities=data['vehicle_capacities'],
        fix_start_cumul_to_zero=True,
        name='Capacity'
    )
    
    # Allow dropping nodes with penalty
    penalty = 1000000  # High penalty for dropped nodes
    for node in range(1, len(data['time_windows'])):
        routing.AddDisjunction([manager.NodeToIndex(node)], penalty)
    
    # Set search parameters
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_parameters.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_parameters.time_limit.seconds = 180
    
    # Solve the problem
    print(f"Solving VRPTW with {len(data['demands'])-1} orders and {data['num_vehicles']} vehicles...")
    solution = routing.SolveWithParameters(search_parameters)
    
    if solution:
        return manager, routing, solution
    else:
        print("No solution found!")
        return None, None, None


def main():
    parser = argparse.ArgumentParser(description="Simple VRPTW Solver")
    parser.add_argument(
        '--orders-csv',
        type=Path,
        default=Path('../data/orders_geocoded.csv'),
        help='Path to orders CSV file'
    )
    parser.add_argument(
        '--matrix-dir',
        type=Path,
        default=Path('matrix_osrm'),
        help='Directory containing distance and time matrices'
    )
    parser.add_argument(
        '--num-vehicles',
        type=int,
        default=20,
        help='Number of vehicles to use (1-20)'
    )
    parser.add_argument(
        '--vehicle-types',
        type=str,
        default='all',
        help='Vehicle types to use: "truck", "van", "bike", "truck,van", or "all" (default)'
    )
    parser.add_argument(
        '--vehicle-ids',
        type=str,
        default=None,
        help='Specific vehicle IDs to use (e.g. "1,2,3,6,11,12,14"). Overrides --num-vehicles and --vehicle-types'
    )
    parser.add_argument(
        '--output-json',
        type=Path,
        default=Path('solution_simple.json'),
        help='Output JSON file'
    )
    parser.add_argument(
        '--time-limit',
        type=int,
        default=180,
        help='Solver time limit in seconds'
    )
    parser.add_argument(
        '--max-route-duration',
        type=int,
        default=None,
        help='Maximum route duration per vehicle in minutes (e.g. 480 for 8 hours)'
    )
    parser.add_argument(
        '--emission-weight',
        type=float,
        default=0.0,
        help='Weight for CO2 emissions in optimization (0.0=ignore, 0.5=balance, 1.0=prioritize)'
    )
    
    args = parser.parse_args()
    
    # Create data model
    print("Loading data...")
    data = create_data_model(args.orders_csv, args.matrix_dir, args.num_vehicles, args.vehicle_types, args.vehicle_ids)
    print(f"  Orders: {len(data['demands'])-1}")
    print(f"  Vehicles: {data['num_vehicles']}")
    print(f"  Vehicle IDs: {', '.join(data['vehicle_ids'])}")
    print(f"  Service time: {data['service_time']} minutes per delivery")
    print(f"  Matrix size: {len(data['time_matrix'])}x{len(data['time_matrix'])}\n")
    
    # Solve
    manager, routing, solution = solve_vrptw(data, args.max_route_duration, args.emission_weight)
    
    if solution:
        print("\n" + "="*60)
        print("SOLUTION FOUND")
        print("="*60)
        
        # Print solution
        print_solution(data, manager, routing, solution)
        
        # Save to JSON
        save_solution_json(data, manager, routing, solution, args.output_json)
    else:
        print("\n❌ No solution found!")


if __name__ == '__main__':
    main()

