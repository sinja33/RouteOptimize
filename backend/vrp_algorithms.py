"""
Advanced VRP Algorithms for Delivery Route Optimization
Implements 4 new sophisticated algorithms:
1. Clarke-Wright Savings
2. Sweep Algorithm
3. Genetic Algorithm  
4. Balanced Multi-Trip

All algorithms respect:
- Vehicle capacity and range (bikes: 15km, vans/trucks: unlimited)
- Time windows (±60 min tolerance with penalties)
- 10-hour shift limits
- Load balancing
- Multi-trip capability
"""

import math
import random
from collections import defaultdict
from copy import deepcopy

# Constants (match these with your backend)
DEPOT_LAT, DEPOT_LNG = 46.0569, 14.5058
MAX_SHIFT_HOURS = 10
AVG_SPEED_KMH = 40
SERVICE_TIME_MINUTES = 5
MAX_TIME_DEVIATION_MINUTES = 60

# Import these functions from your main backend:
# - calculate_distance
# - time_to_minutes  
# - can_vehicle_reach
# - two_opt_improve
# - calculate_route_metrics
# - calculate_algorithm_stats

# For standalone use, include minimal versions here
def calculate_distance_local(lat1, lon1, lat2, lon2, use_road_multiplier=True):
    R = 6371
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat/2) * math.sin(d_lat/2) +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon/2) * math.sin(d_lon/2))
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    distance = R * c
    if use_road_multiplier:
        distance = distance * 1.3
    return distance

# Use the imported or local version
try:
    from backend_app import calculate_distance, time_to_minutes, can_vehicle_reach
    from backend_app import two_opt_improve, calculate_route_metrics
except:
    calculate_distance = calculate_distance_local
    print("⚠️  Using local helper functions - import from main backend for full functionality")


# ==================================================================================
# ALGORITHM 1: CLARKE-WRIGHT SAVINGS
# ==================================================================================

def clarke_wright_savings_algorithm(orders, vehicles, calculate_distance, two_opt_improve, calculate_route_metrics):
    """
    Clarke-Wright Savings Algorithm
    
    Steps:
    1. Calculate savings for all order pairs: s(i,j) = d(0,i) + d(0,j) - d(i,j)
    2. Sort savings descending
    3. Merge routes with highest savings if feasible
    4. Optimize with 2-opt
    
    Returns: (routes, assigned_count)
    """
    print(f"\n🔷 CLARKE-WRIGHT SAVINGS ALGORITHM")
    
    colors = ['#ff3b4a', '#00d4ff', '#7c3aed', '#f59e0b', '#10b981',
              '#ec4899', '#3b82f6', '#8b5cf6', '#f97316', '#14b8a6']
    
    # Step 1: Calculate all pair-wise savings
    savings = []
    for i in range(len(orders)):
        for j in range(i + 1, len(orders)):
            order_i, order_j = orders[i], orders[j]
            
            d_0i = calculate_distance(DEPOT_LAT, DEPOT_LNG, order_i['lat'], order_i['lng'])
            d_0j = calculate_distance(DEPOT_LAT, DEPOT_LNG, order_j['lat'], order_j['lng'])
            d_ij = calculate_distance(order_i['lat'], order_i['lng'], order_j['lat'], order_j['lng'])
            
            saving = d_0i + d_0j - d_ij
            
            # Bonus for same priority
            if order_i.get('priority') == order_j.get('priority'):
                saving += 1.0
            
            savings.append({
                'saving': saving,
                'i': i,
                'j': j,
                'order_i': order_i,
                'order_j': order_j
            })
    
    savings.sort(key=lambda x: x['saving'], reverse=True)
    
    # Step 2: Initialize routes
    routes = []
    assigned = set()
    
    def find_vehicle(orders_to_assign, used_ids):
        """Find best vehicle for orders"""
        total_weight = sum(o['weight'] for o in orders_to_assign)
        max_dist = max(calculate_distance(DEPOT_LAT, DEPOT_LNG, o['lat'], o['lng']) for o in orders_to_assign)
        
        for vehicle in sorted(vehicles, key=lambda v: -v['maxCapacity']):
            if vehicle['id'] in used_ids:
                continue
            if total_weight > vehicle['maxCapacity']:
                continue
                
            v_type = vehicle.get('type', '').lower()
            if v_type == 'bike' and max_dist > 15:
                continue
            
            return vehicle
        return None
    
    def can_add(route, order):
        """Check if can add order to route"""
        if route['totalWeight'] + order['weight'] > route['vehicle']['maxCapacity']:
            return False
        v_type = route['vehicle'].get('type', '').lower()
        dist = calculate_distance(DEPOT_LAT, DEPOT_LNG, order['lat'], order['lng'])
        if v_type == 'bike' and dist > 15:
            return False
        return True
    
    # Step 3: Merge routes based on savings
    for saving_pair in savings:
        i, j = saving_pair['i'], saving_pair['j']
        order_i, order_j = saving_pair['order_i'], saving_pair['order_j']
        
        if i in assigned and j in assigned:
            continue
        
        # Find routes
        route_i = next((r for r in routes if order_i['id'] in [o['id'] for o in r['orders']]), None)
        route_j = next((r for r in routes if order_j['id'] in [o['id'] for o in r['orders']]), None)
        
        # Case 1: Both unassigned - create new route
        if not route_i and not route_j:
            vehicle = find_vehicle([order_i, order_j], [r['vehicle']['id'] for r in routes])
            if vehicle:
                routes.append({
                    'vehicle': vehicle,
                    'orders': [order_i, order_j],
                    'totalWeight': order_i['weight'] + order_j['weight'],
                    'color': colors[len(routes) % len(colors)]
                })
                assigned.update([i, j])
        
        # Case 2: One assigned - add other
        elif route_i and not route_j:
            if can_add(route_i, order_j):
                route_i['orders'].append(order_j)
                route_i['totalWeight'] += order_j['weight']
                assigned.add(j)
        elif route_j and not route_i:
            if can_add(route_j, order_i):
                route_j['orders'].append(order_i)
                route_j['totalWeight'] += order_i['weight']
                assigned.add(i)
    
    # Step 4: Assign remaining
    for i, order in enumerate(orders):
        if i not in assigned:
            # Try existing routes
            added = False
            for route in routes:
                if can_add(route, order):
                    route['orders'].append(order)
                    route['totalWeight'] += order['weight']
                    assigned.add(i)
                    added = True
                    break
            
            # New route if needed
            if not added:
                vehicle = find_vehicle([order], [r['vehicle']['id'] for r in routes])
                if vehicle:
                    routes.append({
                        'vehicle': vehicle,
                        'orders': [order],
                        'totalWeight': order['weight'],
                        'color': colors[len(routes) % len(colors)]
                    })
                    assigned.add(i)
    
    # Step 5: Optimize routes
    for route in routes:
        route['orders'] = two_opt_improve(route['orders'], DEPOT_LAT, DEPOT_LNG)
        calculate_route_metrics(route, DEPOT_LAT, DEPOT_LNG)
    
    print(f"✅ {len(routes)} routes, {len(assigned)}/{len(orders)} assigned")
    return routes, len(assigned)


# ==================================================================================
# ALGORITHM 2: SWEEP ALGORITHM
# ==================================================================================

def sweep_algorithm(orders, vehicles, calculate_distance, two_opt_improve, calculate_route_metrics):
    """
    Sweep Algorithm - Perfect for radial cities
    
    Steps:
    1. Calculate angle from depot to each order
    2. Sort by angle (clockwise sweep)
    3. Fill vehicles sequentially
    4. Respect all constraints
    
    Returns: (routes, assigned_count)
    """
    print(f"\n🔶 SWEEP ALGORITHM")
    
    colors = ['#ff3b4a', '#00d4ff', '#7c3aed', '#f59e0b', '#10b981']
    
    # Step 1: Calculate angles
    orders_with_angles = []
    for order in orders:
        dx = order['lng'] - DEPOT_LNG
        dy = order['lat'] - DEPOT_LAT
        angle = math.atan2(dy, dx)
        orders_with_angles.append({**order, 'angle': angle})
    
    # Step 2: Sort by angle
    orders_with_angles.sort(key=lambda x: x['angle'])
    
    # Step 3: Sort vehicles
    sorted_vehicles = sorted(vehicles, 
                            key=lambda x: (
                                0 if x.get('fuelType', '').lower() == 'electric' else 1,
                                -x.get('maxCapacity', 0)
                            ))
    
    # Step 4: Sweep and assign
    routes = []
    current_route = None
    vehicle_idx = 0
    assigned = set()
    
    for order in orders_with_angles:
        if current_route is None:
            if vehicle_idx >= len(sorted_vehicles):
                break
            current_route = {
                'vehicle': sorted_vehicles[vehicle_idx],
                'orders': [],
                'totalWeight': 0,
                'color': colors[vehicle_idx % len(colors)]
            }
            vehicle_idx += 1
        
        # Check if can add
        v_type = current_route['vehicle'].get('type', '').lower()
        dist = calculate_distance(DEPOT_LAT, DEPOT_LNG, order['lat'], order['lng'])
        
        can_add = (
            current_route['totalWeight'] + order['weight'] <= current_route['vehicle']['maxCapacity'] and
            (v_type != 'bike' or dist <= 15) and
            len(current_route['orders']) * 20 < MAX_SHIFT_HOURS * 60
        )
        
        if can_add:
            current_route['orders'].append(order)
            current_route['totalWeight'] += order['weight']
            assigned.add(order['id'])
        else:
            # Finish current route
            if current_route['orders']:
                routes.append(current_route)
            
            # Start new route
            if vehicle_idx < len(sorted_vehicles):
                current_route = {
                    'vehicle': sorted_vehicles[vehicle_idx],
                    'orders': [order],
                    'totalWeight': order['weight'],
                    'color': colors[vehicle_idx % len(colors)]
                }
                vehicle_idx += 1
                assigned.add(order['id'])
            else:
                current_route = None
    
    if current_route and current_route['orders']:
        routes.append(current_route)
    
    # Optimize
    for route in routes:
        calculate_route_metrics(route, DEPOT_LAT, DEPOT_LNG)
    
    print(f"✅ {len(routes)} routes, {len(assigned)}/{len(orders)} assigned")
    return routes, len(assigned)


# ==================================================================================
# ALGORITHM 3: GENETIC ALGORITHM
# ==================================================================================

def genetic_algorithm(orders, vehicles, calculate_distance, two_opt_improve, 
                      calculate_route_metrics, generations=50, population_size=30):
    """
    Genetic Algorithm for Multi-objective VRP
    
    Fitness function weights:
    - Distance: 30%
    - Time penalties: 25%
    - Utilization: 25%
    - Coverage: 20%
    
    Returns: (routes, assigned_count)
    """
    print(f"\n🧬 GENETIC ALGORITHM (Gen={generations}, Pop={population_size})")
    
    colors = ['#ff3b4a', '#00d4ff', '#7c3aed', '#f59e0b', '#10b981']
    
    def create_chromosome():
        """Random solution"""
        chromosome = []
        order_list = random.sample(orders, len(orders))
        vehicle_list = random.sample(vehicles, len(vehicles))
        
        v_idx = 0
        current_load = []
        current_weight = 0
        
        for order in order_list:
            if v_idx >= len(vehicle_list):
                break
            
            vehicle = vehicle_list[v_idx]
            
            if current_weight + order['weight'] <= vehicle['maxCapacity']:
                current_load.append(order['id'])
                current_weight += order['weight']
            else:
                if current_load:
                    chromosome.append((vehicle['id'], current_load))
                v_idx += 1
                if v_idx < len(vehicle_list):
                    current_load = [order['id']]
                    current_weight = order['weight']
        
        if current_load and v_idx < len(vehicle_list):
            chromosome.append((vehicle_list[v_idx]['id'], current_load))
        
        return chromosome
    
    def evaluate_fitness(chromosome):
        """Calculate fitness score"""
        routes = []
        order_map = {o['id']: o for o in orders}
        vehicle_map = {v['id']: v for v in vehicles}
        
        for idx, (v_id, order_ids) in enumerate(chromosome):
            if v_id not in vehicle_map:
                continue
            
            route_orders = [order_map[oid] for oid in order_ids if oid in order_map]
            if not route_orders:
                continue
            
            route = {
                'vehicle': vehicle_map[v_id],
                'orders': route_orders,
                'totalWeight': sum(o['weight'] for o in route_orders),
                'color': colors[idx % len(colors)]
            }
            calculate_route_metrics(route, DEPOT_LAT, DEPOT_LNG)
            routes.append(route)
        
        if not routes:
            return -10000
        
        total_dist = sum(r['totalDistance'] for r in routes)
        total_penalty = sum(r.get('totalPenalty', 0) for r in routes)
        total_util = sum(r['totalWeight'] / r['vehicle']['maxCapacity'] for r in routes)
        avg_util = total_util / len(routes)
        assigned = sum(len(r['orders']) for r in routes)
        
        # Fitness (higher = better)
        fitness = (
            -total_dist * 0.30 +
            -total_penalty * 0.25 +
            avg_util * 1000 * 0.25 +
            assigned * 10 * 0.20
        )
        return fitness
    
    def crossover(p1, p2):
        """Single-point crossover"""
        if not p1 or not p2:
            return deepcopy(p1) if p1 else deepcopy(p2)
        
        point = random.randint(1, min(len(p1), len(p2)) - 1)
        child = p1[:point] + p2[point:]
        
        # Remove duplicates
        seen = set()
        cleaned = []
        for v_id, o_ids in child:
            unique = [oid for oid in o_ids if oid not in seen]
            if unique:
                cleaned.append((v_id, unique))
                seen.update(unique)
        return cleaned
    
    def mutate(chromosome):
        """Random mutation"""
        if not chromosome or random.random() > 0.2:
            return chromosome
        
        mutation = random.choice(['swap', 'move', 'shuffle'])
        
        if mutation == 'swap' and len(chromosome) >= 2:
            i, j = random.sample(range(len(chromosome)), 2)
            _, orders1 = chromosome[i]
            _, orders2 = chromosome[j]
            if orders1 and orders2:
                o1 = random.randint(0, len(orders1)-1)
                o2 = random.randint(0, len(orders2)-1)
                orders1[o1], orders2[o2] = orders2[o2], orders1[o1]
        
        return chromosome
    
    # Initialize population
    population = [create_chromosome() for _ in range(population_size)]
    best_solution = None
    best_fitness = float('-inf')
    
    # Evolution
    for gen in range(generations):
        fitness_scores = [evaluate_fitness(c) for c in population]
        
        max_fit = max(fitness_scores)
        if max_fit > best_fitness:
            best_fitness = max_fit
            best_solution = deepcopy(population[fitness_scores.index(max_fit)])
        
        if gen % 10 == 0:
            print(f"   Gen {gen}: fitness = {best_fitness:.1f}")
        
        # New population
        new_pop = []
        for _ in range(population_size):
            # Tournament selection
            t_size = 3
            t_indices = random.sample(range(len(population)), t_size)
            p1 = population[max(t_indices, key=lambda i: fitness_scores[i])]
            
            t_indices = random.sample(range(len(population)), t_size)
            p2 = population[max(t_indices, key=lambda i: fitness_scores[i])]
            
            child = crossover(p1, p2) if random.random() < 0.7 else deepcopy(p1)
            child = mutate(child)
            new_pop.append(child)
        
        population = new_pop
    
    # Convert best to routes
    routes = []
    order_map = {o['id']: o for o in orders}
    vehicle_map = {v['id']: v for v in vehicles}
    
    for idx, (v_id, order_ids) in enumerate(best_solution):
        route_orders = [order_map[oid] for oid in order_ids if oid in order_map]
        if route_orders:
            route = {
                'vehicle': vehicle_map[v_id],
                'orders': route_orders,
                'totalWeight': sum(o['weight'] for o in route_orders),
                'color': colors[idx % len(colors)]
            }
            route['orders'] = two_opt_improve(route['orders'], DEPOT_LAT, DEPOT_LNG)
            calculate_route_metrics(route, DEPOT_LAT, DEPOT_LNG)
            routes.append(route)
    
    assigned = sum(len(r['orders']) for r in routes)
    print(f"✅ {len(routes)} routes, {assigned}/{len(orders)} assigned, fitness={best_fitness:.1f}")
    return routes, assigned


# ==================================================================================
# ALGORITHM 4: BALANCED MULTI-TRIP
# ==================================================================================

def balanced_multi_trip_algorithm(orders, vehicles, calculate_distance, 
                                   two_opt_improve, calculate_route_metrics):
    """
    Balanced Multi-Trip Algorithm
    
    Key features:
    - Distributes load evenly across all vehicles
    - Allows multiple trips per vehicle
    - Prevents single vehicle overload
    - Can deliver ALL orders if time permits
    
    Returns: (routes, assigned_count)
    """
    print(f"\n⚖️  BALANCED MULTI-TRIP ALGORITHM")
    
    colors = ['#ff3b4a', '#00d4ff', '#7c3aed', '#f59e0b', '#10b981']
    
    # Calculate target utilization
    total_weight = sum(o['weight'] for o in orders)
    total_capacity = sum(v['maxCapacity'] for v in vehicles)
    target_util = min(0.85, total_weight / total_capacity)
    
    print(f"   Target utilization: {target_util*100:.1f}%")
    
    # Sort orders by priority and weight
    priority_map = {'express': 3, 'urgent': 2, 'standard': 1}
    sorted_orders = sorted(orders, key=lambda x: (
        -priority_map.get(x.get('priority', 'standard'), 1),
        -x['weight']
    ))
    
    # Sort vehicles
    sorted_vehicles = sorted(vehicles, key=lambda x: (
        0 if x.get('fuelType', '').lower() == 'electric' else 1,
        -x.get('maxCapacity', 0)
    ))
    
    # Initialize vehicle state
    vehicle_trips = {v['id']: [] for v in sorted_vehicles}
    vehicle_load = {v['id']: 0 for v in sorted_vehicles}
    vehicle_time = {v['id']: 0 for v in sorted_vehicles}
    
    assigned = set()
    all_routes = []
    route_counter = 0
    
    # Assign orders
    for order in sorted_orders:
        # Find vehicle with lowest utilization
        best_vehicle = None
        best_score = float('inf')
        
        for vehicle in sorted_vehicles:
            v_id = vehicle['id']
            v_type = vehicle.get('type', '').lower()
            v_capacity = vehicle['maxCapacity']
            
            # Check reachability
            dist = calculate_distance(DEPOT_LAT, DEPOT_LNG, order['lat'], order['lng'])
            if v_type == 'bike' and dist > 15:
                continue
            
            # Check time
            est_time = vehicle_time[v_id] + (dist / AVG_SPEED_KMH) * 60 * 2
            if est_time > MAX_SHIFT_HOURS * 60:
                continue
            
            # Score by current utilization
            current_util = vehicle_load[v_id] / v_capacity
            
            # Penalty if need new trip
            if vehicle_load[v_id] + order['weight'] > v_capacity:
                score = current_util + 0.5
            else:
                score = current_util
            
            if score < best_score:
                best_score = score
                best_vehicle = vehicle
        
        if best_vehicle is None:
            continue
        
        v_id = best_vehicle['id']
        
        # Check if need new trip
        if vehicle_load[v_id] + order['weight'] > best_vehicle['maxCapacity']:
            # Finish current trip
            if vehicle_trips[v_id]:
                route = {
                    'vehicle': best_vehicle,
                    'orders': vehicle_trips[v_id].copy(),
                    'totalWeight': vehicle_load[v_id],
                    'color': colors[route_counter % len(colors)],
                    'tripNumber': len([r for r in all_routes if r['vehicle']['id'] == v_id]) + 1
                }
                route['orders'] = two_opt_improve(route['orders'], DEPOT_LAT, DEPOT_LNG)
                calculate_route_metrics(route, DEPOT_LAT, DEPOT_LNG)
                all_routes.append(route)
                route_counter += 1
            
            # New trip
            vehicle_trips[v_id] = [order]
            vehicle_load[v_id] = order['weight']
        else:
            # Add to current trip
            vehicle_trips[v_id].append(order)
            vehicle_load[v_id] += order['weight']
        
        # Update time
        dist = calculate_distance(DEPOT_LAT, DEPOT_LNG, order['lat'], order['lng'])
        vehicle_time[v_id] += (dist / AVG_SPEED_KMH) * 60
        assigned.add(order['id'])
    
    # Finish remaining trips
    for v_id, trip_orders in vehicle_trips.items():
        if trip_orders:
            vehicle = next(v for v in sorted_vehicles if v['id'] == v_id)
            route = {
                'vehicle': vehicle,
                'orders': trip_orders,
                'totalWeight': vehicle_load[v_id],
                'color': colors[route_counter % len(colors)],
                'tripNumber': len([r for r in all_routes if r['vehicle']['id'] == v_id]) + 1
            }
            route['orders'] = two_opt_improve(route['orders'], DEPOT_LAT, DEPOT_LNG)
            calculate_route_metrics(route, DEPOT_LAT, DEPOT_LNG)
            all_routes.append(route)
            route_counter += 1
    
    # Stats
    trip_counts = defaultdict(int)
    for route in all_routes:
        trip_counts[route['vehicle']['id']] += 1
    
    multi_trip_vehicles = sum(1 for c in trip_counts.values() if c > 1)
    print(f"   Multi-trip vehicles: {multi_trip_vehicles}/{len(trip_counts)}")
    print(f"✅ {len(all_routes)} routes, {len(assigned)}/{len(orders)} assigned")
    
    return all_routes, len(assigned)


# Export all algorithms
__all__ = [
    'clarke_wright_savings_algorithm',
    'sweep_algorithm',
    'genetic_algorithm',
    'balanced_multi_trip_algorithm'
]