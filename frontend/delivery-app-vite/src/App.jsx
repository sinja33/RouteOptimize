import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { MapPin, Upload, X, Package, Trash2, Truck, Zap, AlertCircle, TrendingDown, Clock, Map } from 'lucide-react';

const App = () => {
  const [orders, setOrders] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [uploadingOrders, setUploadingOrders] = useState(false);
  const [uploadingVehicles, setUploadingVehicles] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [cacheCount, setCacheCount] = useState(0);
  const [algorithmResults, setAlgorithmResults] = useState(null);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState('distanceFirst');
  const [visibleVehicles, setVisibleVehicles] = useState(new Set());
  const [recalculatingAlgo, setRecalculatingAlgo] = useState(null); // Track which algo is recalculating
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]); // Store polyline layers

  const COLORS = ['#ff3b4a', '#00d4ff', '#7c3aed', '#f59e0b', '#10b981', 
                  '#ec4899', '#3b82f6', '#8b5cf6', '#f97316', '#14b8a6',
                  '#ef4444', '#06b6d4', '#a855f7', '#eab308', '#22c55e',
                  '#db2777', '#6366f1', '#d946ef', '#fb923c', '#2dd4bf'];

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
        attribution: 'Â© OpenStreetMap contributors',
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
            console.warn(`âœ— Could not geocode: ${address}`);
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
  const assignOrdersToVehicles = async () => {
    if (orders.length === 0 || vehicles.length === 0) {
      alert('Please upload both orders and vehicles first.');
      return;
    }

    setOptimizing(true);
    console.log('Calling backend for route optimization with 2 algorithms...');

    try {
      const response = await fetch('http://localhost:5000/api/optimize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orders: orders,
          vehicles: vehicles
        })
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const result = await response.json();
      
      console.log('Received algorithm results from backend:', result);
      
      setAlgorithmResults(result.algorithms);
      setSelectedAlgorithm('distanceFirst');
      
      // Initialize all vehicles as visible for default algorithm
      const defaultRoutes = result.algorithms.distanceFirst.routes;
      const allVehicleIds = new Set(defaultRoutes.map(r => r.vehicle.id));
      setVisibleVehicles(allVehicleIds);
      
      displayRoutesWithFilter(defaultRoutes, allVehicleIds);
      setOptimizing(false);

      alert(`✅ Optimization Complete!\n\nCompared 2 algorithms:\n🔵 Distance-First (lowest cost)\n🟢 Time-First (best service)\n\nSelect an algorithm to view results.`);

    } catch (error) {
      console.error('Backend error:', error);
      setOptimizing(false);
      alert(`âŒ Backend Error\n\nCouldn't connect to optimization backend.\n\nMake sure the Python backend is running:\npython backend_app.py\n\nError: ${error.message}`);
    }
  };

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
        
        // Update driver app with new routes
        fetch('http://localhost:5000/api/driver/set-routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routes: result.routes, stats: result.stats })
        }).catch(err => console.log('Driver app update failed:', err));
      }

      setRecalculatingAlgo(null);

      alert(`✅ Real Road Distances Calculated!\n\n${result.osrmStats.totalRequests} routes calculated\n${result.osrmStats.successRate}% success rate\n\nNew total: ${result.stats.totalDistance}km`);

    } catch (error) {
      console.error('OSRM recalculation error:', error);
      setRecalculatingAlgo(null);
      alert(`âŒ Error calculating real distances\n\nMake sure backend is running.\n\nError: ${error.message}`);
    }
  };

  // Toggle vehicle visibility
  const toggleVehicle = (vehicleId) => {
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
    const routes = algorithmResults[selectedAlgorithm].routes;
    const allVehicleIds = new Set(routes.map(r => r.vehicle.id));
    setVisibleVehicles(allVehicleIds);
    displayRoutesWithFilter(routes, allVehicleIds);
  };

  // Hide all vehicles
  const hideAllVehicles = () => {
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
              ${segment.fallback ? '✈️ Estimated (OSRM unavailable)' : '🛣️ Real road distance'}
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

        const onTimeStatus = order.onTime ? '✅ On Time' : `⚠️ Late by ${order.lateness} min`;
        
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
              width: '100%',
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
              width: '100%',
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
          <button
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
          </button>

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
                        {key === 'distanceFirst' && 'ðŸ”µ'} 
                        {key === 'timeFirst' && 'ðŸŸ¢'} 
                        {' '}{algo.name}
                      </div>
                      <div style={{
                        fontSize: '10px',
                        color: '#8b95a5',
                        marginBottom: '8px'
                      }}>
                        {algo.description}
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
                        {isRoadDistance ? '🛣️ Real Roads' : '✈️ Estimated (×1.3)'}
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
                      {isRecalculating ? 'â³ Calculating...' : isRoadDistance ? 'âœ“ Chosen' : 'Choose'}
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
                      👁️ View on Map
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
                        {route.orders.length} stops â€¢ {route.totalDistance}km â€¢ {route.onTimeDeliveries}/{route.orders.length} on time
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