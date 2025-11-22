from flask import Flask, request, jsonify
from flask_cors import CORS
import math
import requests
import time

app = Flask(__name__)
CORS(app)  # Allow requests from React frontend

# OSRM server URL (public demo server)
OSRM_SERVER = "http://router.project-osrm.org"

# Calculate distance between two coordinates (Haversine formula)
def calculate_distance(lat1, lon1, lat2, lon2, use_road_multiplier=True):
    """
    Calculate straight-line distance and optionally apply road multiplier
    use_road_multiplier: If True, multiply by 1.3 to estimate actual road distance
    """
    R = 6371  # Earth radius in km
    
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    
    a = (math.sin(d_lat/2) * math.sin(d_lat/2) +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon/2) * math.sin(d_lon/2))
    
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    distance = R * c
    
    # Apply 1.3x multiplier to estimate actual road distance
    if use_road_multiplier:
        distance = distance * 1.3
    
    return distance

# Get real road distance and route geometry using OSRM
def get_osrm_distance(lat1, lon1, lat2, lon2):
    """
    Get actual road distance and route geometry using OSRM routing API
    Returns (distance_km, geometry) tuple, or (None, None) if API fails
    geometry is a list of [lat, lng] coordinates
    """
    try:
        # OSRM format: longitude,latitude (opposite of normal!)
        # overview=full returns detailed route geometry
        url = f"{OSRM_SERVER}/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson"
        
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 'Ok' and data.get('routes'):
                # Distance is in meters, convert to km
                distance_m = data['routes'][0]['distance']
                distance_km = distance_m / 1000.0
                
                # Extract geometry coordinates
                geometry = data['routes'][0]['geometry']['coordinates']
                # Convert from [lon, lat] to [lat, lon] for Leaflet
                geometry_latlng = [[coord[1], coord[0]] for coord in geometry]
                
                return distance_km, geometry_latlng
        return None, None
    except Exception as e:
        print(f"OSRM API error: {e}")
        return None, None

# Parse time string to minutes from midnight
def time_to_minutes(time_str):
    """Convert HH:MM:SS or HH:MM to minutes from midnight"""
    if not time_str or time_str == '':
        return None
    try:
        parts = str(time_str).split(':')
        hours = int(parts[0])
        minutes = int(parts[1])
        return hours * 60 + minutes
    except:
        return None

# Calculate time penalty for late delivery
def calculate_time_penalty(arrival_time, window_end, tolerance_minutes=60):
    """
    Calculate penalty for missing time window
    tolerance_minutes: how many minutes late is acceptable (default 60 min = 1 hour)
    Returns: (on_time: bool, lateness_minutes: int)
    """
    if window_end is None:
        return True, 0
    
    effective_window = window_end + tolerance_minutes
    if arrival_time <= effective_window:
        if arrival_time <= window_end:
            return True, 0  # On time
        else:
            return True, arrival_time - window_end  # Within tolerance
    else:
        return False, arrival_time - window_end  # Late


# ALGORITHM 1: Distance-First (minimize kilometers)
def distance_first_algorithm(orders, vehicles):
    """
    Distance-optimized algorithm:
    1. Sort vehicles by capacity (largest first) and prefer electric
    2. For each vehicle:
       - Start from depot
       - Always pick the NEAREST unassigned order that fits
    3. Minimizes total distance driven
    """
    
    print(f"\n ALGORITHM 1: DISTANCE-FIRST (Minimize Kilometers)")
    
    # Sort vehicles by capacity (largest first) and prefer electric
    sorted_vehicles = sorted(vehicles, 
                            key=lambda x: (
                                0 if x.get('fuelType', '').lower() == 'electric' else 1,
                                -x.get('maxCapacity', 0)
                            ))
    
    # Priority mapping (still consider priority as tie-breaker)
    priority_map = {'express': 0, 'urgent': 1, 'standard': 2}
    
    print(f"{len(orders)} orders to assign")
    print(f"{len(sorted_vehicles)} vehicles available")
    
    routes = []
    assigned_orders = set()
    
    # Color palette
    colors = ['#ff3b4a', '#00d4ff', '#7c3aed', '#f59e0b', '#10b981', 
              '#ec4899', '#3b82f6', '#8b5cf6', '#f97316', '#14b8a6',
              '#ef4444', '#06b6d4', '#a855f7', '#eab308', '#22c55e',
              '#db2777', '#6366f1', '#d946ef', '#fb923c', '#2dd4bf']
    
    # Depot location (Ljubljana center)
    depot_lat, depot_lng = 46.0569, 14.5058
    
    for idx, vehicle in enumerate(sorted_vehicles):
        vehicle_id = vehicle.get('id', f'V{idx}')
        max_capacity = vehicle.get('maxCapacity', 0)
        vehicle_type = vehicle.get('type', '').lower()
        
        route = {
            'vehicle': vehicle,
            'orders': [],
            'totalWeight': 0,
            'totalDistance': 0,
            'color': colors[idx % len(colors)],
            'onTimeDeliveries': 0,
            'lateDeliveries': 0,
            'totalLateness': 0
        }
        
        # Start from depot at 8:00 AM (480 minutes from midnight)
        current_lat, current_lng = depot_lat, depot_lng
        current_time = 480  # 8:00 AM in minutes
        avg_speed_kmh = 40  # Average speed in km/h
        
        # Max radius based on vehicle type
        max_radius = float('inf')
        if vehicle_type == 'bike':
            max_radius = 15  # km
        elif vehicle_type == 'van':
            max_radius = 50  # km
        
        # Keep assigning nearest orders until vehicle is full
        while True:
            # Find nearest unassigned order that fits
            nearest_order = None
            nearest_distance = float('inf')
            
            for order in orders:
                # Skip if already assigned
                if order['id'] in assigned_orders:
                    continue
                
                order_weight = order.get('weight', 0)
                order_lat = order.get('lat', 0)
                order_lng = order.get('lng', 0)
                
                # Check capacity
                if route['totalWeight'] + order_weight > max_capacity:
                    continue
                
                # Check distance from depot (vehicle range)
                dist_from_depot = calculate_distance(depot_lat, depot_lng, order_lat, order_lng)
                if dist_from_depot > max_radius:
                    continue
                
                # Calculate distance from current location
                dist_from_current = calculate_distance(current_lat, current_lng, order_lat, order_lng)
                
                # Find nearest order (with priority as tie-breaker)
                priority_score = priority_map.get(order.get('priority', 'standard').lower(), 2)
                score = dist_from_current + (priority_score * 0.5)
                
                if score < nearest_distance:
                    nearest_distance = dist_from_current
                    nearest_order = order
            
            # No more orders fit this vehicle
            if nearest_order is None:
                break
            
            # Calculate arrival time
            travel_time_minutes = (nearest_distance / avg_speed_kmh) * 60
            service_time_minutes = 5  # 5 minutes per stop
            arrival_time = current_time + travel_time_minutes + service_time_minutes
            
            # Check time window
            window_end = time_to_minutes(nearest_order.get('windowEnd', ''))
            on_time, lateness = calculate_time_penalty(arrival_time, window_end)
            
            if on_time:
                route['onTimeDeliveries'] += 1
            else:
                route['lateDeliveries'] += 1
            
            route['totalLateness'] += lateness
            
            # Add order with time info
            order_with_time = nearest_order.copy()
            order_with_time['arrivalTime'] = arrival_time
            order_with_time['onTime'] = on_time
            order_with_time['lateness'] = lateness
            
            # Assign the nearest order
            route['orders'].append(order_with_time)
            route['totalWeight'] += nearest_order.get('weight', 0)
            route['totalDistance'] += nearest_distance
            assigned_orders.add(nearest_order['id'])
            
            # Update current position and time
            current_lat = nearest_order.get('lat', 0)
            current_lng = nearest_order.get('lng', 0)
            current_time = arrival_time
        
        # Add distance back to depot
        if route['orders']:
            last_order = route['orders'][-1]
            return_distance = calculate_distance(
                last_order.get('lat', 0), 
                last_order.get('lng', 0),
                depot_lat, 
                depot_lng
            )
            route['totalDistance'] += return_distance
            route['totalDistance'] = round(route['totalDistance'], 1)
            
            routes.append(route)
    
    return routes, len(assigned_orders)


# ALGORITHM 2: Time-First (meet time windows)
def time_first_algorithm(orders, vehicles):
    """
    Time-optimized algorithm:
    1. Sort orders by time window urgency
    2. Assign to nearest available vehicle that can reach on time
    3. Prioritizes meeting time windows over distance
    """
    
    print(f"\nALGORITHM 2: TIME-FIRST (Meet Time Windows)")
    
    # Sort vehicles by capacity
    sorted_vehicles = sorted(vehicles, 
                            key=lambda x: (
                                0 if x.get('fuelType', '').lower() == 'electric' else 1,
                                -x.get('maxCapacity', 0)
                            ))
    
    # Sort orders by time window (earliest first)
    sorted_orders = sorted(orders, 
                          key=lambda x: time_to_minutes(x.get('windowEnd', '23:59:00')) or 1440)
    
    print(f"ðŸ“‹ {len(orders)} orders to assign")
    print(f"ðŸš› {len(sorted_vehicles)} vehicles available")
    
    colors = ['#ff3b4a', '#00d4ff', '#7c3aed', '#f59e0b', '#10b981', 
              '#ec4899', '#3b82f6', '#8b5cf6', '#f97316', '#14b8a6',
              '#ef4444', '#06b6d4', '#a855f7', '#eab308', '#22c55e',
              '#db2777', '#6366f1', '#d946ef', '#fb923c', '#2dd4bf']
    
    depot_lat, depot_lng = 46.0569, 14.5058
    
    # Initialize vehicle routes
    routes = []
    for idx, vehicle in enumerate(sorted_vehicles):
        routes.append({
            'vehicle': vehicle,
            'orders': [],
            'totalWeight': 0,
            'totalDistance': 0,
            'currentLat': depot_lat,
            'currentLng': depot_lng,
            'currentTime': 480,  # 8:00 AM
            'color': colors[idx % len(colors)],
            'onTimeDeliveries': 0,
            'lateDeliveries': 0,
            'totalLateness': 0
        })
    
    assigned_orders = set()
    avg_speed_kmh = 40
    
    # Assign orders by time window priority
    for order in sorted_orders:
        if order['id'] in assigned_orders:
            continue
        
        order_weight = order.get('weight', 0)
        order_lat = order.get('lat', 0)
        order_lng = order.get('lng', 0)
        window_end = time_to_minutes(order.get('windowEnd', ''))
        
        # Find best vehicle for this order (closest that can deliver on time)
        best_route = None
        best_score = float('inf')
        
        for route in routes:
            vehicle = route['vehicle']
            max_capacity = vehicle.get('maxCapacity', 0)
            vehicle_type = vehicle.get('type', '').lower()
            
            # Check capacity
            if route['totalWeight'] + order_weight > max_capacity:
                continue
            
            # Check vehicle range
            max_radius = float('inf')
            if vehicle_type == 'bike':
                max_radius = 15
            elif vehicle_type == 'van':
                max_radius = 50
            
            dist_from_depot = calculate_distance(depot_lat, depot_lng, order_lat, order_lng)
            if dist_from_depot > max_radius:
                continue
            
            # Calculate arrival time from current position
            dist_to_order = calculate_distance(
                route['currentLat'], route['currentLng'],
                order_lat, order_lng
            )
            travel_time = (dist_to_order / avg_speed_kmh) * 60
            arrival_time = route['currentTime'] + travel_time + 5  # 5 min service
            
            # Calculate time window satisfaction
            on_time, lateness = calculate_time_penalty(arrival_time, window_end)
            
            # Score: prefer on-time, then shorter distance
            time_score = 0 if on_time else lateness * 10  # Heavy penalty for late
            score = time_score + dist_to_order
            
            if score < best_score:
                best_score = score
                best_route = route
                best_arrival = arrival_time
                best_distance = dist_to_order
                best_on_time = on_time
                best_lateness = lateness
        
        # Assign to best route if found
        if best_route:
            order_with_time = order.copy()
            order_with_time['arrivalTime'] = best_arrival
            order_with_time['onTime'] = best_on_time
            order_with_time['lateness'] = best_lateness
            
            best_route['orders'].append(order_with_time)
            best_route['totalWeight'] += order_weight
            best_route['totalDistance'] += best_distance
            best_route['currentLat'] = order_lat
            best_route['currentLng'] = order_lng
            best_route['currentTime'] = best_arrival
            
            if best_on_time:
                best_route['onTimeDeliveries'] += 1
            else:
                best_route['lateDeliveries'] += 1
            best_route['totalLateness'] += best_lateness
            
            assigned_orders.add(order['id'])
    
    # Add return distances and clean up empty routes
    final_routes = []
    for route in routes:
        if route['orders']:
            last_order = route['orders'][-1]
            return_distance = calculate_distance(
                last_order.get('lat', 0),
                last_order.get('lng', 0),
                depot_lat,
                depot_lng
            )
            route['totalDistance'] += return_distance
            route['totalDistance'] = round(route['totalDistance'], 1)
            
            # Remove helper fields
            del route['currentLat']
            del route['currentLng']
            del route['currentTime']
            
            final_routes.append(route)
    
    return final_routes, len(assigned_orders)


# Calculate aggregate statistics for an algorithm result
def calculate_algorithm_stats(routes, total_orders):
    """Calculate statistics for algorithm comparison"""
    total_distance = sum(r['totalDistance'] for r in routes)
    total_on_time = sum(r['onTimeDeliveries'] for r in routes)
    total_late = sum(r['lateDeliveries'] for r in routes)
    total_lateness = sum(r['totalLateness'] for r in routes)
    
    assigned_count = sum(len(r['orders']) for r in routes)
    avg_distance = total_distance / len(routes) if routes else 0
    avg_lateness = total_lateness / total_late if total_late > 0 else 0
    
    # Calculate vehicle utilization
    total_capacity = sum(r['vehicle']['maxCapacity'] for r in routes)
    total_weight = sum(r['totalWeight'] for r in routes)
    avg_utilization = (total_weight / total_capacity * 100) if total_capacity > 0 else 0
    
    return {
        'totalDistance': round(total_distance, 1),
        'avgDistance': round(avg_distance, 1),
        'assignedOrders': assigned_count,
        'unassignedOrders': total_orders - assigned_count,
        'vehiclesUsed': len(routes),
        'onTimeDeliveries': total_on_time,
        'lateDeliveries': total_late,
        'avgLateness': round(avg_lateness, 1),
        'avgUtilization': round(avg_utilization, 1)
    }


@app.route('/api/optimize', methods=['POST'])
def optimize_routes():
    """
    Endpoint to optimize delivery routes using 2 algorithms
    
    Request body:
    {
        "orders": [...],
        "vehicles": [...]
    }
    
    Response:
    {
        "algorithms": {
            "distanceFirst": { "routes": [...], "stats": {...} },
            "timeFirst": { "routes": [...], "stats": {...} }
        }
    }
    """
    try:
        data = request.json
        orders = data.get('orders', [])
        vehicles = data.get('vehicles', [])
        
        if not orders or not vehicles:
            return jsonify({
                'error': 'Missing orders or vehicles'
            }), 400
        
        print(f"\n{'='*60}")
        print(f"Received {len(orders)} orders and {len(vehicles)} vehicles")
        
        # Run both algorithms
        print(f"\nRunning 2 optimization algorithms...")
        
        # Algorithm 1: Distance-First
        routes_distance, assigned_distance = distance_first_algorithm(orders.copy(), vehicles.copy())
        stats_distance = calculate_algorithm_stats(routes_distance, len(orders))
        
        # Algorithm 2: Time-First
        routes_time, assigned_time = time_first_algorithm(orders.copy(), vehicles.copy())
        stats_time = calculate_algorithm_stats(routes_time, len(orders))
        
        print(f"\n{'='*60}")
        print(f"COMPARISON RESULTS:")
        print(f"\nDistance-First:")
        print(f"   Total Distance: {stats_distance['totalDistance']}km")
        print(f"   On-Time: {stats_distance['onTimeDeliveries']}/{stats_distance['assignedOrders']} ({stats_distance['onTimeDeliveries']/stats_distance['assignedOrders']*100:.1f}%)")
        print(f"   Vehicles: {stats_distance['vehiclesUsed']}")
        print(f"   Utilization: {stats_distance['avgUtilization']:.1f}%")
        
        print(f"\nTime-First:")
        print(f"   Total Distance: {stats_time['totalDistance']}km (+{stats_time['totalDistance']-stats_distance['totalDistance']:.1f}km)")
        print(f"   On-Time: {stats_time['onTimeDeliveries']}/{stats_time['assignedOrders']} ({stats_time['onTimeDeliveries']/stats_time['assignedOrders']*100:.1f}%)")
        print(f"   Vehicles: {stats_time['vehiclesUsed']}")
        print(f"   Utilization: {stats_time['avgUtilization']:.1f}%")
        print(f"{'='*60}\n")
        
        # Prepare response with both algorithms
        response = {
            'algorithms': {
                'distanceFirst': {
                    'name': 'Distance-First',
                    'description': 'Minimizes total kilometers driven',
                    'routes': routes_distance,
                    'stats': stats_distance
                },
                'timeFirst': {
                    'name': 'Time-First',
                    'description': 'Maximizes on-time deliveries',
                    'routes': routes_time,
                    'stats': stats_time
                }
            },
            'totalOrders': len(orders),
            'totalVehicles': len(vehicles)
        }
        
        return jsonify(response), 200
        
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e)
        }), 500

@app.route('/api/recalculate-with-osrm', methods=['POST'])
def recalculate_with_osrm():
    """
    Recalculate routes using real OSRM road distances
    
    Request body:
    {
        "routes": [...] # Routes from chosen algorithm
    }
    
    Response:
    {
        "routes": [...], # Updated routes with real distances
        "stats": {...}   # Updated statistics
    }
    """
    try:
        data = request.json
        routes = data.get('routes', [])
        
        if not routes:
            return jsonify({'error': 'No routes provided'}), 400
        
        print(f"\n{'='*60}")
        print(f"Recalculating with OSRM for {len(routes)} routes...")
        
        depot_lat, depot_lng = 46.0569, 14.5058
        total_requests = 0
        failed_requests = 0
        
        # Recalculate each route with OSRM
        for route_idx, route in enumerate(routes):
            if not route.get('orders'):
                continue
            
            print(f"\n   Route {route_idx + 1}/{len(routes)}: {route['vehicle']['id']}")
            
            new_total_distance = 0
            current_lat, current_lng = depot_lat, depot_lng
            route_segments = []  # Store geometry for each segment
            
            # Calculate distance for each leg using OSRM
            for order_idx, order in enumerate(route['orders']):
                order_lat = order.get('lat', 0)
                order_lng = order.get('lng', 0)
                
                # Get real road distance and geometry
                road_distance, geometry = get_osrm_distance(current_lat, current_lng, order_lat, order_lng)
                total_requests += 1
                
                if road_distance is not None and geometry is not None:
                    new_total_distance += road_distance
                    route_segments.append({
                        'from': [current_lat, current_lng],
                        'to': [order_lat, order_lng],
                        'geometry': geometry,
                        'distance': road_distance
                    })
                    print(f"      Stop {order_idx + 1}: {road_distance:.1f}km")
                else:
                    # Fallback to estimated distance if OSRM fails
                    fallback_distance = calculate_distance(current_lat, current_lng, order_lat, order_lng, use_road_multiplier=True)
                    new_total_distance += fallback_distance
                    failed_requests += 1
                    # Store straight line as fallback
                    route_segments.append({
                        'from': [current_lat, current_lng],
                        'to': [order_lat, order_lng],
                        'geometry': [[current_lat, current_lng], [order_lat, order_lng]],
                        'distance': fallback_distance,
                        'fallback': True
                    })
                    print(f"      Stop {order_idx + 1}: {fallback_distance:.1f}km (estimated)")
                
                current_lat, current_lng = order_lat, order_lng
                
                # Rate limiting: OSRM allows ~60 requests/minute
                time.sleep(0.05)  # Small delay between requests
            
            # Distance back to depot
            return_distance, return_geometry = get_osrm_distance(current_lat, current_lng, depot_lat, depot_lng)
            total_requests += 1
            
            if return_distance is not None and return_geometry is not None:
                new_total_distance += return_distance
                route_segments.append({
                    'from': [current_lat, current_lng],
                    'to': [depot_lat, depot_lng],
                    'geometry': return_geometry,
                    'distance': return_distance,
                    'returnToDepot': True
                })
            else:
                fallback_return = calculate_distance(current_lat, current_lng, depot_lat, depot_lng, use_road_multiplier=True)
                new_total_distance += fallback_return
                failed_requests += 1
                route_segments.append({
                    'from': [current_lat, current_lng],
                    'to': [depot_lat, depot_lng],
                    'geometry': [[current_lat, current_lng], [depot_lat, depot_lng]],
                    'distance': fallback_return,
                    'returnToDepot': True,
                    'fallback': True
                })
            
            # Update route with real distance and geometry
            route['totalDistance'] = round(new_total_distance, 1)
            route['distanceType'] = 'road'  # Mark as real road distance
            route['routeSegments'] = route_segments  # Add route geometry
            
            print(f"   Total: {route['totalDistance']}km (real roads)")
        
        # Calculate updated statistics
        total_orders = sum(len(r['orders']) for r in routes)
        stats = calculate_algorithm_stats(routes, total_orders)
        
        print(f"\n{'='*60}")
        print(f"OSRM Recalculation Complete:")
        print(f"   Total API calls: {total_requests}")
        print(f"   Failed calls: {failed_requests}")
        print(f"   Success rate: {(total_requests-failed_requests)/total_requests*100:.1f}%")
        print(f"   New total distance: {stats['totalDistance']}km")
        print(f"{'='*60}\n")
        
        response = {
            'routes': routes,
            'stats': stats,
            'osrmStats': {
                'totalRequests': total_requests,
                'failedRequests': failed_requests,
                'successRate': round((total_requests-failed_requests)/total_requests*100, 1) if total_requests > 0 else 0
            }
        }
        
        return jsonify(response), 200
        
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Simple health check endpoint"""
    return jsonify({
        'status': 'ok', 
        'message': 'Backend is running with 2 algorithms'
    }), 200

if __name__ == '__main__':
    print("Starting Route Optimization Backend")
    print("Running on http://localhost:5000")
    print("Frontend should connect to: http://localhost:5000/api/optimize")
    print("2 Algorithms: Distance-First & Time-First")
    print("=" * 60)
    app.run(debug=True, port=5000)