// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

// Import D3 as an ES module
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiamlxMDE2IiwiYSI6ImNtd2N1d3l1bDA1cHMzMG9zYWc0MGZycGcifQ.tuPVp25CAMVb7ziyQlCYcg';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// Project station lon/lat to pixel coordinates on the map
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

// Format minutes since midnight as a time string, e.g. "3:30 PM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// Minutes since midnight for a Date object
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Keep trips that start or end within 60 minutes of the selected time
function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips // If no filter is applied (-1), return all trips
    : trips.filter((trip) => {
        // Convert trip start and end times to minutes since midnight
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        // Include trips that started or ended within 60 minutes of the selected time
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

// Compute arrivals, departures, and totalTraffic for each station
function computeStationTraffic(stations, trips) {
  // Compute departures
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  // Compute arrivals
  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  // Update each station
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

map.on('load', async () => {
  // Shared styling for bike lane layers
  const bikeLanePaint = {
    'line-color': '#32D400',
    'line-width': 5,
    'line-opacity': 0.6,
  };

  // Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  // Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLanePaint,
  });

  // Step 3.1: load the BlueBikes stations
  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

    // Await JSON fetch
    jsonData = await d3.json(jsonurl);

    console.log('Loaded JSON Data:', jsonData); // Log to verify structure
  } catch (error) {
    console.error('Error loading JSON:', error); // Handle errors
  }

  // Step 4.1 / 5.3b: load trips, converting timestamps to Date objects
  const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    },
  );

  // Step 4.2 / 5.3a: compute traffic for every station
  let stations = computeStationTraffic(jsonData.data.stations, trips);
  console.log('Stations with traffic:', stations);

  // Step 4.3: size circles by traffic (square root scale)
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Step 6.1: quantize the departure ratio into 3 levels (0, 0.5, 1)
  let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  // Tooltip text for a station
  const tooltipText = (d) =>
    `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;

  // Step 3.3: draw station markers in the SVG overlay
  const svg = d3.select('#map').select('svg');

  let circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name) // Key function: match circles to stations
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic)) // Radius based on traffic
    .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic),
    )
    .each(function (d) {
      // Step 4.4: add <title> for browser-native tooltips
      d3.select(this).append('title').text(tooltipText(d));
    });

  // Reposition markers on the map
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
      .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
  }

  // Initial position update when map loads
  updatePositions();

  // Reposition markers on map interactions
  map.on('move', updatePositions); // Update during map movement
  map.on('zoom', updatePositions); // Update during zooming
  map.on('resize', updatePositions); // Update on window resize
  map.on('moveend', updatePositions); // Final adjustment after movement ends

  // Step 5.2: slider reactivity
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value); // Get slider value

    if (timeFilter === -1) {
      selectedTime.textContent = ''; // Clear time display
      anyTimeLabel.style.display = 'block'; // Show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter); // Display formatted time
      anyTimeLabel.style.display = 'none'; // Hide "(any time)"
    }

    // Trigger filtering logic which will be implemented in the next step
    updateScatterPlot(timeFilter);
  }

  // Step 5.3e: update the circles for the selected time
  function updateScatterPlot(timeFilter) {
    // Get only the trips that match the selected time filter
    const filteredTrips = filterTripsbyTime(trips, timeFilter);

    // Recompute station traffic based on the filtered trips
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    // Step 5.3g: larger circles when filtering, since there are fewer trips
    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    // Update the scatterplot by adjusting the radius of circles
    circles = circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
      .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      );

    // Keep tooltips in sync with the filtered data
    circles.select('title').text(tooltipText);

    updatePositions();
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
