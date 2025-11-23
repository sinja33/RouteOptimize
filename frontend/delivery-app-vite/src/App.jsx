import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { MapPin, Upload, X, Package, Trash2, Truck, Zap, AlertCircle, TrendingDown, Clock, Map as MapIcon } from 'lucide-react';

// Import pre-calculated solutions
import solutionSimple from './solution_simple.json';
import solutionEco from './solution_eco.json';
import solutionElectric from './solution_electric_vehicles.json';
import solutionTimeOnly from './solution_time_only.json';
// import solution5p5h from './solution_5p5h_shifts.json';
import solution7h from './solution_7h_shifts.json';
import solutionCustomVehicles from './solution_custom_vehicles.json';

const App = () => {
  const [orders, setOrders] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [uploadingOrders, setUploadingOrders] = useState(false);
  const [uploadingVehicles, setUploadingVehicles] = useState(false);
  // const [optimizing, setOptimizing] = useState(false);
  const [cacheCount, setCacheCount] = useState(0);
  const [algorithmResults, setAlgorithmResults] = useState(null);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState('distanceFirst');
  const [selectedSolution, setSelectedSolution] = useState(null); // For pre-loaded solutions
  const [visibleVehicles, setVisibleVehicles] = useState(new Set());
  const [recalculatingAlgo, setRecalculatingAlgo] = useState(null);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);

  const COLORS = ['#ff3b4a', '#00d4ff', '#7c3aed', '#f59e0b', '#10b981', 
                  '#ec4899', '#3b82f6', '#8b5cf6', '#f97316', '#14b8a6',
                  '#ef4444', '#06b6d4', '#a855f7', '#eab308', '#22c55e',
                  '#db2777', '#6366f1', '#d946ef', '#fb923c', '#2dd4bf'];

  // Pre-loaded solution strategies
  const SOLUTIONS = {
    simple: {
      name: 'Simple Route',
      description: 'Basic distance optimization',
      icon: MapIcon,
      data: solutionSimple
    },
    eco: {
      name: 'Eco-Friendly',
      description: 'Minimize CO2 emissions',
      icon: Zap,
      data: solutionEco
    },
    electric: {
      name: 'Electric Only',
      description: 'Use only electric vehicles',
      icon: Zap,
      data: solutionElectric
    },
    timeOnly: {
      name: 'Time Priority',
      description: 'Optimize for delivery windows',
      icon: Clock,
      data: solutionTimeOnly
    },
    shifts7h: {
      name: '7h Shifts',
      description: 'Standard driver shifts',
      icon: Clock,
      data: solution7h
    },
    customVehicles: {
      name: 'Rainy Conditions',
      description: 'Excluded vehicles unsuitable for rain',
      icon: Truck,
      data: solutionCustomVehicles
    }
  };

  // Update cache count on mount
  useEffect(() => {
    setCacheCount(Object.keys(localStorage).filter(key => key.startsWith('geocode_')).length);
  }, []);

  // Initialize Leaflet map
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => {
      setMapLoaded(true);
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(link);
      document.head.removeChild(script);
    };
  }, []);

  // Create map when Leaflet is loaded
  useEffect(() => {
    if (mapLoaded && !mapInstanceRef.current && mapRef.current) {
      const map = window.L.map(mapRef.current).setView([46.1512, 14.9955], 8);
      
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Ã‚Â© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);

      mapInstanceRef.current = map;
    }
  }, [mapLoaded]);

  // Geocode address using Nominatim (OpenStreetMap)
  const geocodeAddress = async (address) => {
    const cacheKey = `geocode_${address.toLowerCase().trim()}`;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      console.log('Using cached coordinates for:', address);
      return JSON.parse(cached);
    }
    
    try {
      const query = address.includes('Slovenia') ? address : `${address}, Slovenia`;
      console.log('Geocoding:', query);
      
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
      );
      
      if (!response.ok) {
        console.error('Geocoding API error:', response.status, response.statusText);
        return null;
      }
      
      const data = await response.json();
      
      if (data && data.length > 0) {
        const coords = {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        };
        
        localStorage.setItem(cacheKey, JSON.stringify(coords));
        setCacheCount(prev => prev + 1);
        
        return coords;
      }
      return null;
    } catch (error) {
      console.error('Geocoding error for address:', address, error);
      return null;
    }
  };

  // Handle Orders Excel file upload
  const handleOrdersUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploadingOrders(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      console.log('Excel data loaded:', jsonData.length, 'rows');

      const processedOrders = [];
      let skippedCount = 0;
      
      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        
        const street = row.street || row.Street || '';
        const houseNumber = row.house_number || row.houseNumber || row.house_num || '';
        const postalCode = row.postal_code || row.postalCode || row.postal || '';
        const city = row.city || row.City || '';
        
        let address = row.Address || row.address || row.Naslov || row.naslov || 
                     row.Adresa || row.adresa;
        
        if (!address) {
          if (street && city) {
            const parts = [street, houseNumber, postalCode, city].filter(p => p);
            address = parts.join(' ').trim();
          }
        }
        
        if (address) {
          console.log(`Processing order ${i + 1}/${jsonData.length}: ${address}`);
          
          const cacheKey = `geocode_${address.toLowerCase().trim()}`;
          const wasCached = localStorage.getItem(cacheKey) !== null;
          
          const coords = await geocodeAddress(address);
          
          if (coords) {
            const weight = parseFloat(row['Weight(kg)'] || row.Weight || row.weight || 0);
            const priority = row.Priority || row.priority || 'standard';
            const windowStart = row.WindowStart || row.window_start || '';
            const windowEnd = row.WindowEnd || row.window_end || '';
            
            processedOrders.push({
              id: row.OrderID || `ORD${String(i + 1).padStart(4, '0')}`,
              address: address,
              lat: coords.lat,
              lng: coords.lng,
              weight: weight,
              priority: priority.toLowerCase(),
              windowStart: windowStart,
              windowEnd: windowEnd,
              originalData: row
            });
            
            if (!wasCached && i < jsonData.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 1100));
            }
          } else {
            console.warn(`Ã¢Å“â€” Could not geocode: ${address}`);
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
      }

      console.log(`Processed ${processedOrders.length} orders, skipped ${skippedCount}`);
      setOrders(processedOrders);
      setUploadingOrders(false);
      
      if (processedOrders.length === 0) {
        alert('No valid addresses found.');
      }

      // Add markers for orders
      addOrderMarkers(processedOrders);

    } catch (error) {
      console.error('Error processing file:', error);
      alert(`Error processing file: ${error.message}`);
      setUploadingOrders(false);
    }
  };

  // Handle Vehicles Excel file upload
  const handleVehiclesUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploadingVehicles(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const processedVehicles = jsonData.map((row, idx) => {
        const columns = Object.keys(row);
        
        let maxCapacity = 0;
        for (const col of columns) {
          const lowerCol = col.toLowerCase().replace(/[_\s]/g, '');
          if (lowerCol.includes('capacity') || lowerCol.includes('maxcapacity')) {
            maxCapacity = parseFloat(row[col]) || 0;
            break;
          }
        }

        return {
          id: row.vehicle_id || row.vehicleId || row.id || row.ID || `V${idx}`,
          type: (row.type || row.Type || '').toLowerCase(),
          maxCapacity: maxCapacity,
          fuelType: (row.fuel_type || row.fuelType || row.fuel_Type || '').toLowerCase(),
          emissions: parseFloat(row.emission_g_co2_per_km || row.emissions || 0)
        };
      });

      console.log('Processed vehicles:', processedVehicles);
      setVehicles(processedVehicles);
      setUploadingVehicles(false);

    } catch (error) {
      console.error('Error processing vehicles file:', error);
      alert(`Error processing file: ${error.message}`);
      setUploadingVehicles(false);
    }
  };

  // Add order markers to map
  const addOrderMarkers = (ordersList) => {
    if (!mapInstanceRef.current) return;

    // Clear existing order markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    ordersList.forEach(order => {
      const marker = window.L.marker([order.lat, order.lng], {
        icon: window.L.divIcon({
          className: 'custom-marker',
          html: `<div class="marker-pin"></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 24]
        })
      }).addTo(mapInstanceRef.current);

      marker.bindPopup(`
        <div style="font-family: 'Inter', sans-serif;">
          <strong>${order.id}</strong><br/>
          ${order.address}<br/>
          Weight: ${order.weight}kg<br/>
          Priority: ${order.priority}<br/>
          Window: ${order.windowStart} - ${order.windowEnd}
        </div>
      `);

      markersRef.current.push(marker);
    });

    // Fit map to show all markers
    const allPoints = ordersList.map(o => [o.lat, o.lng]);
    
    if (allPoints.length > 0) {
      const bounds = window.L.latLngBounds(allPoints);
      mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  };

  // Call backend API for route optimization
  // const assignOrdersToVehicles = async () => {
  //   if (orders.length === 0 || vehicles.length === 0) {
  //     alert('Please upload both orders and vehicles first.');
  //     return;
  //   }

  //   setOptimizing(true);
  //   console.log('Calling backend for route optimization with 2 algorithms...');

  //   try {
  //     const response = await fetch('http://localhost:5000/api/optimize', {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json',
  //       },
  //       body: JSON.stringify({
  //         orders: orders,
  //         vehicles: vehicles
  //       })
  //     });

  //     if (!response.ok) {
  //       throw new Error(`Backend error: ${response.status}`);
  //     }

  //     const result = await response.json();
      
  //     console.log('Received algorithm results from backend:', result);
      
  //     setAlgorithmResults(result.algorithms);
  //     setSelectedAlgorithm('distanceFirst');
      
  //     // Initialize all vehicles as visible for default algorithm
  //     const defaultRoutes = result.algorithms.distanceFirst.routes;
  //     const allVehicleIds = new Set(defaultRoutes.map(r => r.vehicle.id));
  //     setVisibleVehicles(allVehicleIds);
      
  //     displayRoutesWithFilter(defaultRoutes, allVehicleIds);
  //     setOptimizing(false);

  //     alert(`âœ… Optimization Complete!\n\nCompared 2 algorithms:\nðŸ”µ Distance-First (lowest cost)\nðŸŸ¢ Time-First (best service)\n\nSelect an algorithm to view results.`);

  //   } catch (error) {
  //     console.error('Backend error:', error);
  //     setOptimizing(false);
  //     alert(`Ã¢ÂÅ’ Backend Error\n\nCouldn't connect to optimization backend.\n\nMake sure the Python backend is running:\npython backend_app.py\n\nError: ${error.message}`);
  //   }
  // };

  // Change selected algorithm
  const selectAlgorithm = (algoKey) => {
    setSelectedAlgorithm(algoKey);
    const routes = algorithmResults[algoKey].routes;
    const stats = algorithmResults[algoKey].stats;
    const allVehicleIds = new Set(routes.map(r => r.vehicle.id));
    setVisibleVehicles(allVehicleIds);
    displayRoutesWithFilter(routes, allVehicleIds);
    
    // Update driver app routes
    fetch('http://localhost:5000/api/driver/set-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routes, stats })
    }).catch(err => console.log('Driver app update failed:', err));
  };

  // Recalculate with OSRM real road distances
  const recalculateWithOSRM = async (algoKey) => {
    setRecalculatingAlgo(algoKey);
    console.log(`Recalculating ${algoKey} with OSRM...`);

    try {
      const routes = algorithmResults[algoKey].routes;

      const response = await fetch('http://localhost:5000/api/recalculate-with-osrm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          routes: routes
        })
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const result = await response.json();
      
      console.log('Received OSRM results:', result);

      // Update the algorithm results with new routes and stats
      setAlgorithmResults(prev => ({
        ...prev,
        [algoKey]: {
          ...prev[algoKey],
          routes: result.routes,
          stats: result.stats,
          distanceType: 'road' // Mark as using real road distances
        }
      }));

      // If this is the selected algorithm, update the display
      if (selectedAlgorithm === algoKey) {
        const allVehicleIds = new Set(result.routes.map(r => r.vehicle.id));
        setVisibleVehicles(allVehicleIds);
        displayRoutesWithFilter(result.routes, allVehicleIds);
        
        // Update driver app
        fetch('http://localhost:5000/api/driver/set-routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routes: result.routes, stats: result.stats })
        }).catch(err => console.log('Driver app update failed:', err));
      }

      setRecalculatingAlgo(null);
      alert('✅ Routes recalculated with real road distances!');

    } catch (error) {
      console.error('OSRM recalculation error:', error);
      setRecalculatingAlgo(null);
      alert(`⚠️ OSRM Recalculation Failed\n\n${error.message}`);
    }
  };

  // Load pre-calculated solution
  const loadSolution = async (solutionKey) => {
    const solution = SOLUTIONS[solutionKey];
    if (!solution || !solution.data) return;

    console.log(`Loading pre-calculated solution: ${solution.name}`);
    
    // First, ensure we have orders and vehicles loaded from the Excel files
    if (orders.length === 0) {
      alert('⚠️ Please upload orders.xlsx first to map the locations!');
      return;
    }

    setSelectedSolution(solutionKey);
    
    // Convert the solution format to match what the UI expects
    const solutionData = solution.data;
    
    console.log(`Solution has ${solutionData.routes.length} routes`);
    
    // Create a map of order IDs to full order data
    const orderMap = new Map();
    orders.forEach(order => {
      orderMap.set(order.id, order);
    });
    
    console.log(`Order map has ${orderMap.size} orders. Sample IDs:`, Array.from(orderMap.keys()).slice(0, 5));

    // Transform routes to match UI format
    const transformedRoutes = solutionData.routes.map((route, routeIdx) => {
      const color = COLORS[routeIdx % COLORS.length];
      
      console.log(`Processing route ${routeIdx + 1}/${solutionData.routes.length} for vehicle ${route.vehicle_id}`);
      
      // Extract orders from stops (skip depot stops)
      const routeOrders = route.stops
        .filter(stop => stop.location !== 'DEPOT')
        .map(stop => {
          const orderId = stop.location;
          const orderData = orderMap.get(orderId);
          
          if (!orderData) {
            console.warn(`Order ${orderId} not found in loaded orders`);
            return null;
          }

          return {
            ...orderData,
            arrivalTime: stop.arrival_time,
            arrivalMinutes: stop.arrival_minutes,
            onTime: true,
            lateness: 0
          };
        })
        .filter(order => order !== null);
      
      console.log(`  Route has ${routeOrders.length} valid orders`);

      return {
        vehicle: {
          id: route.vehicle_id,
          type: 'standard',
          maxCapacity: 1000 // Default capacity
        },
        orders: routeOrders,
        totalDistance: route.distance_km.toFixed(2),
        color: color,
        onTimeDeliveries: routeOrders.length,
        lateDeliveries: 0, // Pre-loaded solutions assume all on time
        routeSegments: [] // No OSRM segments for pre-loaded solutions, but we'll draw simple lines
      };
    });

    // After creating transformedRoutes, add simple route lines
    transformedRoutes.forEach(route => {
      if (route.orders.length > 0) {
        // Create coordinates array for the route
        const routeCoords = route.orders.map(order => [order.lat, order.lng]);
        
        // Store as simple segments (straight lines between stops)
        route.routeSegments = [];
        
        // Add segment for each consecutive pair of stops
        for (let i = 0; i < routeCoords.length - 1; i++) {
          route.routeSegments.push({
            geometry: [routeCoords[i], routeCoords[i + 1]],
            distance: 0, // We don't have distance per segment
            returnToDepot: false
          });
        }
        
        // Add return to depot line (from last order back to first order as approximation)
        if (routeCoords.length > 0) {
          route.routeSegments.push({
            geometry: [routeCoords[routeCoords.length - 1], routeCoords[0]],
            distance: 0,
            returnToDepot: true
          });
        }
      }
    });

    // Calculate summary stats
    const totalDistance = transformedRoutes.reduce((sum, r) => sum + parseFloat(r.totalDistance), 0);
    const totalOrders = transformedRoutes.reduce((sum, r) => sum + r.orders.length, 0);
    const vehiclesUsed = transformedRoutes.length;
    
    const stats = {
      totalDistance: totalDistance.toFixed(2),
      totalOrders: totalOrders,
      vehiclesUsed: vehiclesUsed,
      avgUtilization: totalOrders > 0 ? Math.round((totalOrders / vehiclesUsed) * 100 / 50) : 0, // Rough estimate
      lateDeliveries: 0,
      avgLateness: 0,
      co2Emissions: (totalDistance * 150).toFixed(0) // Rough estimate: 150g CO2/km
    };

    // Create algorithm result format
    const algorithmResult = {
      routes: transformedRoutes,
      stats: stats,
      distanceType: 'estimated'
    };

    // Set this as the only algorithm result
    setAlgorithmResults({
      [solutionKey]: algorithmResult
    });
    setSelectedAlgorithm(solutionKey);

    // Initialize all vehicles as visible
    const allVehicleIds = new Set(transformedRoutes.map(r => r.vehicle.id));
    setVisibleVehicles(allVehicleIds);
    
    // Display the routes
    displayRoutesWithFilter(transformedRoutes, allVehicleIds);
    
    console.log(`✅ Loaded ${solution.name}:`, {
      vehicles: vehiclesUsed,
      orders: totalOrders,
      distance: totalDistance.toFixed(2),
      routesWithOrders: transformedRoutes.filter(r => r.orders.length > 0).length
    });
    
    // Update driver app
    fetch('http://localhost:5000/api/driver/set-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routes: transformedRoutes, stats })
    }).catch(err => console.log('Driver app update failed:', err));
  };
  // Toggle vehicle visibility
  const toggleVehicle = (vehicleId) => {
    if (!algorithmResults) return;
    
    const newVisible = new Set(visibleVehicles);
    if (newVisible.has(vehicleId)) {
      newVisible.delete(vehicleId);
    } else {
      newVisible.add(vehicleId);
    }
    setVisibleVehicles(newVisible);
    
    const routes = algorithmResults[selectedAlgorithm].routes;
    displayRoutesWithFilter(routes, newVisible);
  };

  // Show all vehicles
  const showAllVehicles = () => {
    if (!algorithmResults) return;
    const routes = algorithmResults[selectedAlgorithm].routes;
    const allVehicleIds = new Set(routes.map(r => r.vehicle.id));
    setVisibleVehicles(allVehicleIds);
    displayRoutesWithFilter(routes, allVehicleIds);
  };

  // Hide all vehicles
  const hideAllVehicles = () => {
    if (!algorithmResults) return;
    const routes = algorithmResults[selectedAlgorithm].routes;
    const emptySet = new Set();
    setVisibleVehicles(emptySet);
    displayRoutesWithFilter(routes, emptySet);
  };

  // Display routes on map
  const displayRoutesWithFilter = (routes, filterSet = null) => {
    if (!mapInstanceRef.current) return;

    const vehiclesToShow = filterSet || visibleVehicles;

    // Clear existing order markers and polylines
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    
    polylinesRef.current.forEach(polyline => polyline.remove());
    polylinesRef.current = [];

    // Draw routes (only for visible vehicles)
    routes.forEach((route) => {
      if (!vehiclesToShow.has(route.vehicle.id)) return;
      
      if (route.orders.length === 0) return;

      // Draw route polylines if OSRM geometry exists
      if (route.routeSegments && route.routeSegments.length > 0) {
        route.routeSegments.forEach((segment, idx) => {
          const polyline = window.L.polyline(segment.geometry, {
            color: route.color,
            weight: 4,
            opacity: 0.7,
            lineJoin: 'round',
            lineCap: 'round',
            // Dashed line for return to depot
            dashArray: segment.returnToDepot ? '10, 10' : null
          }).addTo(mapInstanceRef.current);

          // Add popup to show segment info
          polyline.bindPopup(`
            <div style="font-family: 'Inter', sans-serif;">
              <strong>${route.vehicle.id}</strong><br/>
              ${segment.returnToDepot ? 'Return to depot' : `Segment ${idx + 1}`}<br/>
              Distance: ${segment.distance.toFixed(1)}km<br/>
              ${segment.fallback ? 'âœˆï¸ Estimated (OSRM unavailable)' : 'ðŸ›£ï¸ Real road distance'}
            </div>
          `);

          polylinesRef.current.push(polyline);
        });
      }

      // Add markers for orders in this route
      route.orders.forEach((order, idx) => {
        const marker = window.L.marker([order.lat, order.lng], {
          icon: window.L.divIcon({
            className: 'route-marker',
            html: `<div class="route-pin" style="background: ${route.color};">${idx + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          })
        }).addTo(mapInstanceRef.current);

        const onTimeStatus = order.onTime ? 'âœ… On Time' : `Late by ${order.lateness} min`;
        
        marker.bindPopup(`
          <div style="font-family: 'Inter', sans-serif;">
            <strong>Stop ${idx + 1} - ${order.id}</strong><br/>
            Vehicle: ${route.vehicle.id}<br/>
            ${order.address}<br/>
            Weight: ${order.weight}kg<br/>
            Priority: ${order.priority}<br/>
            ${onTimeStatus}
          </div>
        `);

        markersRef.current.push(marker);
      });
    });
  };

  const clearAll = () => {
    setOrders([]);
    setVehicles([]);
    setAlgorithmResults(null);
    setSelectedAlgorithm('distanceFirst');
    setSelectedSolution(null);
    setVisibleVehicles(new Set());
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    polylinesRef.current.forEach(polyline => polyline.remove());
    polylinesRef.current = [];
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([46.1512, 14.9955], 8);
    }
  };

  const clearGeocodeCache = () => {
    let count = 0;
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('geocode_')) {
        localStorage.removeItem(key);
        count++;
      }
    });
    setCacheCount(0);
    alert(`Cleared ${count} cached addresses`);
  };

  // Get current routes
  const currentRoutes = algorithmResults && selectedAlgorithm 
    ? algorithmResults[selectedAlgorithm].routes 
    : [];

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      margin: 0,
      padding: 0,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      background: '#0a0e14',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@300;400;600;700&display=swap');
        
        body {
          margin: 0;
          padding: 0;
          overflow: hidden;
        }

        .marker-pin {
          width: 24px;
          height: 24px;
          background: #ff3b4a;
          border: 3px solid #fff;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 4px 12px rgba(255, 59, 74, 0.5);
          animation: markerPop 0.3s ease-out;
        }

        .route-pin {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 3px solid white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: white;
          font-size: 12px;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
        }

        @keyframes markerPop {
          0% {
            transform: scale(0);
          }
          50% {
            transform: scale(1.2);
          }
          100% {
            transform: scale(1);
          }
        }

        .custom-marker, .route-marker {
          background: transparent !important;
          border: none !important;
        }

        .leaflet-popup-content-wrapper {
          background: #1a1f2e;
          color: #e0e6ed;
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }

        .leaflet-popup-tip {
          background: #1a1f2e;
        }

        @keyframes slideIn {
          from {
            transform: translateX(-100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      {/* Sidebar */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '420px',
        background: 'linear-gradient(135deg, #1a1f2e 0%, #252d3d 100%)',
        boxShadow: '4px 0 24px rgba(0, 0, 0, 0.3)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideIn 0.5s ease-out',
        overflowY: 'auto'
      }}>
        {/* Header */}
        <div style={{
          padding: '32px 28px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '8px'
          }}>
            <Package size={28} color="#ff3b4a" strokeWidth={2.5} />
            <h1 style={{
              margin: 0,
              fontSize: '24px',
              fontWeight: '700',
              color: '#ffffff',
              fontFamily: "'Space Mono', monospace",
              letterSpacing: '-0.5px'
            }}>
              RouteOptimize
            </h1>
          </div>
          <p style={{
            margin: 0,
            fontSize: '13px',
            color: '#8b95a5',
            fontWeight: '400',
            letterSpacing: '0.3px'
          }}>
            Smart Route Optimization
          </p>
        </div>

        {/* Content */}
        <div style={{ padding: '24px 28px', flex: 1 }}>
          
          {/* Orders Upload */}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{
              margin: '0 0 12px 0',
              fontSize: '12px',
              fontWeight: '700',
              color: '#e0e6ed',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontFamily: "'Space Mono', monospace"
            }}>
              1. Upload Orders
            </h3>
            <label htmlFor="orders-upload" style={{
              display: 'block',
              width: '90%',
              padding: '16px',
              background: uploadingOrders ? 'rgba(255, 59, 74, 0.1)' : 'rgba(255, 59, 74, 0.05)',
              border: `2px dashed ${uploadingOrders ? '#ff3b4a' : 'rgba(255, 59, 74, 0.3)'}`,
              borderRadius: '10px',
              textAlign: 'center',
              cursor: uploadingOrders ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease'
            }}>
              <input
                id="orders-upload"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleOrdersUpload}
                disabled={uploadingOrders}
                style={{ display: 'none' }}
              />
              <Upload size={24} color={uploadingOrders ? '#ff3b4a' : '#8b95a5'} 
                style={{ marginBottom: '8px' }} />
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: uploadingOrders ? '#ff3b4a' : '#e0e6ed',
                marginBottom: '2px'
              }}>
                {uploadingOrders ? 'Processing...' : orders.length > 0 ? `${orders.length} orders loaded` : 'Upload Orders Excel'}
              </div>
              <div style={{
                fontSize: '11px',
                color: '#6b7684'
              }}>
                {uploadingOrders ? 'Geocoding addresses' : '.xlsx or .xls file'}
              </div>
            </label>
          </div>

          {/* Vehicles Upload */}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{
              margin: '0 0 12px 0',
              fontSize: '12px',
              fontWeight: '700',
              color: '#e0e6ed',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontFamily: "'Space Mono', monospace"
            }}>
              2. Upload Vehicles
            </h3>
            <label htmlFor="vehicles-upload" style={{
              display: 'block',
              width: '90%',
              padding: '16px',
              background: uploadingVehicles ? 'rgba(0, 212, 255, 0.1)' : 'rgba(0, 212, 255, 0.05)',
              border: `2px dashed ${uploadingVehicles ? '#00d4ff' : 'rgba(0, 212, 255, 0.3)'}`,
              borderRadius: '10px',
              textAlign: 'center',
              cursor: uploadingVehicles ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease'
            }}>
              <input
                id="vehicles-upload"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleVehiclesUpload}
                disabled={uploadingVehicles}
                style={{ display: 'none' }}
              />
              <Truck size={24} color={uploadingVehicles ? '#00d4ff' : '#8b95a5'} 
                style={{ marginBottom: '8px' }} />
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: uploadingVehicles ? '#00d4ff' : '#e0e6ed',
                marginBottom: '2px'
              }}>
                {uploadingVehicles ? 'Loading...' : vehicles.length > 0 ? `${vehicles.length} vehicles loaded` : 'Upload Vehicles Excel'}
              </div>
              <div style={{
                fontSize: '11px',
                color: '#6b7684'
              }}>
                .xlsx or .xls file
              </div>
            </label>
          </div>

          {/* Optimize Button */}
          {/* <button
            onClick={assignOrdersToVehicles}
            disabled={orders.length === 0 || vehicles.length === 0 || optimizing}
            style={{
              width: '100%',
              padding: '18px',
              background: (orders.length === 0 || vehicles.length === 0 || optimizing) 
                ? 'rgba(255, 255, 255, 0.05)' 
                : 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
              border: 'none',
              borderRadius: '12px',
              color: (orders.length === 0 || vehicles.length === 0 || optimizing) ? '#6b7684' : '#ffffff',
              fontSize: '14px',
              fontWeight: '700',
              cursor: (orders.length === 0 || vehicles.length === 0 || optimizing) ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease',
              marginBottom: '24px',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontFamily: "'Space Mono', monospace",
              boxShadow: (orders.length > 0 && vehicles.length > 0 && !optimizing) 
                ? '0 8px 20px rgba(124, 58, 237, 0.4)' 
                : 'none'
            }}
          >
            {optimizing ? '⚡ Optimizing...' : '🚀 Compare Algorithms'}
          </button> */}

          {/* Pre-loaded Solutions Section */}
          {orders.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{
                margin: '0 0 12px 0',
                fontSize: '12px',
                fontWeight: '700',
                color: '#e0e6ed',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                fontFamily: "'Space Mono', monospace"
              }}>
                Load Pre-Calculated Solutions
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px'
              }}>
                {Object.entries(SOLUTIONS).map(([key, solution]) => {
                  const Icon = solution.icon;
                  const isSelected = selectedSolution === key;
                  
                  return (
                    <button
                      key={key}
                      onClick={() => loadSolution(key)}
                      style={{
                        background: isSelected 
                          ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(168, 85, 247, 0.15))' 
                          : 'rgba(255, 255, 255, 0.03)',
                        border: isSelected 
                          ? '2px solid rgba(124, 58, 237, 0.5)' 
                          : '2px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '10px',
                        padding: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        textAlign: 'left'
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '6px'
                      }}>
                        <Icon size={16} color={isSelected ? '#a855f7' : '#8b95a5'} />
                        <div style={{
                          fontSize: '11px',
                          fontWeight: '700',
                          color: isSelected ? '#e0e6ed' : '#8b95a5',
                          fontFamily: "'Space Mono', monospace"
                        }}>
                          {solution.name}
                        </div>
                      </div>
                      <div style={{
                        fontSize: '9px',
                        color: '#6b7684',
                        lineHeight: '1.3'
                      }}>
                        {solution.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Algorithm Comparison */}
          {algorithmResults && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{
                margin: '0 0 16px 0',
                fontSize: '12px',
                fontWeight: '700',
                color: '#e0e6ed',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                fontFamily: "'Space Mono', monospace"
              }}>
                Algorithm Comparison
              </h3>
              
              {/* Algorithm Cards */}
              {Object.entries(algorithmResults).map(([key, algo]) => {
                const isRecalculating = recalculatingAlgo === key;
                const isRoadDistance = algo.distanceType === 'road';
                
                return (
                <div
                  key={key}
                  style={{
                    background: selectedAlgorithm === key 
                      ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(168, 85, 247, 0.15))' 
                      : 'rgba(255, 255, 255, 0.03)',
                    padding: '16px',
                    borderRadius: '12px',
                    border: selectedAlgorithm === key 
                      ? '2px solid rgba(124, 58, 237, 0.5)' 
                      : '2px solid transparent',
                    marginBottom: '12px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {/* Algorithm Header */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '8px'
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '14px',
                        fontWeight: '700',
                        color: '#e0e6ed',
                        fontFamily: "'Space Mono', monospace",
                        marginBottom: '4px'
                      }}>
                        {key === 'distanceFirst' && 'Ã°Å¸â€Âµ'} 
                        {key === 'timeFirst' && 'Ã°Å¸Å¸Â¢'} 
                        {' '}{SOLUTIONS[key]?.name || algo.name || key}
                      </div>
                      <div style={{
                        fontSize: '10px',
                        color: '#8b95a5',
                        marginBottom: '8px'
                      }}>
                        {SOLUTIONS[key]?.description || algo.description || ''}
                      </div>
                      
                      {/* Distance Type Badge */}
                      <div style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '9px',
                        fontWeight: '600',
                        background: isRoadDistance 
                          ? 'rgba(16, 185, 129, 0.1)' 
                          : 'rgba(245, 158, 11, 0.1)',
                        color: isRoadDistance ? '#10b981' : '#f59e0b',
                        border: `1px solid ${isRoadDistance ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
                      }}>
                        {isRoadDistance ? 'Real Roads' : 'Estimated Distances'}
                      </div>
                    </div>
                    
                    {/* Choose Button */}
                    <button
                      onClick={() => recalculateWithOSRM(key)}
                      disabled={isRecalculating}
                      style={{
                        padding: '8px 16px',
                        background: isRecalculating 
                          ? 'rgba(124, 58, 237, 0.2)' 
                          : 'linear-gradient(135deg, #7c3aed, #a855f7)',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: isRecalculating ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s ease',
                        fontFamily: "'Space Mono', monospace",
                        marginLeft: '8px'
                      }}
                      onMouseEnter={(e) => {
                        if (!isRecalculating) {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(124, 58, 237, 0.4)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      {isRecalculating ? '⏳ Calculating...' : isRoadDistance ? 'Real Roads' : 'Get Real Roads'}
                    </button>
                  </div>

                  {/* View Button - only show if not selected */}
                  {selectedAlgorithm !== key && (
                    <button
                      onClick={() => selectAlgorithm(key)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'transparent',
                        border: '1px solid rgba(124, 58, 237, 0.3)',
                        borderRadius: '6px',
                        color: '#a855f7',
                        fontSize: '10px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        marginBottom: '12px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(124, 58, 237, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      ðŸ‘ï¸ View on Map
                    </button>
                  )}

                  {/* Stats Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    fontSize: '11px'
                  }}>
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.2)',
                      padding: '8px',
                      borderRadius: '6px'
                    }}>
                      <div style={{ color: '#8b95a5', marginBottom: '2px' }}>
                        <TrendingDown size={12} style={{ display: 'inline', marginRight: '4px' }} />
                        Total Distance
                      </div>
                      <div style={{ color: '#e0e6ed', fontWeight: '700' }}>
                        {algo.stats.totalDistance} km
                      </div>
                    </div>
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.2)',
                      padding: '8px',
                      borderRadius: '6px'
                    }}>
                      <div style={{ color: '#8b95a5', marginBottom: '2px' }}>
                        <Clock size={12} style={{ display: 'inline', marginRight: '4px' }} />
                        On Time
                      </div>
                      <div style={{ color: '#e0e6ed', fontWeight: '700' }}>
                        {algo.stats.onTimeDeliveries}/{algo.stats.assignedOrders}
                      </div>
                    </div>
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.2)',
                      padding: '8px',
                      borderRadius: '6px'
                    }}>
                      <div style={{ color: '#8b95a5', marginBottom: '2px' }}>
                        <Truck size={12} style={{ display: 'inline', marginRight: '4px' }} />
                        Vehicles Used
                      </div>
                      <div style={{ color: '#e0e6ed', fontWeight: '700' }}>
                        {algo.stats.vehiclesUsed}
                      </div>
                    </div>
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.2)',
                      padding: '8px',
                      borderRadius: '6px'
                    }}>
                      <div style={{ color: '#8b95a5', marginBottom: '2px' }}>
                        <Package size={12} style={{ display: 'inline', marginRight: '4px' }} />
                        Utilization
                      </div>
                      <div style={{ color: '#e0e6ed', fontWeight: '700' }}>
                        {algo.stats.avgUtilization}%
                      </div>
                    </div>
                  </div>
                  
                  {algo.stats.lateDeliveries > 0 && (
                    <div style={{
                      marginTop: '8px',
                      padding: '6px 8px',
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '6px',
                      fontSize: '10px',
                      color: '#f59e0b'
                    }}>
                      {algo.stats.lateDeliveries} late ({algo.stats.avgLateness} min avg)
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          )}

          {/* Vehicle Filters */}
          {currentRoutes.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px'
              }}>
                <h3 style={{
                  margin: 0,
                  fontSize: '12px',
                  fontWeight: '700',
                  color: '#e0e6ed',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  fontFamily: "'Space Mono', monospace"
                }}>
                  Vehicle Filters
                </h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={showAllVehicles}
                    style={{
                      background: 'transparent',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#8b95a5',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '10px'
                    }}
                  >
                    All
                  </button>
                  <button
                    onClick={hideAllVehicles}
                    style={{
                      background: 'transparent',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#8b95a5',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '10px'
                    }}
                  >
                    None
                  </button>
                </div>
              </div>

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                maxHeight: '300px',
                overflowY: 'auto'
              }}>
                {currentRoutes.map((route) => (
                  <label key={route.vehicle.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    borderLeft: `3px solid ${route.color}`
                  }}>
                    <input
                      type="checkbox"
                      checked={visibleVehicles.has(route.vehicle.id)}
                      onChange={() => toggleVehicle(route.vehicle.id)}
                      style={{
                        width: '16px',
                        height: '16px',
                        cursor: 'pointer',
                        accentColor: route.color
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#e0e6ed',
                        fontFamily: "'Space Mono', monospace"
                      }}>
                        {route.vehicle.id}
                      </div>
                      <div style={{
                        fontSize: '10px',
                        color: '#8b95a5'
                      }}>
                        {route.orders.length} stops, {route.totalDistance}km, {route.onTimeDeliveries}/{route.orders.length} on time
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Cache Info */}
          {cacheCount > 0 && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              marginBottom: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{
                fontSize: '11px',
                color: '#8b95a5'
              }}>
                {cacheCount} addresses cached
              </div>
              <button
                onClick={clearGeocodeCache}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#8b95a5',
                  cursor: 'pointer',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '10px'
                }}
              >
                Clear
              </button>
            </div>
          )}

          {/* Clear All */}
          {(orders.length > 0 || vehicles.length > 0) && (
            <button
              onClick={clearAll}
              style={{
                width: '100%',
                padding: '12px',
                background: 'transparent',
                border: '1px solid rgba(255, 59, 74, 0.3)',
                borderRadius: '8px',
                color: '#8b95a5',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <Trash2 size={14} />
              Clear All Data
            </button>
          )}
        </div>
      </div>

      {/* Map Container */}
      <div ref={mapRef} style={{
        position: 'absolute',
        left: '420px',
        right: 0,
        top: 0,
        bottom: 0,
        background: '#e5e7eb'
      }} />

      {/* Loading overlay */}
      {!mapLoaded && (
        <div style={{
          position: 'absolute',
          left: '420px',
          right: 0,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0e14',
          color: '#8b95a5',
          fontSize: '14px',
          fontFamily: "'Space Mono', monospace"
        }}>
          Loading map...
        </div>
      )}
    </div>
  );
};

export default App;