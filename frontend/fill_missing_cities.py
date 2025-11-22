import pandas as pd
import requests
import time

def geocode_address(street, house_number, postal_code):
    """
    Geocode an address using Nominatim and return the city.
    """
    # Build the query
    parts = []
    if street:
        parts.append(str(street))
    if house_number:
        parts.append(str(house_number))
    if postal_code:
        parts.append(str(postal_code))
    
    if not parts:
        return None
    
    query = ' '.join(parts) + ', Slovenia'
    
    try:
        url = f"https://nominatim.openstreetmap.org/search"
        params = {
            'format': 'json',
            'q': query,
            'limit': 1,
            'addressdetails': 1
        }
        
        headers = {
            'User-Agent': 'DeliveryRouteOptimizer/1.0'
        }
        
        response = requests.get(url, params=params, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                address = data[0].get('address', {})
                # Try to get city/town/village
                city = (address.get('city') or 
                       address.get('town') or 
                       address.get('village') or 
                       address.get('municipality'))
                return city
        
        return None
        
    except Exception as e:
        print(f"  Error geocoding: {e}")
        return None


def get_postal_code(street, house_number, city):
    """
    Get postal code for an address.
    """
    parts = []
    if street:
        parts.append(str(street))
    if house_number:
        parts.append(str(house_number))
    if city:
        parts.append(str(city))
    
    if not parts:
        return None
    
    query = ' '.join(parts) + ', Slovenia'
    
    try:
        url = f"https://nominatim.openstreetmap.org/search"
        params = {
            'format': 'json',
            'q': query,
            'limit': 1,
            'addressdetails': 1
        }
        
        headers = {
            'User-Agent': 'DeliveryRouteOptimizer/1.0'
        }
        
        response = requests.get(url, params=params, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                address = data[0].get('address', {})
                postal_code = address.get('postcode')
                return postal_code
        
        return None
        
    except Exception as e:
        print(f"  Error getting postal code: {e}")
        return None


def fill_missing_cities(input_file, output_file=None):
    """
    Fill missing city values in the Excel file.
    """
    if output_file is None:
        output_file = input_file.replace('.xlsx', '_with_cities.xlsx')
    
    print(f"Reading Excel file: {input_file}")
    df = pd.read_excel(input_file)
    
    print(f"Total rows: {len(df)}")
    
    # Find rows with missing cities
    missing_city_mask = df['city'].isna() | (df['city'] == '')
    missing_count = missing_city_mask.sum()
    
    print(f"Rows with missing city: {missing_count}")
    
    if missing_count == 0:
        print("No missing cities found!")
        return
    
    # Process each row with missing city
    filled_count = 0
    
    for idx, row in df[missing_city_mask].iterrows():
        street = row.get('street', '')
        house_number = row.get('house_number', '')
        postal_code = row.get('postal_code', '')
        
        # Handle NaN values
        street = '' if pd.isna(street) else str(street)
        house_number = '' if pd.isna(house_number) else str(house_number)
        postal_code = '' if pd.isna(postal_code) else str(postal_code)
        
        print(f"\nRow {idx + 1}: {street} {house_number} {postal_code if postal_code else '(no postal code)'}")
        
        # Try to geocode with whatever we have
        city = geocode_address(street, house_number, postal_code)
        
        if city:
            df.at[idx, 'city'] = city
            
            # Also try to fill postal code if we found the city
            if not postal_code or postal_code == '':
                # Try to get postal code from the same geocoding result
                postal = get_postal_code(street, house_number, city)
                if postal:
                    df.at[idx, 'postal_code'] = postal
                    print(f"  ✓ Found city: {city}, postal code: {postal}")
                else:
                    print(f"  ✓ Found city: {city}")
            else:
                print(f"  ✓ Found city: {city}")
                
            filled_count += 1
        else:
            print(f"  ✗ Could not find city")
        
        # Rate limiting - wait 1 second between requests
        time.sleep(1.1)
    
    print(f"\n{'='*60}")
    print(f"Filled {filled_count} out of {missing_count} missing cities")
    print(f"Saving to: {output_file}")
    
    # Save the updated Excel file
    df.to_excel(output_file, index=False)
    
    print(f"Done! ✓")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python fill_missing_cities.py <input_excel_file> [output_excel_file]")
        print("\nExample:")
        print("  python fill_missing_cities.py orders.xlsx")
        print("  python fill_missing_cities.py orders.xlsx orders_complete.xlsx")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    fill_missing_cities(input_file, output_file)
