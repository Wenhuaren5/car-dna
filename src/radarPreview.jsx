import React from 'react';
import {createRoot} from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './fonts.css';
import './styles.css';
import carDatabase from './data/carDatabase.json';
import {adaptVehicles} from './algorithms/vehicleAdapter.js';
import {runRecommendationPipeline} from './algorithms/recommendationPipeline.js';
import {ResultsContent} from './components/ResultsPage.jsx';

const profile = {
  role: 'Parent',
  ownershipDurationMonths: 60,
  budget: '45000',
  vehicleCondition: 'Either',
  preferredBodyType: 'SUV / Crossover',
  minimumSeats: 7,
  cargoNeeds: 'Large',
  homeLocation: {lat: 37.3382, lng: -121.8863},
  destinations: [{id: 'w', type: 'Work', lat: 37.35, lng: -121.95, roundTripsPerWeek: 5, weeksPerYear: 46, routeDistanceMiles: 12}],
  acceptablePowertrains: ['ICE', 'HEV', 'PHEV', 'EV'],
  homeCharging: 'Level 2',
  workplaceCharging: 'Yes',
  parking: 'Private garage',
  roadTripFrequency: 'Occasionally',
  selectedPriorities: ['comfort_space'],
  longDistanceTripsPerYear: '6',
  longDistanceRoundTripMiles: '400',
};

const views = adaptVehicles(carDatabase);
const result = runRecommendationPipeline({profile, views});
const root = createRoot(document.getElementById('root'));
root.render(<ResultsContent profile={profile} result={result} onEdit={() => {}} onEditDna={() => {}} />);
window.__RADAR_PREVIEW__ = result;
