import React from 'react';
import { SupervisorWorkersClientPage } from './workers-client';

export const revalidate = 0; // Disable static caching for real-time list

export default function SupervisorWorkersPage() {
  return <SupervisorWorkersClientPage />;
}
