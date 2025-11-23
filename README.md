# RouteOptimize - Delivery Route Optimization System

A comprehensive AI-powered delivery route optimization system designed for the Epilog challenge, helping logistics companies in Slovenia reduce fuel costs, delivery times, and environmental impact through intelligent route planning.

## Overview

RouteOptimize is a full-stack application that combines advanced routing algorithms with an intuitive interface to optimize delivery routes for logistics companies, e-commerce deliverers, retail chains, and courier services. The system can achieve 15-25% reductions in kilometers driven, potentially saving medium-sized logistics companies 50,000-150,000 EUR annually.

## Features

### Core Optimization
- **Multiple Algorithm Support**: Two proven optimization strategies
  - **Distance-First**: Minimizes total kilometers driven (lowest cost)
  - **Time-First**: Maximizes on-time deliveries (best service)
- **Real Road Distance Calculation**: Integration with OSRM (OpenStreetMap Routing Machine) for accurate real-world routing
- **Time Window Management**: Respects delivery time constraints with configurable maximum lateness limits
- **Vehicle Capacity Management**: Considers weight limits and vehicle capabilities
- **Pre-calculated Solutions**: 6 ready-to-use optimization scenarios for common use cases

### Admin Application
- **Interactive Route Visualization**: Leaflet-based mapping with color-coded routes
- **Collapsible Sidebar**: Toggle interface for maximum map viewing area
- **Excel Upload Support**: Easy data import for orders and vehicles
- **Algorithm Comparison**: Side-by-side comparison of optimization strategies
- **Vehicle Filtering**: Show/hide specific routes for detailed analysis
- **Address Geocoding**: Automatic conversion of addresses to coordinates with caching

### Mobile Driver App
- **Vehicle Selection**: Choose assigned vehicle and view route details
- **Interactive Route Map**: Visual representation of delivery sequence
- **Delivery Tracking**: Mark deliveries as completed in real-time
- **Progress Monitoring**: Track completion status throughout the day
- **Sync with Admin System**: Automatic updates when routes are optimized

## Tech Stack

### Frontend
- **React**: Modern UI framework
- **Leaflet**: Interactive mapping library
- **Lucide React**: Icon library
- **XLSX**: Excel file processing

### Backend
- **Python 3**: Core optimization engine
- **Flask**: REST API framework
- **CORS**: Cross-origin resource sharing

### APIs & Services
- **OSRM**: Real road distance and route geometry
- **Nominatim**: Address geocoding (OpenStreetMap)

## Project Structure

```
hackaton/
├── frontend/          # Admin React application
│   ├── App.jsx       # Main admin interface
│   ├── solution_*.json  # Pre-calculated optimization results
│   └── ...
├── backend/          # Python Flask API
│   └── backend_app.py  # Optimization algorithms and API endpoints
└── driver-app/       # Mobile driver interface
    └── App.js        # Driver application
```

## Installation

### Prerequisites
- Node.js (v14 or higher)
- Python 3.8+
- npm or yarn

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install Python dependencies:
```bash
pip install flask flask-cors
```

3. Start the backend server:
```bash
python backend_app.py
```

The backend will run on `http://localhost:5000`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

The admin app will run on `http://localhost:3000`

### Driver App Setup

1. Navigate to the driver-app directory:
```bash
cd driver-app
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

The driver app will run on `http://localhost:3001`

## Usage

### Admin Application

1. **Upload Data**
   - Click "Upload Orders Excel" and select your orders file (must contain address, weight, priority, time windows)
   - Click "Upload Vehicles Excel" and select your vehicles file (must contain ID, capacity, type)

2. **Choose Optimization Strategy**
   - Select from 6 pre-calculated solutions:
     - **Simple Route**: Basic distance optimization
     - **Eco-Friendly**: Minimize CO2 emissions
     - **Electric Only**: Use only electric vehicles
     - **Time Priority**: Optimize for delivery windows
     - **7h Shifts**: Standard driver shifts
     - **Rainy Conditions**: Bikes are excluded

3. **Analyze Results**
   - View statistics: total distance, on-time deliveries, vehicle utilization
   - Toggle visibility of individual vehicle routes
   - Zoom and pan the map to examine specific areas

4. **Collapse/Expand Sidebar**
   - Click the chevron button in the top-right of the sidebar to maximize map viewing area

### Driver App

1. **Select Vehicle**
   - Open the driver app and view available vehicles
   - Each card shows number of stops and total distance
   - Tap a vehicle to view its route

2. **Follow Route**
   - View the complete route on an interactive map
   - See delivery sequence with numbered markers
   - Current delivery is highlighted in color
   - Completed deliveries show green checkmarks

3. **Complete Deliveries**
   - Tap "Complete Delivery" when arriving at a stop
   - Progress automatically updates
   - View remaining deliveries at the bottom

4. **Return to Vehicle Selection**
   - Use the back button to choose a different vehicle
   - Routes sync automatically with admin app

## Data Formats

### Orders Excel Format
Required columns:
- `Address` or `street`, `house_number`, `postal_code`, `city`
- `Weight(kg)` or `Weight` or `weight`
- `Priority` (optional: standard, urgent)
- `WindowStart` (optional: HH:MM format)
- `WindowEnd` (optional: HH:MM format)
- `OrderID` (optional, auto-generated if missing)

Example:
```
OrderID | Address                      | Weight(kg) | Priority | WindowStart | WindowEnd
ORD0001 | Slovenska cesta 1, Ljubljana | 5.2        | standard | 09:00       | 12:00
ORD0002 | Trubarjeva 10, Ljubljana     | 3.8        | urgent   | 08:00       | 10:00
```

### Vehicles Excel Format
Required columns:
- `VehicleID` or `ID`
- `Capacity(kg)` or `Capacity`
- `Type` (optional: van, truck, bike, electric)

Example:
```
VehicleID | Capacity(kg) | Type
VAN01     | 1000         | van
BIKE01    | 30           | bike
TRUCK01   | 3000         | truck
```

## API Endpoints

### Backend API

#### `POST /api/optimize`
Optimize routes using both algorithms.

**Request:**
```json
{
  "orders": [...],
  "vehicles": [...]
}
```

**Response:**
```json
{
  "algorithms": {
    "distanceFirst": {
      "name": "Distance-First",
      "routes": [...],
      "stats": {...}
    },
    "timeFirst": {
      "name": "Time-First",
      "routes": [...],
      "stats": {...}
    }
  }
}
```

#### `POST /api/recalculate-with-osrm`
Recalculate routes with real OSRM road distances.

#### `GET /api/driver/vehicles`
Get list of available vehicles for driver app.

#### `GET /api/driver/route/{vehicle_id}`
Get detailed route for specific vehicle.

#### `POST /api/driver/set-routes`
Update routes available to driver app.

#### `GET /api/health`
Health check endpoint.

## Algorithms

### Distance-First Algorithm
- **Goal**: Minimize total kilometers driven
- **Strategy**: Assigns orders to nearest available vehicle with capacity
- **Use Case**: Cost optimization, fuel savings
- **Constraint**: Maximum 240 minutes lateness allowed

### Time-First Algorithm
- **Goal**: Maximize on-time deliveries
- **Strategy**: Prioritizes orders by urgency and time windows
- **Use Case**: Customer service optimization, premium deliveries
- **Constraint**: Maximum 120 minutes lateness allowed

### Distance Calculation Stages
1. **Estimated Distance**: Quick Euclidean calculation for comparisons
2. **Road Multiplier**: 1.3x multiplier for realistic routing estimates
3. **OSRM Integration**: Precise real road distances when recalculation is triggered

## Performance Metrics

The system tracks comprehensive statistics for each optimization:
- **Total Distance**: Sum of all route kilometers
- **Assigned Orders**: Number of successfully routed deliveries
- **Unassigned Orders**: Orders that couldn't be assigned
- **Vehicles Used**: Number of vehicles with routes
- **On-Time Deliveries**: Deliveries within time windows
- **Late Deliveries**: Deliveries exceeding time windows
- **Average Lateness**: Mean lateness in minutes
- **Average Utilization**: Mean vehicle capacity usage percentage

## Environmental Impact

By reducing delivery distances by 15-25%, RouteOptimize helps address Slovenia's transport-related CO2 emissions (27% of total emissions). A medium-sized logistics company can expect:
- 50,000-150,000 EUR annual savings
- Significant reduction in fuel consumption
- Lower carbon footprint
- Improved operational efficiency

## Caching & Performance

### Address Geocoding Cache
- Automatically caches geocoded addresses in browser localStorage
- Prevents repeated API calls for known addresses
- View cache count in sidebar
- Clear cache button available

### Rate Limiting
- Nominatim API: 1 request per second (respected automatically)
- OSRM API: Unlimited for self-hosted instances

## Troubleshooting

### Backend Connection Issues
If you see "Couldn't connect to optimization backend":
1. Ensure Python backend is running: `python backend_app.py`
2. Check backend is on port 5000
3. Verify no firewall blocking localhost connections

### Geocoding Failures
If addresses fail to geocode:
1. Check address format includes city/country
2. Verify internet connection
3. Clear geocoding cache and retry
4. Consider more specific addresses

### Map Not Loading
If map doesn't display:
1. Check browser console for errors
2. Verify Leaflet CDN is accessible
3. Clear browser cache
4. Try different browser

### Mobile App No Routes
If driver app shows no routes:
1. Run optimization in admin app first
2. Select an algorithm in admin app
3. Ensure backend is running
4. Refresh driver app

## Future Enhancements

- Multi-depot support
- Dynamic route updates (real-time order additions)
- Traffic integration
- Driver break time optimization
- Historical data analysis
- Route comparison history
- Export to PDF/Excel
- Mobile notifications
- GPS tracking integration

## Contributing

This project was developed for the Epilog challenge. For questions or contributions, please contact the development team.

## License

[Specify your license here]

## Acknowledgments

- OpenStreetMap for mapping data
- OSRM for routing engine
- Nominatim for geocoding services
- Leaflet for mapping library
- The logistics companies who provided feedback during development

---

**Version**: 1.0  
**Last Updated**: November 2025  
**Developed for**: Epilog Challenge - Smart Technologies in Logistics