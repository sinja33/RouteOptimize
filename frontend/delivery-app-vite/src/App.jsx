import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { MapPin, Upload, X, Package, Trash2, Truck, Zap, AlertCircle } from 'lucide-react';

const App = () => {
  const [orders, setOrders] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [uploadingOrders, setUploadingOrders] = useState(false);
  const [uploadingVehicles, setUploadingVehicles] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [cacheCount, setCacheCount] = useState(0);
  const [optimizedRoutes, setOptimizedRoutes] = useState([]);
  const [visibleVehicles, setVisibleVehicles] = useState(new Set());
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

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
        attribution: '© OpenStreetMap contributors',
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
            console.warn(`✗ Could not geocode: ${address}`);
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

      const processedVehicles = jsonData.map(row => ({
        id: row.vehicle_id || row.vehicleId || row.id,
        type: (row.type || '').toLowerCase(),
        maxCapacity: parseFloat(row.max_capacity || row.maxCapacity || row.capacity || 0),
        fuelType: (row.fuel_type || row.fuelType || '').toLowerCase(),
        emissions: parseFloat(row.emission_g_co2_per_km || row.emissions || 0)
      }));

      console.log('Loaded vehicles:', processedVehicles);
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
          Priority: ${order.priority}
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

  // Hardcoded assignment for demo/testing
  const assignOrdersToVehicles = () => {
    if (orders.length === 0 || vehicles.length === 0) {
      alert('Please upload both orders and vehicles first.');
      return;
    }

    setOptimizing(true);
    console.log('Assigning orders to vehicles (hardcoded for demo)...');

    // Simple assignment: divide orders evenly across vehicles
    const routes = [];
    const ordersPerVehicle = Math.ceil(orders.length / vehicles.length);

    vehicles.forEach((vehicle, idx) => {
      const startIdx = idx * ordersPerVehicle;
      const endIdx = Math.min(startIdx + ordersPerVehicle, orders.length);
      const vehicleOrders = orders.slice(startIdx, endIdx);

      if (vehicleOrders.length > 0) {
        const totalWeight = vehicleOrders.reduce((sum, o) => sum + o.weight, 0);
        
        routes.push({
          vehicle: vehicle,
          orders: vehicleOrders,
          totalWeight: totalWeight,
          totalDistance: 0, // Will calculate if needed
          color: COLORS[idx % COLORS.length]
        });
      }
    });

    console.log(`Assigned ${orders.length} orders to ${routes.length} vehicles`);
    setOptimizedRoutes(routes);
    
    // Initialize all vehicles as visible
    const allVehicleIds = new Set(vehicles.map(v => v.id));
    setVisibleVehicles(allVehicleIds);
    
    displayRoutesWithFilter(routes, allVehicleIds);
    setOptimizing(false);

    alert(`Demo Assignment Complete!\n\n${orders.length} orders divided across ${routes.length} vehicles.\n\nUse the vehicle filters to show/hide routes.`);
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
    
    // Pass the NEW visible set directly to displayRoutes
    displayRoutesWithFilter(optimizedRoutes, newVisible);
  };

  // Show all vehicles
  const showAllVehicles = () => {
    const allVehicleIds = new Set(optimizedRoutes.map(r => r.vehicle.id));
    setVisibleVehicles(allVehicleIds);
    displayRoutesWithFilter(optimizedRoutes, allVehicleIds);
  };

  // Hide all vehicles
  const hideAllVehicles = () => {
    const emptySet = new Set();
    setVisibleVehicles(emptySet);
    displayRoutesWithFilter(optimizedRoutes, emptySet);
  };

  // Export orders with coordinates to Excel
  const exportOrdersWithCoordinates = () => {
    if (orders.length === 0) {
      alert('No orders to export.');
      return;
    }

    // Prepare data for export
    const exportData = orders.map(order => ({
      OrderID: order.id,
      Address: order.address,
      Latitude: order.lat,
      Longitude: order.lng,
      Weight_kg: order.weight,
      Priority: order.priority,
      WindowStart: order.windowStart || '',
      WindowEnd: order.windowEnd || '',
      // Include any other original data
      ...order.originalData
    }));

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    
    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders with Coordinates');
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `orders_geocoded_${timestamp}.xlsx`;
    
    // Download
    XLSX.writeFile(workbook, filename);
    
    console.log(`Exported ${orders.length} orders with coordinates`);
    alert(`Exported ${orders.length} orders with lat/lng coordinates to:\n${filename}`);
  };

  // Export vehicle assignments to Excel
  const exportVehicleAssignments = () => {
    if (optimizedRoutes.length === 0) {
      alert('No assignments to export. Please assign orders to vehicles first.');
      return;
    }

    // Prepare data for export - one row per order with vehicle assignment
    const exportData = [];
    
    optimizedRoutes.forEach(route => {
      route.orders.forEach((order, idx) => {
        exportData.push({
          VehicleID: route.vehicle.id,
          VehicleType: route.vehicle.type,
          FuelType: route.vehicle.fuelType,
          StopNumber: idx + 1,
          OrderID: order.id,
          Address: order.address,
          Latitude: order.lat,
          Longitude: order.lng,
          Weight_kg: order.weight,
          Priority: order.priority,
          WindowStart: order.windowStart || '',
          WindowEnd: order.windowEnd || ''
        });
      });
    });

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    
    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Vehicle Assignments');
    
    // Add summary sheet
    const summaryData = optimizedRoutes.map(route => ({
      VehicleID: route.vehicle.id,
      Type: route.vehicle.type,
      FuelType: route.vehicle.fuelType,
      Capacity_kg: route.vehicle.maxCapacity,
      TotalStops: route.orders.length,
      TotalWeight_kg: route.totalWeight,
      LoadPercentage: ((route.totalWeight / route.vehicle.maxCapacity) * 100).toFixed(1) + '%'
    }));
    
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `vehicle_assignments_${timestamp}.xlsx`;
    
    // Download
    XLSX.writeFile(workbook, filename);
    
    console.log(`Exported ${exportData.length} order assignments`);
    alert(`Exported vehicle assignments:\n- ${exportData.length} orders\n- ${optimizedRoutes.length} vehicles\n\nFile: ${filename}`);
  };

  // Display routes on map
  const displayRoutesWithFilter = (routes, filterSet = null) => {
    if (!mapInstanceRef.current) return;

    // Use provided filter or fall back to state
    const vehiclesToShow = filterSet || visibleVehicles;

    // Clear existing order markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Draw routes (only for visible vehicles)
    routes.forEach((route) => {
      // Skip if vehicle is not visible
      if (!vehiclesToShow.has(route.vehicle.id)) return;
      
      if (route.orders.length === 0) return;

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

        marker.bindPopup(`
          <div style="font-family: 'Inter', sans-serif;">
            <strong>Stop ${idx + 1} - ${order.id}</strong><br/>
            Vehicle: ${route.vehicle.id}<br/>
            ${order.address}<br/>
            Weight: ${order.weight}kg<br/>
            Priority: ${order.priority}
          </div>
        `);

        markersRef.current.push(marker);
      });
    });
  };

  const clearAll = () => {
    setOrders([]);
    setVehicles([]);
    setOptimizedRoutes([]);
    setVisibleVehicles(new Set());
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
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
        width: '380px',
        background: 'linear-gradient(135deg, #1a1f2e 0%, #252d3d 100%)',
        boxShadow: '4px 0 24px rgba(0, 0, 0, 0.3)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideIn 0.5s ease-out'
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
            Multi-Vehicle Route Optimization
          </p>
        </div>

        {/* Content */}
        <div style={{ padding: '24px 28px', flex: 1, overflowY: 'auto' }}>
          
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
            }}
            onMouseEnter={(e) => {
              if (!uploadingOrders) {
                e.currentTarget.style.background = 'rgba(255, 59, 74, 0.1)';
                e.currentTarget.style.borderColor = '#ff3b4a';
              }
            }}
            onMouseLeave={(e) => {
              if (!uploadingOrders) {
                e.currentTarget.style.background = 'rgba(255, 59, 74, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(255, 59, 74, 0.3)';
              }
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

          {/* Export Orders Button */}
          {orders.length > 0 && (
            <button
              onClick={exportOrdersWithCoordinates}
              style={{
                width: '100%',
                padding: '14px',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '2px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '10px',
                color: '#10b981',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)';
                e.currentTarget.style.borderColor = '#10b981';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.3)';
              }}
            >
              <Package size={16} />
              Export Orders with Coordinates
            </button>
          )}

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
            }}
            onMouseEnter={(e) => {
              if (!uploadingVehicles) {
                e.currentTarget.style.background = 'rgba(0, 212, 255, 0.1)';
                e.currentTarget.style.borderColor = '#00d4ff';
              }
            }}
            onMouseLeave={(e) => {
              if (!uploadingVehicles) {
                e.currentTarget.style.background = 'rgba(0, 212, 255, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.3)';
              }
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

          {/* Assign Button */}
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
              marginBottom: '20px',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontFamily: "'Space Mono', monospace",
              boxShadow: (orders.length > 0 && vehicles.length > 0 && !optimizing) 
                ? '0 8px 20px rgba(124, 58, 237, 0.4)' 
                : 'none'
            }}
            onMouseEnter={(e) => {
              if (orders.length > 0 && vehicles.length > 0 && !optimizing) {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 12px 24px rgba(124, 58, 237, 0.5)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              if (orders.length > 0 && vehicles.length > 0 && !optimizing) {
                e.currentTarget.style.boxShadow = '0 8px 20px rgba(124, 58, 237, 0.4)';
              }
            }}
          >
            {optimizing ? '⚡ Assigning...' : '📦 Assign to Vehicles (Demo)'}
          </button>

          {/* Routes Summary */}
          {optimizedRoutes.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px'
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
                  Routes ({optimizedRoutes.length})
                </h3>
              </div>

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                {optimizedRoutes.map((route, idx) => (
                  <div key={idx} style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: `1px solid ${route.color}40`,
                    borderLeft: `4px solid ${route.color}`
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '8px'
                    }}>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: '700',
                        color: '#e0e6ed',
                        fontFamily: "'Space Mono', monospace"
                      }}>
                        {route.vehicle.id}
                      </div>
                      <div style={{
                        display: 'flex',
                        gap: '6px',
                        alignItems: 'center'
                      }}>
                        {route.vehicle.fuelType === 'electric' && (
                          <Zap size={14} color="#10b981" />
                        )}
                        <span style={{
                          fontSize: '11px',
                          color: '#8b95a5',
                          textTransform: 'uppercase'
                        }}>
                          {route.vehicle.type}
                        </span>
                      </div>
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px',
                      fontSize: '11px',
                      color: '#8b95a5'
                    }}>
                      <div>Stops: {route.orders.length}</div>
                      <div>Dist: {route.totalDistance}km</div>
                      <div>Load: {route.totalWeight}kg</div>
                      <div>Cap: {route.vehicle.maxCapacity}kg</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vehicle Filters */}
          {optimizedRoutes.length > 0 && (
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
                      fontSize: '10px',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(124, 58, 237, 0.1)';
                      e.currentTarget.style.color = '#a855f7';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#8b95a5';
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
                      fontSize: '10px',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 59, 74, 0.1)';
                      e.currentTarget.style.color = '#ff3b4a';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#8b95a5';
                    }}
                  >
                    None
                  </button>
                </div>
              </div>

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                {optimizedRoutes.map((route) => (
                  <label key={route.vehicle.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    borderLeft: `3px solid ${route.color}`
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
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
                        {route.orders.length} stops • {route.totalWeight.toFixed(1)}kg
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Export Vehicle Assignments Button */}
          {optimizedRoutes.length > 0 && (
            <button
              onClick={exportVehicleAssignments}
              style={{
                width: '100%',
                padding: '14px',
                background: 'rgba(124, 58, 237, 0.1)',
                border: '2px solid rgba(124, 58, 237, 0.3)',
                borderRadius: '10px',
                color: '#a855f7',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(124, 58, 237, 0.15)';
                e.currentTarget.style.borderColor = '#a855f7';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(124, 58, 237, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)';
              }}
            >
              <Truck size={16} />
              Export Vehicle Assignments
            </button>
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
                  fontSize: '10px',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 59, 74, 0.1)';
                  e.currentTarget.style.color = '#ff3b4a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#8b95a5';
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
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 59, 74, 0.1)';
                e.currentTarget.style.color = '#ff3b4a';
                e.currentTarget.style.borderColor = '#ff3b4a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#8b95a5';
                e.currentTarget.style.borderColor = 'rgba(255, 59, 74, 0.3)';
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
        left: '380px',
        right: 0,
        top: 0,
        bottom: 0,
        background: '#e5e7eb'
      }} />

      {/* Loading overlay */}
      {!mapLoaded && (
        <div style={{
          position: 'absolute',
          left: '380px',
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