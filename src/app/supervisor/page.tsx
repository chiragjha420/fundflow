import React from 'react';
import { SupervisorClientPage } from './supervisor-client';

export const revalidate = 0; // Disable static caching for real-time dashboard

export default function SupervisorDashboardPage() {
  return <SupervisorClientPage />;
}
