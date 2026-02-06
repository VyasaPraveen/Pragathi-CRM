import React, { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

import Dashboard from '../pages/Dashboard';
import Leads from '../pages/Leads';
import Customers from '../pages/Customers';
import Installations from '../pages/Installations';
import OngoingWork from '../pages/OngoingWork';
import Materials from '../pages/Materials';
import Revenue from '../pages/Revenue';
import Reports from '../pages/Reports';
import Team from '../pages/Team';
import Reminders from '../pages/Reminders';
import About from '../pages/About';
import Gallery from '../pages/Gallery';
import Settings from '../pages/Settings';

export default function AppLayout() {
  const [sbOpen, setSbOpen] = useState(false);

  return (
    <div className="app">
      <Sidebar open={sbOpen} onClose={() => setSbOpen(false)} />
      <div className="mc">
        <Topbar onMenuClick={() => setSbOpen(!sbOpen)} />
        <div className="pc fin">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/installations" element={<Installations />} />
            <Route path="/ongoing" element={<OngoingWork />} />
            <Route path="/materials" element={<Materials />} />
            <Route path="/revenue" element={<Revenue />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/team" element={<Team />} />
            <Route path="/reminders" element={<Reminders />} />
            <Route path="/about" element={<About />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
