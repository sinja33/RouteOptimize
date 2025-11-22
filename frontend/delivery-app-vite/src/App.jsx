import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { MapPin, Upload, X, Package, Trash2 } from 'lucide-react';

const App = () => {
  const [orders, setOrders] = useState([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cacheCount, setCacheCount] = useState(0);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  // Update cache count on mount
  useEffect(() => {
    setCacheCount(Object.keys(localStorage).filter(key => key.startsWith('geocode_')).length);
  }, []);

  // Initialize Leaflet map
  useEffect(() => {
    // Load Leaflet CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    // Load Leaflet JS
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
      // Center on Slovenia
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
    // Check cache first
    const cacheKey = `geocode_${address.toLowerCase().trim()}`;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      console.log('Using cached coordinates for:', address);
      return JSON.parse(cached);
    }
    
    try {
      const query = `${address}, Slovenia`;
      console.log('Geocoding:', query);
      
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
      );
      
      if (!response.ok) {
        console.error('Geocoding API error:', response.status, response.statusText);
        return null;
      }
      
      const data = await response.json();
      console.log('Geocoding response:', data);
      
      if (data && data.length > 0) {
        const coords = {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        };
        
        // Save to cache
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

  // Handle Excel file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    console.log('File selected:', file.name);
    setUploading(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      console.log('Excel data loaded:', jsonData.length, 'rows');
      console.log('First row sample:', jsonData[0]);
      console.log('Column names:', Object.keys(jsonData[0] || {}));

      // Process orders and geocode addresses
      const processedOrders = [];
      let skippedCount = 0;
      
      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        
        // Try to find address in a single column first
        let address = row.Address || row.address || row.Naslov || row.naslov || 
                     row.Adresa || row.adresa;
        
        // If no single address column, try to combine specific columns
        if (!address) {
          // Look for street, house_number, postal_code, city columns
          const street = row.street || row.Street || '';
          const houseNumber = row.house_number || row.houseNumber || row.house_num || '';
          const postalCode = row.postal_code || row.postalCode || row.postal || '';
          const city = row.city || row.City || '';
          
          // Combine them if we have at least street and city
          if (street && city) {
            const parts = [street, houseNumber, postalCode, city].filter(p => p);
            address = parts.join(' ').trim();
            console.log('Combined address from columns:', address);
          }
        }
        
        if (address) {
          console.log(`Processing order ${i + 1}/${jsonData.length}: ${address}`);
          
          // Check if address is in cache before geocoding
          const cacheKey = `geocode_${address.toLowerCase().trim()}`;
          const wasCached = localStorage.getItem(cacheKey) !== null;
          
          const coords = await geocodeAddress(address);
          
          if (coords) {
            console.log(`✓ Geocoded: ${address}`, coords);
            
            const newOrder = {
              id: row.OrderID || i + 1,
              address: address,
              ...coords,
              ...row
            };
            
            processedOrders.push(newOrder);
            
            // Add marker to map immediately
            if (mapInstanceRef.current) {
              const marker = window.L.marker([coords.lat, coords.lng], {
                icon: window.L.divIcon({
                  className: 'custom-marker',
                  html: `<div class="marker-pin"></div>`,
                  iconSize: [24, 24],
                  iconAnchor: [12, 24]
                })
              }).addTo(mapInstanceRef.current);

              marker.bindPopup(`
                <div style="font-family: 'Inter', sans-serif;">
                  <strong>Order ${newOrder.id}</strong><br/>
                  ${newOrder.address}
                </div>
              `);

              markersRef.current.push(marker);
              
              // Update state to show in sidebar
              setOrders([...processedOrders]);
            }
            
            // Only delay if we actually made an API call (not cached)
            if (!wasCached && i < jsonData.length - 1) {
              // Wait to respect rate limit only for non-cached requests
              await new Promise(resolve => setTimeout(resolve, 1100));
            }
          } else {
            console.warn(`✗ Could not geocode: ${address}`);
            skippedCount++;
          }
        } else {
          console.warn(`Row ${i + 1}: No address found`, row);
          skippedCount++;
        }
      }

      console.log(`Processed ${processedOrders.length} orders, skipped ${skippedCount}`);
      setOrders(processedOrders);
      setUploading(false);
      
      if (processedOrders.length === 0) {
        alert('No valid addresses found. Please check your Excel file has an "Address" column.');
      }

      // Fit map to show all markers at the end
      if (mapInstanceRef.current && processedOrders.length > 0) {
        const bounds = window.L.latLngBounds(processedOrders.map(o => [o.lat, o.lng]));
        mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
      }
    } catch (error) {
      console.error('Error processing file:', error);
      alert(`Error processing file: ${error.message}`);
      setUploading(false);
    }
  };

  const clearOrders = () => {
    setOrders([]);
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([46.1512, 14.9955], 8);
    }
  };

  const clearGeocodeCache = () => {
    // Count how many cached items we have
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

        @keyframes markerPop {
          0% {
            transform: rotate(-45deg) scale(0);
          }
          50% {
            transform: rotate(-45deg) scale(1.2);
          }
          100% {
            transform: rotate(-45deg) scale(1);
          }
        }

        .custom-marker {
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
            Delivery Route Planning for Slovenia
          </p>
        </div>

        {/* Upload Section */}
        <div style={{ padding: '24px 28px', flex: 1, overflowY: 'auto' }}>
          <label htmlFor="file-upload" style={{
            display: 'block',
            width: '100%',
            padding: '20px',
            background: uploading ? 'rgba(255, 59, 74, 0.1)' : 'rgba(255, 59, 74, 0.05)',
            border: `2px dashed ${uploading ? '#ff3b4a' : 'rgba(255, 59, 74, 0.3)'}`,
            borderRadius: '12px',
            textAlign: 'center',
            cursor: uploading ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s ease',
            marginBottom: '24px'
          }}
          onMouseEnter={(e) => {
            if (!uploading) {
              e.currentTarget.style.background = 'rgba(255, 59, 74, 0.1)';
              e.currentTarget.style.borderColor = '#ff3b4a';
            }
          }}
          onMouseLeave={(e) => {
            if (!uploading) {
              e.currentTarget.style.background = 'rgba(255, 59, 74, 0.05)';
              e.currentTarget.style.borderColor = 'rgba(255, 59, 74, 0.3)';
            }
          }}>
            <input
              id="file-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              disabled={uploading}
              style={{ display: 'none' }}
            />
            <Upload size={32} color={uploading ? '#ff3b4a' : '#8b95a5'} 
              style={{ marginBottom: '12px' }} />
            <div style={{
              fontSize: '15px',
              fontWeight: '600',
              color: uploading ? '#ff3b4a' : '#e0e6ed',
              marginBottom: '4px'
            }}>
              {uploading ? 'Processing orders...' : 'Upload Excel File'}
            </div>
            <div style={{
              fontSize: '12px',
              color: '#6b7684'
            }}>
              {uploading ? 'Geocoding addresses, please wait' : 'Click to select .xlsx or .xls file'}
            </div>
          </label>

          {/* Cache Info */}
          {cacheCount > 0 && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              marginBottom: '24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{
                fontSize: '12px',
                color: '#8b95a5'
              }}>
                <div style={{ marginBottom: '2px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: "'Space Mono', monospace" }}>
                  Cache
                </div>
                {cacheCount} addresses cached
              </div>
              <button
                onClick={clearGeocodeCache}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#8b95a5',
                  cursor: 'pointer',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  transition: 'all 0.2s ease',
                  fontFamily: "'Space Mono', monospace"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 59, 74, 0.1)';
                  e.currentTarget.style.borderColor = '#ff3b4a';
                  e.currentTarget.style.color = '#ff3b4a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.color = '#8b95a5';
                }}
              >
                Clear Cache
              </button>
            </div>
          )}

          {/* Orders List */}
          {orders.length > 0 && (
            <>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px'
              }}>
                <h3 style={{
                  margin: 0,
                  fontSize: '14px',
                  fontWeight: '700',
                  color: '#e0e6ed',
                  textTransform: 'uppercase',
                  letterSpacing: '1.2px',
                  fontFamily: "'Space Mono', monospace"
                }}>
                  Orders ({orders.length})
                </h3>
                <button
                  onClick={clearOrders}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#8b95a5',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
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
                  <Trash2 size={14} />
                  Clear All
                </button>
              </div>

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                {orders.map((order, index) => (
                  <div key={order.id} style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    animation: `fadeIn 0.3s ease-out ${index * 0.05}s both`,
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.borderColor = 'rgba(255, 59, 74, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px'
                    }}>
                      <div style={{
                        width: '6px',
                        height: '6px',
                        background: '#ff3b4a',
                        borderRadius: '50%',
                        marginTop: '6px',
                        flexShrink: 0,
                        boxShadow: '0 0 8px rgba(255, 59, 74, 0.6)'
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: '11px',
                          color: '#6b7684',
                          fontWeight: '600',
                          marginBottom: '4px',
                          fontFamily: "'Space Mono', monospace",
                          letterSpacing: '0.5px'
                        }}>
                          ORDER #{order.id}
                        </div>
                        <div style={{
                          fontSize: '13px',
                          color: '#e0e6ed',
                          lineHeight: '1.5',
                          fontWeight: '400'
                        }}>
                          {order.address}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {orders.length === 0 && !uploading && (
            <div style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: '#6b7684',
              fontSize: '13px'
            }}>
              <MapPin size={48} color="#2c3442" style={{ marginBottom: '16px' }} />
              <div style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '600', color: '#8b95a5' }}>
                No orders loaded
              </div>
              <div>
                Upload an Excel file with order addresses to get started
              </div>
            </div>
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