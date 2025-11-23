import React, { useState, useEffect, useRef } from 'react';
import { Truck, MapPin, Navigation, CheckCircle, Clock, Package, ArrowRight, ChevronLeft } from 'lucide-react';

const DriverApp = () => {
  const [screen, setScreen] = useState('select'); // 'select' or 'route'
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [route, setRoute] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentStop, setCurrentStop] = useState(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);

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
    if (mapLoaded && !mapInstanceRef.current && mapRef.current && screen === 'route') {
      const map = window.L.map(mapRef.current).setView([46.0569, 14.5058], 12);
      
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);

      mapInstanceRef.current = map;

      // Display route if we have one
      if (route) {
        displayRoute(route);
      }
    }
  }, [mapLoaded, screen, route]);

  // Fetch available vehicles from backend
  const fetchVehicles = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/driver/vehicles');
      if (response.ok) {
        const data = await response.json();
        setVehicles(data.vehicles);
      }
    } catch (error) {
      console.error('Error fetching vehicles:', error);
    }
  };

  useEffect(() => {
    fetchVehicles();
  }, []);

  // Fetch route for selected vehicle
  const fetchRoute = async (vehicleId) => {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:5000/api/driver/route/${vehicleId}`);
      if (response.ok) {
        const data = await response.json();
        setRoute(data);
        setScreen('route');
      } else {
        alert('No route found for this vehicle. Please run optimization first.');
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      alert('Could not connect to server. Make sure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  // Display route on map
  const displayRoute = (routeData) => {
    if (!mapInstanceRef.current) return;

    // Clear existing markers and polylines
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    polylinesRef.current.forEach(polyline => polyline.remove());
    polylinesRef.current = [];

    const depot = [46.0569, 14.5058];
    const color = routeData.color || '#ff3b4a';

    // Add depot marker
    const depotMarker = window.L.marker(depot, {
      icon: window.L.divIcon({
        className: 'depot-marker',
        html: `<div style="background: #4CAF50; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">🏭</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      })
    }).addTo(mapInstanceRef.current);
    depotMarker.bindPopup('<strong>Depot</strong><br/>Start/End Point');
    markersRef.current.push(depotMarker);

    // Draw route polylines if available
    if (routeData.routeSegments) {
      routeData.routeSegments.forEach((segment, idx) => {
        const polyline = window.L.polyline(segment.geometry, {
          color: color,
          weight: 5,
          opacity: 0.8,
          lineJoin: 'round',
          lineCap: 'round',
          dashArray: segment.returnToDepot ? '10, 10' : null
        }).addTo(mapInstanceRef.current);

        polyline.bindPopup(`
          <div style="font-family: system-ui, -apple-system, sans-serif;">
            <strong>${segment.returnToDepot ? 'Return to Depot' : `Segment ${idx + 1}`}</strong><br/>
            Distance: ${segment.distance.toFixed(1)}km
          </div>
        `);

        polylinesRef.current.push(polyline);
      });
    }

    // Add order markers
    routeData.orders.forEach((order, idx) => {
      const isCompleted = idx < currentStop;
      const isCurrent = idx === currentStop;
      
      const marker = window.L.marker([order.lat, order.lng], {
        icon: window.L.divIcon({
          className: 'order-marker',
          html: `<div style="
            background: ${isCompleted ? '#4CAF50' : isCurrent ? color : 'white'}; 
            color: ${isCompleted || isCurrent ? 'white' : color}; 
            width: 44px; 
            height: 44px; 
            border-radius: 50%; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            font-weight: bold; 
            font-size: 18px;
            border: ${isCompleted ? `0px solid ${color}` : `3px solid ${color}`};
            box-shadow: 0 3px 10px rgba(0,0,0,0.4);
            ${isCurrent ? 'animation: pulse 2s infinite;' : ''}
          ">${isCompleted ? '✓' : idx + 1}</div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        })
      }).addTo(mapInstanceRef.current);

      marker.bindPopup(`
        <div style="font-family: system-ui, -apple-system, sans-serif;">
          <strong>Stop ${idx + 1}</strong><br/>
          ${order.address}<br/>
          Weight: ${order.weight}kg<br/>
          ${order.onTime ? '✅ On Time' : '⚠️ Late'}
        </div>
      `);

      markersRef.current.push(marker);
    });

    // Fit map to show all points
    const allPoints = [depot, ...routeData.orders.map(o => [o.lat, o.lng])];
    const bounds = window.L.latLngBounds(allPoints);
    mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
  };

  // Mark current stop as completed
  const completeStop = () => {
    if (currentStop < route.orders.length) {
      setCurrentStop(prev => prev + 1);
      displayRoute(route);
    }
  };

  // Go back to vehicle selection
  const goBack = () => {
    setScreen('select');
    setSelectedVehicle(null);
    setRoute(null);
    setCurrentStop(0);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
  };

  // Vehicle Selection Screen
  if (screen === 'select') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1a1f2e 0%, #252d3d 100%)',
        padding: '20px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
      }}>
        <style>{`
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .vehicle-card {
            animation: slideUp 0.4s ease-out;
          }
        `}</style>

        {/* Header */}
        <div style={{
          textAlign: 'center',
          marginBottom: '30px',
          paddingTop: '20px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            marginBottom: '8px'
          }}>
            <Package size={28} color="#ff3b4a" strokeWidth={2.5} />
            <h1 style={{
              margin: 0,
              fontSize: '32px',
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
            fontSize: '16px',
            color: 'rgba(255, 255, 255, 0.9)',
            fontWeight: '500'
          }}>
            Select your vehicle to start
          </p>
        </div>

        {/* Vehicle Cards */}
        <div style={{
          maxWidth: '600px',
          margin: '0 auto'
        }}>
          {vehicles.length === 0 ? (
            <div style={{
              background: 'rgba(255, 255, 255, 0.95)',
              borderRadius: '20px',
              padding: '40px 20px',
              textAlign: 'center'
            }}>
              <Package size={48} color="#ccc" style={{ marginBottom: '20px' }} />
              <h3 style={{ margin: '0 0 10px 0', color: '#333' }}>No Routes Available</h3>
              <p style={{ margin: 0, color: '#666' }}>
                Please run the route optimization first in the main app.
              </p>
            </div>
          ) : (
            vehicles.map((vehicle, idx) => (
              <div
                key={vehicle.id}
                className="vehicle-card"
                style={{
                  background: 'rgba(255, 255, 255, 0.95)',
                  borderRadius: '20px',
                  padding: '24px',
                  marginBottom: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  animationDelay: `${idx * 0.1}s`
                }}
                onClick={() => fetchRoute(vehicle.id)}
                onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
                onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{
                    width: '60px',
                    height: '60px',
                    background: vehicle.color || '#667eea',
                    borderRadius: '15px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Truck size={30} color="white" strokeWidth={2.5} />
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <h3 style={{
                      margin: '0 0 8px 0',
                      fontSize: '24px',
                      fontWeight: '700',
                      color: '#1a1a1a'
                    }}>
                      Vehicle {vehicle.id}
                    </h3>
                    
                    <div style={{
                      display: 'flex',
                      gap: '16px',
                      fontSize: '14px',
                      color: '#666'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <MapPin size={16} />
                        <span>{vehicle.stops} stops</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Navigation size={16} />
                        <span>{vehicle.distance}km</span>
                      </div>
                    </div>
                  </div>

                  <ArrowRight size={24} color="#667eea" />
                </div>
              </div>
            ))
          )}
        </div>

        {loading && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}>
            <div style={{
              background: 'white',
              padding: '30px 40px',
              borderRadius: '20px',
              textAlign: 'center'
            }}>
              <div style={{
                width: '50px',
                height: '50px',
                border: '4px solid #667eea',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                margin: '0 auto 20px',
                animation: 'spin 1s linear infinite'
              }} />
              <p style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>Loading route...</p>
            </div>
          </div>
        )}

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // Route Screen
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      background: '#f5f5f5'
    }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        .custom-marker, .order-marker, .depot-marker {
          background: transparent !important;
          border: none !important;
        }
      `}</style>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '16px 20px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '16px'
      }}>
        <button
          onClick={goBack}
          style={{
            background: 'rgba(255, 255, 255, 0.2)',
            border: 'none',
            borderRadius: '12px',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <ChevronLeft size={24} color="white" />
        </button>

        <div style={{ flex: 1 }}>
          <h2 style={{
            margin: '0 0 4px 0',
            fontSize: '20px',
            fontWeight: '700',
            color: 'white'
          }}>
            Vehicle {route?.vehicle?.id}
          </h2>
          <div style={{
            fontSize: '14px',
            color: 'rgba(255, 255, 255, 0.9)',
            display: 'flex',
            gap: '12px'
          }}>
            <span>{route?.orders?.length} stops</span>
            <span>•</span>
            <span>{route?.totalDistance}km</span>
          </div>
        </div>

        <div style={{
          background: 'rgba(255, 255, 255, 0.2)',
          padding: '8px 16px',
          borderRadius: '12px',
          fontSize: '14px',
          fontWeight: '600',
          color: 'white'
        }}>
          {currentStop}/{route?.orders?.length}
        </div>
      </div>

      {/* Map */}
      <div ref={mapRef} style={{
        flex: 1,
        background: '#e5e7eb'
      }} />

      {/* Bottom Panel */}
      <div style={{
        background: 'white',
        borderTopLeftRadius: '20px',
        borderTopRightRadius: '20px',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.1)',
        maxHeight: '40vh',
        overflowY: 'auto'
      }}>
        {currentStop < route?.orders?.length ? (
          <>
            {/* Current Stop Info */}
            <div style={{
              padding: '20px',
              borderBottom: '1px solid #e5e5e5'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '16px'
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  background: route.color || '#667eea',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '18px'
                }}>
                  {currentStop + 1}
                </div>
                <div>
                  <h3 style={{
                    margin: '0 0 4px 0',
                    fontSize: '18px',
                    fontWeight: '700',
                    color: '#1a1a1a'
                  }}>
                    Current Stop
                  </h3>
                  <p style={{
                    margin: 0,
                    fontSize: '14px',
                    color: '#666'
                  }}>
                    {route.orders[currentStop].address}
                  </p>
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '16px'
              }}>
                <div style={{
                  background: '#f5f5f5',
                  padding: '12px',
                  borderRadius: '12px'
                }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                    Order ID
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: '600' }}>
                    {route.orders[currentStop].id}
                  </div>
                </div>
                <div style={{
                  background: '#f5f5f5',
                  padding: '12px',
                  borderRadius: '12px'
                }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                    Weight
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: '600' }}>
                    {route.orders[currentStop].weight}kg
                  </div>
                </div>
              </div>

              <button
                onClick={completeStop}
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)'
                }}
              >
                <CheckCircle size={20} />
                Complete Delivery
              </button>
            </div>

            {/* Upcoming Stops */}
            {currentStop < route.orders.length - 1 && (
              <div style={{ padding: '20px' }}>
                <h4 style={{
                  margin: '0 0 12px 0',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#666',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  Next Stops
                </h4>
                {route.orders.slice(currentStop + 1, currentStop + 4).map((order, idx) => (
                  <div
                    key={order.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px 0',
                      borderBottom: idx < 2 ? '1px solid #f0f0f0' : 'none'
                    }}
                  >
                    <div style={{
                      width: '32px',
                      height: '32px',
                      background: '#f5f5f5',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                      fontWeight: '600',
                      color: '#666'
                    }}>
                      {currentStop + idx + 2}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '14px',
                        fontWeight: '500',
                        color: '#1a1a1a',
                        marginBottom: '2px'
                      }}>
                        {order.address}
                      </div>
                      <div style={{ fontSize: '12px', color: '#999' }}>
                        {order.weight}kg
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center'
          }}>
            <div style={{
              width: '80px',
              height: '80px',
              background: '#4CAF50',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px'
            }}>
              <CheckCircle size={40} color="white" strokeWidth={2.5} />
            </div>
            <h3 style={{
              margin: '0 0 8px 0',
              fontSize: '24px',
              fontWeight: '700',
              color: '#1a1a1a'
            }}>
              All Deliveries Complete!
            </h3>
            <p style={{
              margin: '0 0 24px 0',
              fontSize: '16px',
              color: '#666'
            }}>
              Great job! Return to depot.
            </p>
            <button
              onClick={goBack}
              style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '16px 32px',
                fontSize: '16px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Back to Vehicles
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DriverApp;