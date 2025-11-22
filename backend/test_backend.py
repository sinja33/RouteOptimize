import requests
import json

# Test backend API
def test_backend():
    print("🧪 Testing Route Optimization Backend\n")
    
    # 1. Health check
    print("1. Health Check...")
    try:
        response = requests.get('http://localhost:5000/api/health')
        if response.status_code == 200:
            print("   ✅ Backend is running!")
        else:
            print(f"   ❌ Backend returned status {response.status_code}")
            return
    except Exception as e:
        print(f"   ❌ Cannot connect to backend: {e}")
        print("   Make sure to run: python backend_app.py")
        return
    
    # 2. Test optimization with sample data
    print("\n2. Testing Optimization API...")
    
    sample_orders = [
        {
            "id": "ORD001",
            "address": "Prešernova cesta 1, Ljubljana",
            "lat": 46.0514,
            "lng": 14.5060,
            "weight": 15.5,
            "priority": "express"
        },
        {
            "id": "ORD002",
            "address": "Slovenska cesta 50, Ljubljana",
            "lat": 46.0569,
            "lng": 14.5058,
            "weight": 8.2,
            "priority": "standard"
        },
        {
            "id": "ORD003",
            "address": "Dunajska cesta 20, Ljubljana",
            "lat": 46.0644,
            "lng": 14.5119,
            "weight": 22.1,
            "priority": "urgent"
        }
    ]
    
    sample_vehicles = [
        {
            "id": "V001",
            "type": "truck",
            "maxCapacity": 100,
            "fuelType": "diesel"
        },
        {
            "id": "V002",
            "type": "van",
            "maxCapacity": 50,
            "fuelType": "electric"
        }
    ]
    
    try:
        response = requests.post(
            'http://localhost:5000/api/optimize',
            json={
                "orders": sample_orders,
                "vehicles": sample_vehicles
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            print("   ✅ Optimization successful!")
            print(f"\n   Stats:")
            print(f"   - Total Orders: {result['stats']['totalOrders']}")
            print(f"   - Assigned Orders: {result['stats']['assignedOrders']}")
            print(f"   - Used Vehicles: {result['stats']['usedVehicles']}")
            print(f"\n   Routes:")
            for route in result['routes']:
                print(f"   - {route['vehicle']['id']}: {len(route['orders'])} orders, {route['totalWeight']}kg")
        else:
            print(f"   ❌ Optimization failed with status {response.status_code}")
            print(f"   Response: {response.text}")
            
    except Exception as e:
        print(f"   ❌ Error calling optimization API: {e}")
    
    print("\n✅ All tests completed!")

if __name__ == '__main__':
    test_backend()
